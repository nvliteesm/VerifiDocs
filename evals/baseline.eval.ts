// Baseline 1 of docs/eval.md: the same model, the same judge prompt, but the WHOLE cited source in context and no
// retrieval. Run it after `npm run eval`: it compares itself with the newest product result in evals/results/.
//
//   npx vitest run --config vitest.eval.config.ts evals/baseline.eval.ts
//
// What it isolates: what retrieval adds. The baseline judge sees every page of the cited PDF (one passage per page);
// the product judge sees the top retrieved passages. Everything else is the same code path: getLlm(), the judge
// prompt and schema from the app, and (reported separately) the quote check.
//
// Scope: only claims whose label is supported, partial, contradicted or not_in_sources and whose citation points at
// an uploaded PDF. The other verdicts (Reference not found, Can't check, No citation given) come from stages that
// run before any source is read, which a plain "paste the source" baseline does not have, so they are not compared.
// The product is scored on exactly the same claims. NotebookLM and CekSitasi (docs/eval.md baselines 2 and 3) need a
// human at their web pages and are not run here.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { runPool } from "../src/lib/client/pool";
import { getLlm } from "../src/lib/llm/adapter";
import { buildJudgePrompt, judgeSchema, JUDGE_SYSTEM_PROMPT, type JudgePassage } from "../src/lib/pipeline/judge";
import { containsQuote } from "../src/lib/rag/normalize";
import { scoreEval, type EvalClaim, type Outcome } from "./score";

const DIR = new URL(".", import.meta.url).pathname;
const CACHE = `${DIR}.cache/`;
const RESULTS = `${DIR}results/`;
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS ?? 3));
const CHECKED = new Set(["supported", "partial", "contradicted", "not_in_sources"]);

interface Entry { key: string; file: string | null }
interface Source { file: string; url: string }
const read = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, "utf8")) as T;
const entries = read<{ entries: Entry[] }>("bibliography.json").entries;
const sources = read<{ sources: Source[] }>("sources.json").sources;
const claims = read<{ claims: EvalClaim[] }>("claims.json").claims.filter((c) => c.status === "approved");

function entryFor(citation: string | null): Entry | null {
  const match = citation ? /(\p{Lu}[\p{L}'-]+)\b.*?\b((?:19|20)\d{2})/u.exec(citation) : null;
  return match ? entries.find((e) => e.key === `${match[1]!.toLowerCase()}${match[2]}`) ?? null : null;
}

function pdfPath(file: string): string {
  mkdirSync(CACHE, { recursive: true });
  const path = `${CACHE}${file}`;
  if (!existsSync(path)) {
    const source = sources.find((s) => s.file === file)!;
    execFileSync("curl", ["--silent", "--show-error", "--location", "--fail", "--user-agent", "VerifiDocs-eval/0.1", "--output", path, source.url]);
  }
  return path;
}

/** Every page of the PDF as one passage, in the shape the product judge prompt expects. */
async function pagesOf(file: string): Promise<JudgePassage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPath(file))));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((content, index) => ({ chunkId: `page-${index + 1}`, pageNumber: index + 1, content })).filter((p) => p.content.trim().length > 0);
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

