// Live check of the second look at a Supported verdict (review.ts) against the REAL review model.
// Skipped unless LIVE=1 (npm run test:live) and GEMINI_REVIEW_MODEL is set. Synthetic claims; passages are short
// quotes from public papers (Ioffe & Szegedy 2015; Lewis et al. 2020).
import { describe, expect, it } from "vitest";
import { createLlm, loadLlmConfig, type Llm } from "../../src/lib/llm/adapter";
import type { JudgePassage } from "../../src/lib/pipeline/judge";
import { reviewVerdict } from "../../src/lib/pipeline/review";
import type { VerifiedJudgment } from "../../src/lib/pipeline/verify-quote";

const live = process.env.LIVE === "1" && Boolean(process.env.GEMINI_REVIEW_MODEL?.trim());

const BN =
  "Batch Normalization allows us to use much higher learning rates and be less careful about initialization. It also acts as a regularizer, in some cases eliminating the need for Dropout. Applied to a state-of-the-art image classification model, Batch Normalization achieves the same accuracy with 14 times fewer training steps, and beats the original model by a significant margin.";
const RAG =
  "We build RAG models where the parametric memory is a pre-trained seq2seq transformer, and the non-parametric memory is a dense vector index of Wikipedia, accessed with a pre-trained neural retriever.";

const asSupported = (chunkId: string, quote: string): VerifiedJudgment => ({ verdict: "supported", quote, page: 1, chunkId, reason: "First check." });
const passages: JudgePassage[] = [
  { chunkId: "bn", pageNumber: 1, content: BN },
  { chunkId: "rag", pageNumber: 2, content: RAG },
];

describe.skipIf(!live)("second look at Supported (live)", () => {
  const llm = live ? createLlm(loadLlmConfig()) : null;

  it("does not let an overstated claim stay Supported, and keeps a true one", async () => {
    const started = Date.now();
    const overstated = await reviewVerdict(llm!, {
      claimText: "Batch Normalization removes the need for Dropout entirely (Ioffe & Szegedy, 2015).",
      citation: "(Ioffe & Szegedy, 2015)",
      verified: asSupported("bn", "It also acts as a regularizer, in some cases eliminating the need for Dropout."),
      passages,
    });
    const reviewMs = Date.now() - started;
    const truthful = await reviewVerdict(llm!, {
      claimText: "RAG combines a pre-trained seq2seq model as parametric memory with a dense vector index of Wikipedia as non-parametric memory (Lewis et al., 2020).",
      citation: "(Lewis et al., 2020)",
      verified: asSupported("rag", RAG),
      passages,
    });
    console.log(`overstated -> ${overstated.verdict} in ${reviewMs} ms (${overstated.reason}); truthful -> ${truthful.verdict}`);
    expect(overstated.verdict).not.toBe("supported");
    expect(overstated.quote).toBe("It also acts as a regularizer, in some cases eliminating the need for Dropout.");
    expect(truthful.verdict).toBe("supported");
  }, 60_000);

  // Invented cases, not eval claims (the eval stays clean for scoring): the line between Contradicted and Partly
  // supported that the first eval of 24 Nov 2026 showed flash-lite getting wrong. Both verdicts start as "partial".
  it("separates a Contradicted claim from a Partly supported one", async () => {
    const cases = [
      { name: "wrong number", claim: "The trial enrolled 400 patients.", passage: "The trial enrolled 300 patients at 12 hospitals.", want: "contradicted" },
      { name: "reversed effect", claim: "Chronic stress had no effect on memory scores.", passage: "Chronic stress lowered memory scores in all three age groups.", want: "contradicted" },
      { name: "right number, wrong group", claim: "Treatment A cured 60% of patients.", passage: "Treatment B cured 60% of patients. Treatment A cured 20%.", want: "contradicted" },
      { name: "one wrong detail beside right ones", claim: "The trial enrolled 300 patients and ran for two years.", passage: "The trial enrolled 300 patients and ran for one year.", want: "partial" },
      { name: "overstated amount", claim: "The drug works for all patients.", passage: "The drug works for most patients.", want: "partial" },
      { name: "extra detail not in the source", claim: "The survey of 300 people was run online.", passage: "The survey had 300 respondents across three regions.", want: "partial" },
      // Mixed claims (24 Nov 2026): one point right, another wrong or reversed. Invented, with different subjects from
      // the eval claims that showed the problem.
      { name: "two figures, one wrong", claim: "The cohort had 500 smokers and 90 non-smokers.", passage: "The cohort had 500 smokers and 120 non-smokers.", want: "partial" },
      { name: "right fact, reversed side clause", claim: "The robot reached 4 km/h, although it tipped over on slopes.", passage: "The robot reached 4 km/h. It did not tip over on slopes.", want: "partial" },
      { name: "single point reversed", claim: "Sleep loss had no effect on reaction time in adults.", passage: "Sleep loss slowed reaction time in adults.", want: "contradicted" },
    ];
    // reviewVerdict keeps Partly supported when its review fails, so a model outage would look like a model answer.
    // Record every failure and insist there were none before reading the results (found when credits ran out).
    const failures: string[] = [];
    const watched: Llm = {
      reviewAvailable: llm!.reviewAvailable,
      embed: (texts, task) => llm!.embed(texts, task),
      generateJson: async (request) => {
        try {
          return await llm!.generateJson(request);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    };
    const rows: string[] = [];
    let right = 0;
    for (const c of cases) {
      const started = Date.now();
      const result = await reviewVerdict(watched, {
        claimText: c.claim,
        citation: null,
        verified: { verdict: "partial", quote: c.passage, page: 1, chunkId: "p", reason: "First check." },
        passages: [{ chunkId: "p", pageNumber: 1, content: c.passage }],
      });
      if (result.verdict === c.want) right += 1;
      rows.push(`${result.verdict === c.want ? "ok  " : "DIFF"} ${c.name.padEnd(34)} want ${c.want.padEnd(12)} got ${result.verdict.padEnd(12)} ${Date.now() - started} ms`);
    }
    console.log(rows.join("\n"));
    expect(failures, "the model failed, so these results say nothing about the prompt").toEqual([]);
    expect(right).toBeGreaterThanOrEqual(cases.length - 1);
  }, 120_000);

  it("catches a wrong number in code, then the review calls it Contradicted", async () => {
    const result = await reviewVerdict(llm!, {
      claimText: "Batch Normalization reaches the same accuracy with 41 times fewer training steps (Ioffe & Szegedy, 2015).",
      citation: "(Ioffe & Szegedy, 2015)",
      verified: asSupported("bn", "Batch Normalization achieves the same accuracy with 14 times fewer training steps"),
      passages,
    });
    expect(result.verdict).toBe("contradicted");
  }, 30_000);
});
