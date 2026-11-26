// POST /api/runs/:id/figures { unit }: the figures one part of the draft reports, for the "Check my numbers" tool.
//
// One model call per part, like extraction, so each request stays short. Nothing is saved: the browser keeps the
// answers and compares them (a different tool from checking claims against sources, and it never changes a verdict).
import type postgres from "postgres";
import { z } from "zod";
import { extractFiguresWithFallback } from "../pipeline/extract-figures";
import { splitIntoUnits, unitParagraphs } from "../pipeline/parse-draft";
import { containsQuote } from "../rag/normalize";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse, readJson } from "./http";

const body = z.object({ unit: z.number().int().min(0) });

export interface FigureView {
  label: string;
  value: string;
  unit: string | null;
  sentence: string;
  /** The heading the sentence sits under, or null before the first heading. */
  section: string | null;
}

export async function readFiguresHandler(context: ApiContext, runId: string, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  assertId(runId);
  const { unit } = body.parse(await readJson(request));
  const [run] = await sql<{ id: string; unit_count: number; draft_text: string }[]>`
    select id, unit_count, draft_text from runs where id = ${runId} and session_id = ${context.sessionId}`;
  if (!run) throw new ApiError(404, "not_found", "Not found.");
  if (unit >= run.unit_count) throw new ApiError(400, "unit_out_of_range", "That part of the draft does not exist.");

  const units = splitIntoUnits(run.draft_text);
  const { figures, dropped, partial } = await extractFiguresWithFallback(context.deps.llm, units[unit]!.text);
  const paragraphs = unitParagraphs(run.draft_text, unit);
  const views: FigureView[] = figures.map((figure) => ({
    ...figure,
    section: paragraphs.find((paragraph) => containsQuote(figure.sentence, paragraph.text))?.heading ?? null,
  }));
  return jsonResponse({ unit, unitCount: run.unit_count, figures: views, dropped, partial });
}