describe("baseline: whole source in context, no retrieval", () => {
  it("judges every source-checkable claim and compares with the product", async () => {
    const llm = getLlm();
    const subset = claims.filter((c) => CHECKED.has(c.expected_verdict) && entryFor(c.citation)?.file);
    const pages = new Map<string, JudgePassage[]>();
    for (const file of new Set(subset.map((c) => entryFor(c.citation)!.file!))) pages.set(file, await pagesOf(file));

    const raw: (Outcome & { quoteInSource: boolean })[] = [];
    for (let run = 1; run <= RUNS; run += 1) {
      await runPool(subset, 5, async (claim) => {
        const passages = pages.get(entryFor(claim.citation)!.file!)!;
        const started = Date.now();
        try {
          const judged = await llm.generateJson({ prompt: buildJudgePrompt(claim.claim, passages), system: JUDGE_SYSTEM_PROMPT, schema: judgeSchema, maxOutputTokens: 2048 });
          const wholeText = passages.map((p) => p.content).join("\n");
          const quoteInSource = judged.quote ? containsQuote(judged.quote, wholeText) : false;
          raw.push({ id: claim.id, run, verdict: judged.verdict, latencyMs: Date.now() - started, retries: 0, quoteInSource });
        } catch {
          raw.push({ id: claim.id, run, verdict: "error", latencyMs: Date.now() - started, retries: 0, quoteInSource: false });
        }
      });
    }
    // The product's hard rule 1, applied to the baseline for comparison: a verdict that cites a quote not in the source becomes Can't tell.
    const gated = raw.map((o) => (o.verdict !== "not_in_sources" && o.verdict !== "cant_tell" && o.verdict !== "error" && !o.quoteInSource ? { ...o, verdict: "cant_tell" } : o));
    const baselineRaw = scoreEval(subset, raw);
    const baselineGated = scoreEval(subset, gated);

    // The newest product result (written by `npm run eval`), restricted to the same claims.
    const latest = readdirSync(RESULTS).filter((f) => f.endsWith(".json") && !f.includes("baseline")).sort().at(-1);
    const product = latest ? (JSON.parse(readFileSync(`${RESULTS}${latest}`, "utf8")) as { config: { model: string; commit: string; date: string }; rows: { id: string; verdicts: string[] }[] }) : null;
    const ids = new Set(subset.map((c) => c.id));
    const productOutcomes: Outcome[] = (product?.rows ?? []).filter((r) => ids.has(r.id)).flatMap((r) => r.verdicts.map((verdict, i) => ({ id: r.id, run: i + 1, verdict, latencyMs: 0, retries: 0 })));
    const productScore = product ? scoreEval(subset, productOutcomes) : null;

    mkdirSync(RESULTS, { recursive: true });
    const date = new Date().toISOString();
    const stem = `${RESULTS}${date.slice(0, 16).replace(/[:T]/g, "-")}-baseline-fullcontext`;
    const model = process.env.GEMINI_MODEL ?? "unknown";
    const quoted = raw.filter((o) => o.verdict !== "not_in_sources" && o.verdict !== "cant_tell" && o.verdict !== "error");
    const quoteBad = quoted.filter((o) => !o.quoteInSource).length;
    const row = (name: string, r: ReturnType<typeof scoreEval> | null) =>
      r ? `| ${name} | ${pct(r.strict)} | ${pct(r.lenient)} | ${r.missed.count} of ${r.missed.of} (${pct(r.missed.rate)}) | ${r.errors} |` : `| ${name} | no product result found | | | |`;
    const lines = [
      `# Baseline: whole source in context, no retrieval (${date.slice(0, 10)})`,
      "",
      `Same judge model \`${model}\`, same judge prompt. ${subset.length} claims whose label is supported, partial, contradicted or not in sources and whose citation points at an uploaded PDF, ${RUNS} runs each. The product column is \`${product?.config.model ?? "n/a"}\` from \`${latest ?? "n/a"}\`, scored on the same claims. The baseline judge sees every page of the PDF; it has no retrieval, no second-model review, no fix step.`,
      "",
      "| System | Strict | Lenient | Missed unsupported (called Supported) | Checks that failed |",
      "| --- | --- | --- | --- | --- |",
      row("Baseline, as the model answered", baselineRaw),
      row("Baseline, with the product's quote check applied", baselineGated),
      row("VerifiDocs (retrieval + review + quote check)", productScore),
      "",
      `Quotes the baseline gave (for a verdict that cites one) that are NOT in the source text: ${quoteBad} of ${quoted.length}. In the product these can never be shown (hard rule 1).`,
      "",
      "Not run: NotebookLM and CekSitasi (docs/eval.md baselines 2 and 3; they need a person at their web pages). The three verdicts decided before a source is read are not compared. The product's results were not produced by this script; they come from the file named above.",
    ];
    writeFileSync(`${stem}.md`, `${lines.join("\n")}\n`);
    writeFileSync(`${stem}.json`, JSON.stringify({ config: { date, model, runs: RUNS, claims: subset.length, productFile: latest ?? null }, baselineRaw, baselineGated, product: productScore, quoteNotInSource: { bad: quoteBad, of: quoted.length } }, null, 2));
    console.log(`\n${lines.join("\n")}\n\nWritten: ${stem}.md`);
    expect(raw).toHaveLength(subset.length * RUNS);
  });
});
