// The eval run: npm run eval (docs/eval.md, "Running it").
//
// Every claim in evals/claims.json goes through the app's own check (checkClaim: stages 3 to 9, the same Gemini
// adapter, real Crossref and OpenAlex) against the public sources in evals/sources.json, on the Neon dev branch.
// It refuses to run anywhere else, and deletes everything it created when it ends, even after a failure.
//
// Options (env vars):
//   EVAL_RUNS=3               how many times each claim is checked (stability; docs/eval.md asks for at least 3)
//   EVAL_ONLY=E01,E05         check only these claims
//   EVAL_INCLUDE_PROPOSED=1   also score labels Steven has not approved yet, as a marked preview (hard rule 10)
//
// Writes evals/results/<date>-<model>.json and .md: the score against the bar, failures by verdict type, dev vs
// held-out, English vs Indonesian, retrieval hits, the claims whose verdict changed between runs, and timings.
import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { runPool } from "../src/lib/client/pool";
import { getLlm } from "../src/lib/llm/adapter";
import { checkClaim } from "../src/lib/pipeline/claim-check";
import { createDocumentFromPdf, ingestNextBatch, MAX_DOCUMENTS_PER_SESSION } from "../src/lib/pipeline/ingest";
import { resolveReference } from "../src/lib/pipeline/resolve-reference";
import { embedQuery } from "../src/lib/rag/embed";
import { containsQuote } from "../src/lib/rag/normalize";
import { retrieveTopChunks } from "../src/lib/rag/retrieve";
import { scoreEval, BAR, type EvalClaim, type EvalReport, type Outcome } from "./score";

const DIR = new URL(".", import.meta.url).pathname;
const CACHE = `${DIR}.cache/`;
const RESULTS = `${DIR}results/`;
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS ?? 3));
const ONLY = new Set((process.env.EVAL_ONLY ?? "").split(",").map((id) => id.trim()).filter(Boolean));
const INCLUDE_PROPOSED = process.env.EVAL_INCLUDE_PROPOSED === "1";
/** As in the browser (run-verification.ts). */
const CONCURRENCY = 5;
const MAX_ROUNDS = 6;

interface Source { file: string; url: string; sha256: string }
interface Entry { key: string; file: string | null; raw: string }

const read = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, "utf8")) as T;
const sources = read<{ sources: Source[] }>("sources.json").sources;
const entries = read<{ entries: Entry[] }>("bibliography.json").entries;
const allClaims = read<{ claims: EvalClaim[] }>("claims.json").claims.filter((c) => ONLY.size === 0 || ONLY.has(c.id));

const enabled = process.env.NEON_BRANCH === "dev" && Boolean(process.env.DATABASE_URL_UNPOOLED);
const sql = enabled ? postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 8, onnotice: () => {} }) : null;
const sessionIds: string[] = [];

