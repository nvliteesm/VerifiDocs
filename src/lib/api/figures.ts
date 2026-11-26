// "Check my numbers": the figures and findings each part of the draft reports, and the places that may contradict.
//
//   POST /api/runs/:id/figures        { unit, refresh? }  reads one part (or returns what was saved for it)
//   GET  /api/runs/:id/figures                            everything saved, so a reload shows the last answer
//   POST /api/runs/:id/contradictions { refresh? }        compares the findings of all saved parts
//
// One model call per part, like extraction, so each request stays short. The answers are kept in run_figures and
// run_consistency (they go with the run, so the 30-day deletion removes them) and never change a verdict.
import type postgres from "postgres";
import { z } from "zod";
import { extractFiguresWithFallback } from "../pipeline/extract-figures";
import { findContradictions, type ContradictionPair, type Statement } from "../pipeline/find-contradictions";
import { splitIntoUnits, unitParagraphs } from "../pipeline/parse-draft";
import { tableCaptionOf } from "../pipeline/table-rows";
import { containsQuote } from "../rag/normalize";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse, readJson } from "./http";

const body = z.object({ unit: z.number().int().min(0), refresh: z.boolean().optional() });
const contradictionBody = z.object({ refresh: z.boolean().optional() });

export interface FigureView {
  label: string;
  value: string;
  unit: string | null;
  sentence: string;
  /** The heading the sentence sits under, or null before the first heading. */
  section: string | null;
}

interface StoredUnit {
  unit: number;
  figures: FigureView[];
  statements: Statement[];
  dropped: number;
  partial: boolean;
}

interface RunRow {
  id: string;
  unit_count: number;
  draft_text: string;
}

async function ownedRun(sql: postgres.Sql, context: ApiContext, runId: string): Promise<RunRow> {
  assertId(runId);
  const [run] = await sql<RunRow[]>`select id, unit_count, draft_text from runs where id = ${runId} and session_id = ${context.sessionId}`;
  if (!run) throw new ApiError(404, "not_found", "Not found.");
  return run;
}

async function storedUnits(sql: postgres.Sql, runId: string): Promise<StoredUnit[]> {
  const rows = await sql<{ unit: number; figures: FigureView[]; statements: Statement[]; dropped: number; partial: boolean }[]>`
    select unit, figures, statements, dropped, partial from run_figures where run_id = ${runId} order by unit`;
  return rows.map((row) => ({ unit: row.unit, figures: row.figures, statements: row.statements, dropped: row.dropped, partial: row.partial }));
}

export async function readFiguresHandler(context: ApiContext, runId: string, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { unit, refresh } = body.parse(await readJson(request));
  const run = await ownedRun(sql, context, runId);
  if (unit >= run.unit_count) throw new ApiError(400, "unit_out_of_range", "That part of the draft does not exist.");

  if (!refresh) {
    const [saved] = await sql<{ figures: FigureView[]; dropped: number; partial: boolean }[]>`
      select figures, dropped, partial from run_figures where run_id = ${runId} and unit = ${unit}`;
    // A part read only in part is read again: it may be the model being busy.
    if (saved && !saved.partial) return jsonResponse({ unit, unitCount: run.unit_count, figures: saved.figures, dropped: saved.dropped, partial: false, saved: true });
  }

  const units = splitIntoUnits(run.draft_text);
  const { figures, dropped, partial, statements } = await extractFiguresWithFallback(context.deps.llm, units[unit]!.text);
  const paragraphs = unitParagraphs(run.draft_text, unit);
  const sectionOf = (sentence: string) => paragraphs.find((paragraph) => containsQuote(tableCaptionOf(sentence) ?? sentence, paragraph.text))?.heading ?? null;
  const views: FigureView[] = figures.map((figure) => ({ ...figure, section: sectionOf(figure.sentence) }));
  const found: Statement[] = statements.map((sentence) => ({ sentence, section: sectionOf(sentence), part: unit }));
  await sql`
    insert into run_figures (run_id, unit, figures, statements, dropped, partial)
    values (${runId}, ${unit}, ${sql.json(views as never)}, ${sql.json(found as never)}, ${dropped}, ${partial})
    on conflict (run_id, unit) do update
      set figures = excluded.figures, statements = excluded.statements, dropped = excluded.dropped, partial = excluded.partial, created_at = now()`;
  // New figures make an older comparison out of date.
  await sql`delete from run_consistency where run_id = ${runId}`;
  return jsonResponse({ unit, unitCount: run.unit_count, figures: views, dropped, partial, saved: false });
}

/** Everything saved for a run, so a reload shows the last answer without reading the draft again. */
export async function savedFiguresHandler(context: ApiContext, runId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const run = await ownedRun(sql, context, runId);
  const units = await storedUnits(sql, runId);
  const [consistency] = await sql<{ pairs: ContradictionPair[] }[]>`select pairs from run_consistency where run_id = ${runId}`;
  return jsonResponse({
    unitCount: run.unit_count,
    units: units.map((unit) => ({ unit: unit.unit, figures: unit.figures, partial: unit.partial })),
    contradictions: consistency ? consistency.pairs : null,
  });
}

export async function contradictionsHandler(context: ApiContext, runId: string, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { refresh } = contradictionBody.parse(await readJson(request));
  await ownedRun(sql, context, runId);
  if (!refresh) {
    const [saved] = await sql<{ pairs: ContradictionPair[] }[]>`select pairs from run_consistency where run_id = ${runId}`;
    if (saved) return jsonResponse({ pairs: saved.pairs, saved: true });
  }
  const statements = (await storedUnits(sql, runId)).flatMap((unit) => unit.statements);
  const pairs = await findContradictions(context.deps.llm, statements);
  await sql`
    insert into run_consistency (run_id, pairs) values (${runId}, ${sql.json(pairs as never)})
    on conflict (run_id) do update set pairs = excluded.pairs, created_at = now()`;
  return jsonResponse({ pairs, saved: false });
}
