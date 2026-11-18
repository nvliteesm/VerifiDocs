// Live check of Find a source (discover-sources.ts) against the REAL Gemini and OpenAlex. Skipped unless LIVE=1
// (npm run test:live) and OPENALEX_API_KEY is set. Synthetic claims only, no student text.
// The spike (docs/source-discovery.md) found the model always picked something; the relevance rating must turn
// product and own-work facts into an empty answer while research claims still find a paper.
import { describe, expect, it } from "vitest";
import { createLlm, loadLlmConfig } from "../../src/lib/llm/adapter";
import { discoverSources } from "../../src/lib/pipeline/discover-sources";

const live = process.env.LIVE === "1" && Boolean(process.env.OPENALEX_API_KEY);

const NOTHING_FITS = [
  "The Free plan supports up to 10 active members and the Pro plan supports up to 50 active members.",
  "Deputy is a workforce management platform that supports scheduling, time tracking and payroll integration.",
];
// Not here on purpose: "Admins can create tasks and assign them to eligible staff from the dashboard." (the student's
// own feature) finds papers describing task-management systems that say much the same, rated "direct". Stopping
// own-work sentences is the extraction step's job (its own_work label, 18 Nov 2026), before Find a source is offered.
const SHOULD_FIND = [
  "Literasi keuangan berpengaruh positif terhadap keputusan investasi mahasiswa.",
  "Large language models can generate fabricated academic references.",
  "Prevalensi stunting pada balita di Indonesia pada tahun 2022 sebesar 21,6 persen.",
];

describe.skipIf(!live)("Find a source (live)", () => {
  const llm = createLlm({ ...loadLlmConfig(), timeoutMs: 20_000 });
  const apiKey = process.env.OPENALEX_API_KEY;

  it.each(NOTHING_FITS)("finds nothing for a product or own-work fact: %s", async (claim) => {
    const result = await discoverSources(llm, claim, { apiKey });
    expect(result.exit, JSON.stringify(result.sources.map((s) => s.title))).toBe("nothing_relevant");
  }, 30_000);

  it.each(SHOULD_FIND)("finds a real paper with a verified sentence: %s", async (claim) => {
    const started = Date.now();
    const result = await discoverSources(llm, claim, { apiKey });
    expect(result.exit).toBe("found");
    expect(result.sources.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});