/** The reference entry a citation points at: "(He dkk., 2016)" -> he2016. Null when the list has none. */
function entryFor(citation: string | null): Entry | null {
  const match = citation ? /(\p{Lu}[\p{L}'-]+)\b.*?\b((?:19|20)\d{2})/u.exec(citation) : null;
  return match ? entries.find((e) => e.key === `${match[1]!.toLowerCase()}${match[2]}`) ?? null : null;
}

/**
 * The source PDF, downloaded once into evals/.cache. curl, not fetch: nature.com answers Node's fetch with a web page
 * whatever its headers (seen 24 Nov 2026). The SHA-256 check means the client cannot change what is scored.
 */
async function cachedPdf(source: Source): Promise<Uint8Array> {
  mkdirSync(CACHE, { recursive: true });
  const path = `${CACHE}${source.file}`;
  if (!existsSync(path)) {
    execFileSync("curl", ["--silent", "--show-error", "--location", "--fail", "--user-agent", "VerifiDocs-eval/0.1", "--output", path, source.url]);
  }
  const bytes = new Uint8Array(readFileSync(path));
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") {
    rmSync(path);
    throw new Error(`${source.file}: ${source.url} sent something that is not a PDF (a web page?). Download it by hand into evals/.cache/.`);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== source.sha256) {
    rmSync(path);
    throw new Error(`${source.file} is not the file the labels were read from (sha256 ${hash.slice(0, 12)}).`);
  }
  return bytes;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => {
  if (!sql) return;
  for (const id of sessionIds) {
    await sql`delete from events where session_id = ${id}`;
    await sql`delete from sessions where id = ${id}`;
  }
  await sql.end();
});

describe.skipIf(!enabled)("eval (Neon dev branch only)", () => {
  it("checks every claim and writes the results", async () => {
    const db = sql!;
    const llm = getLlm();
    const deps = {
      llm,
      resolve: (raw: string) => resolveReference(raw, undefined, undefined, { openAlexApiKey: process.env.OPENALEX_API_KEY || undefined }),
    };

    // Sources go into sessions of at most MAX_DOCUMENTS_PER_SESSION, the app's own limit; every session has the whole
    // reference list, and a claim is checked in the session that holds its cited PDF.
    const files = [...new Set(entries.map((e) => e.file).filter((f): f is string => f !== null))];
    const groups: string[][] = [];
    for (let i = 0; i < files.length; i += MAX_DOCUMENTS_PER_SESSION) groups.push(files.slice(i, i + MAX_DOCUMENTS_PER_SESSION));

    const where = new Map<string, { sessionId: string; runId: string; documentId: string }>();
    const sessions: { sessionId: string; runId: string }[] = [];
    for (const group of groups) {
      const [session] = await db<{ id: string }[]>`insert into sessions (token_hash) values (${`eval-${randomUUID()}`}) returning id`;
      sessionIds.push(session!.id);
      const [run] = await db<{ id: string }[]>`
        insert into runs (session_id, draft_text, input_type, status) values (${session!.id}, 'eval', 'paste', 'checking') returning id`;
      for (const [index, entry] of entries.entries()) {
        await db`insert into reference_entries (run_id, session_id, raw_text, position) values (${run!.id}, ${session!.id}, ${entry.raw}, ${index + 1})`;
      }
      for (const file of group) {
        const source = sources.find((s) => s.file === file)!;
        const created = await createDocumentFromPdf(db, { sessionId: session!.id, filename: file, bytes: await cachedPdf(source) });
        let progress = { done: created.status !== "ingesting", status: created.status as string };
        while (!progress.done) progress = await ingestNextBatch(db, llm, { sessionId: session!.id, documentId: created.documentId });
        expect(progress.status, `${file} could not be read`).toBe("ready");
        where.set(file, { sessionId: session!.id, runId: run!.id, documentId: created.documentId });
      }
      sessions.push({ sessionId: session!.id, runId: run!.id });
    }

    // Claims: each in the session of its cited PDF, or the first session when it cites no uploaded PDF.
    const claimRows = new Map<string, { claimId: string; sessionId: string; documentId: string | null }>();
    for (const [index, claim] of allClaims.entries()) {
      const file = entryFor(claim.citation)?.file ?? null;
      const home = (file && where.get(file)) || { ...sessions[0]!, documentId: null };
      const [row] = await db<{ id: string }[]>`
        insert into claims (run_id, session_id, position, text, citation_text)
        values (${home.runId}, ${home.sessionId}, ${index + 1}, ${claim.claim}, ${claim.citation}) returning id`;
      claimRows.set(claim.id, { claimId: row!.id, sessionId: home.sessionId, documentId: file ? home.documentId : null });
    }

    // Retrieval: is the passage holding the expected quote among the top passages for the claim (docs/eval.md)?
    const retrievalHit = new Map<string, boolean>();
    for (const claim of allClaims) {
      const row = claimRows.get(claim.id)!;
      if (!claim.expected_quote || !row.documentId) continue;
      const chunks = await retrieveTopChunks(db, {
        sessionId: row.sessionId,
        queryEmbedding: await embedQuery(llm, claim.claim),
        queryText: claim.claim,
        documentIds: [row.documentId],
      });
      retrievalHit.set(claim.id, chunks.some((chunk) => containsQuote(claim.expected_quote!, chunk.content)));
    }

    const outcomes: (Outcome & { exitStage?: number; reason?: string })[] = [];
    for (let run = 1; run <= RUNS; run += 1) {
      const ids = [...claimRows.values()].map((row) => row.claimId);
      await db`delete from verdicts where claim_id in ${db(ids)}`;
      await db`update claims set status = 'pending', attempts = 0 where id in ${db(ids)}`;
      await runPool(allClaims, CONCURRENCY, async (claim) => {
        const row = claimRows.get(claim.id)!;
        const started = Date.now();
        for (let round = 1; round <= MAX_ROUNDS; round += 1) {
          const result = await checkClaim(db, deps, { sessionId: row.sessionId, claimId: row.claimId });
          if (result.outcome === "done") {
            outcomes.push({ id: claim.id, run, verdict: result.verdict.verdict, latencyMs: Date.now() - started, retries: round - 1, exitStage: result.verdict.exitStage, reason: result.verdict.reason, reviewSkipped: result.reviewSkipped === true, quoteRetried: result.quoteRetried === true });
            return;
          }
          await sleep(Math.min(1_000 * result.attempt, 4_000));
        }
        outcomes.push({ id: claim.id, run, verdict: "error", latencyMs: Date.now() - started, retries: MAX_ROUNDS });
      });
    }

    const report = scoreEval(allClaims, outcomes, { includeProposed: INCLUDE_PROPOSED });
    writeResults(report, outcomes, retrievalHit);
    expect(outcomes).toHaveLength(allClaims.length * RUNS);
  });
});

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function writeResults(report: EvalReport, outcomes: (Outcome & { reason?: string })[], retrievalHit: Map<string, boolean>): void {
  mkdirSync(RESULTS, { recursive: true });
  const model = process.env.GEMINI_MODEL ?? "unknown";
  const review = process.env.GEMINI_REVIEW_MODEL || "none";
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // not a git checkout
  }
  const date = new Date().toISOString();
  const stem = `${RESULTS}${date.slice(0, 16).replace(/[:T]/g, "-")}-${model}`;
  const rows = allClaims.map((c) => ({
    id: c.id,
    language: c.language,
    split: c.split,
    status: c.status,
    expected: c.expected_verdict,
    also: c.also_acceptable,
    verdicts: outcomes.filter((o) => o.id === c.id).sort((a, b) => a.run - b.run).map((o) => o.verdict),
    retrievalHit: retrievalHit.get(c.id) ?? null,
    lastReason: outcomes.filter((o) => o.id === c.id).at(-1)?.reason ?? null,
  }));
  writeFileSync(`${stem}.json`, JSON.stringify({ config: { date, commit, model, review, runs: RUNS, includeProposed: INCLUDE_PROPOSED }, report, rows }, null, 2));

  const hits = [...retrievalHit.values()];
  const lines = [
    `# Eval ${date.slice(0, 10)}${report.preview ? " (PREVIEW: includes labels not yet approved)" : ""}`,
    "",
    `Judge \`${model}\`, review \`${review}\`, commit \`${commit}\`, ${report.claims} claims x ${report.runs} runs.${report.notApproved > 0 && !INCLUDE_PROPOSED ? ` ${report.notApproved} claims left out: labels not approved yet.` : ""}`,
    "",
    `| Measure | Result | Bar |`,
    `| --- | --- | --- |`,
    `| Correct verdicts (strict) | ${pct(report.strict)} | at least ${pct(BAR.strict)} |`,
    `| Correct verdicts (lenient) | ${pct(report.lenient)} | |`,
    `| Missed unsupported (called Supported) | ${report.missed.count} of ${report.missed.of} (${pct(report.missed.rate)})${report.missed.ids.length ? `: ${report.missed.ids.join(", ")}` : ""} | at most ${pct(BAR.missed)} |`,
    `| Meets the bar | ${report.meetsBar ? "yes" : "no"} | |`,
    `| Retrieval: expected passage in the top 5 | ${hits.filter(Boolean).length} of ${hits.length} | |`,
    `| Verdict changed between runs | ${report.unstable.length ? report.unstable.join(", ") : "none"} | |`,
    `| Check time p50 / p95 / max | ${(report.latency.p50 / 1000).toFixed(1)} s / ${(report.latency.p95 / 1000).toFixed(1)} s / ${(report.latency.max / 1000).toFixed(1)} s | under 10 s |`,
    `| Checks that never finished | ${report.errors} | |`,
    `| Checks that needed a retry | ${report.retried} of ${report.claims * report.runs} | |`,
    `| Quote not found, judge asked again | ${report.quoteRetried.count}${report.quoteRetried.ids.length ? `: ${report.quoteRetried.ids.join(", ")}` : ""} | |`,
    `| Second look failed (kept Partly supported) | ${report.reviewSkipped.count}${report.reviewSkipped.ids.length ? `: ${report.reviewSkipped.ids.join(", ")}` : ""} | none, or rerun those claims |`,
    "",
    "| Split or language | Claims | Strict | Lenient |",
    "| --- | --- | --- | --- |",
    ...Object.entries({ ...report.bySplit, ...report.byLanguage }).map(([k, r]) => `| ${k} | ${r.n} | ${pct(r.strict)} | ${pct(r.lenient)} |`),
    "",
    "| Expected | Claims | Strict | What it said |",
    "| --- | --- | --- | --- |",
    ...Object.entries(report.byExpected).map(([k, r]) => `| ${k} | ${r.n} | ${pct(r.strict)} | ${Object.entries(r.got).map(([v, n]) => `${v} ${n}`).join(", ")} |`),
    "",
    "| Claim | Lang | Split | Expected | Verdicts per run | Retrieval |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.id} | ${r.language} | ${r.split} | ${r.expected}${r.also.length ? ` (or ${r.also.join(", ")})` : ""} | ${r.verdicts.join(", ")} | ${r.retrievalHit === null ? "-" : r.retrievalHit ? "hit" : "miss"} |`),
  ];
  writeFileSync(`${stem}.md`, `${lines.join("\n")}\n`);
  console.log(`\n${lines.slice(0, 16).join("\n")}\n\nWritten: ${stem}.md and .json`);
}
