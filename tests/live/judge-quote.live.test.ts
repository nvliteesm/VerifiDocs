// Live check of the judge's quote (stage 7 to 8) against the real model. Skipped unless LIVE=1.
//
// E21 of the eval (24 Nov 2026): the source sentence began mid-way ("... tasks and set the state of the art ..."), the
// judge copied it as "We set the state of the art ...", and the quote check rightly abstained (Can't tell). Every case
// here is invented, with a deciding sentence that starts after "and", "which", "but" or "found that", and with PDF-style
// hard line breaks. A verdict counts only if its quote verified: the judge must copy, not tidy.
import { describe, expect, it } from "vitest";
import { createLlm, loadLlmConfig } from "../../src/lib/llm/adapter";
import { judgeClaim, type JudgePassage } from "../../src/lib/pipeline/judge";
import { verifyJudgment } from "../../src/lib/pipeline/verify-quote";
import { normalizeText } from "../../src/lib/rag/normalize";

const live = process.env.LIVE === "1";

// Chunks are stored normalized (one normalization for stored text and the quote check), so the judge sees the
// normalized text: line breaks gone, and a hyphen at a line end rejoined ("language-\nunderstanding" reads
// "languageunderstanding"). The test shows the judge the same text.
const passage = (content: string, pageNumber = 1): JudgePassage[] => [
  { chunkId: "a", pageNumber, content: normalizeText(content) },
  { chunkId: "b", pageNumber: pageNumber + 1, content: "Funding came from a national research council. The authors declare no competing interests." },
];

const cases: { name: string; claim: string; passages: JudgePassage[]; want: string[] }[] = [
  {
    name: "after 'found that'",
    claim: "Mobile banking use rose from 12% to 31% between 2018 and 2022 (Hart, 2023).",
    passages: passage(
      "The survey covered rural households in three provinces and found that mobile\nbanking use rose from 12% to 31% between 2018 and 2022, driven mainly by cheaper\nsmartphones.",
    ),
    want: ["supported"],
  },
  {
    name: "after 'and'",
    claim: "Volunteers were randomly assigned to sleep either six or nine hours per night (Okoro, 2021).",
    passages: passage(
      "Researchers enrolled 120 volunteers, and randomly assigned them to two groups that\nslept either six or nine hours per night for two weeks.",
    ),
    want: ["supported"],
  },
  {
    name: "after 'but'",
    claim: "The new alloy costs roughly four times as much (Varga, 2020).",
    passages: passage(
      "The new alloy is lighter than steel, which makes it attractive for aircraft, but it\ncosts roughly four times as much.",
    ),
    want: ["supported"],
  },
  {
    name: "Indonesian claim, English passage",
    claim: "Pemerintah daerah menghabiskan sebagian besar dana untuk perbaikan jalan (Santoso, 2022).",
    passages: passage(
      "Local governments received the funds in March, and spent most of them on road repairs\nbefore the end of the year.",
    ),
    want: ["supported"],
  },
  // Abstract-style: a long sentence whose subject is "We", the deciding words in its second half, and a trailing list.
  {
    name: "abstract: 'We ... and set a record'",
    claim: "The models set a new record on four reading comprehension tasks (Kim, 2021).",
    passages: passage(
      "We train our models on a broad set of language-\nunderstanding benchmarks and set a new record on four reading comprehension tasks,\noutperforming earlier neural readers and feature-based pipelines. For translation\ntasks, we find that outputs are more fluent than those of a statistical baseline.",
    ),
    want: ["supported"],
  },
  {
    name: "abstract: 'We ... and show that'",
    claim: "Pruning half of the weights leaves accuracy almost unchanged (Mbeki, 2022).",
    passages: passage(
      "We study compression of image classifiers and show that pruning half of the weights\nleaves accuracy almost unchanged, while a further 30% pruning costs two points of top-1\naccuracy on the validation set.",
    ),
    want: ["supported"],
  },
  {
    name: "abstract: 'We ... and achieve'",
    claim: "Transfer from a larger corpus achieved lower error on three speech benchmarks (Ito, 2020).",
    passages: passage(
      "We pre-train acoustic models on thousands of hours of untranscribed audio and achieve\nlower error on three speech benchmarks, matching systems trained with ten times more\nlabelled data.",
    ),
    want: ["supported"],
  },
  {
    name: "sentence starts at its first word",
    claim: "The trial enrolled 300 patients (Ng, 2020).",
    passages: passage("The trial enrolled 300 patients at 12 hospitals."),
    want: ["supported"],
  },
  {
    name: "wrong detail, mid-sentence start",
    claim: "The programme reached about 4,000 students in five districts (Lund, 2019).",
    passages: passage(
      "The programme ran in two districts and reached about 4,000 students, although\nattendance fell in the second year.",
    ),
    want: ["partial", "contradicted"],
  },
];

describe.skipIf(!live)("the judge copies its quote exactly (live)", () => {
  it("quotes from the middle of a sentence without adding or changing words", async () => {
    const llm = createLlm(loadLlmConfig());
    const rows: string[] = [];
    let verified = 0;
    let right = 0;
    for (const c of cases) {
      const raw = await judgeClaim(llm, c.claim, c.passages);
      const result = verifyJudgment(raw, c.passages);
      const quoteOk = !result.downgradedFrom && result.quote !== null;
      if (quoteOk) verified += 1;
      if (c.want.includes(result.verdict)) right += 1;
      rows.push(
        `${quoteOk ? "ok  " : "DIFF"} ${c.name.padEnd(36)} judge ${raw.verdict.padEnd(15)} saved ${result.verdict.padEnd(11)}` +
          `${quoteOk ? "" : ` quote: ${JSON.stringify(raw.quote)}`}`,
      );
    }
    console.log(`${rows.join("\n")}\nquotes verified ${verified}/${cases.length}, verdicts right ${right}/${cases.length}`);
    expect(verified).toBeGreaterThanOrEqual(cases.length - 1);
    expect(right).toBeGreaterThanOrEqual(cases.length - 1);
  }, 300_000);
});
