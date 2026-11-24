// Live check of the second look at a Supported verdict (review.ts) against the REAL review model.
// Skipped unless LIVE=1 (npm run test:live) and GEMINI_REVIEW_MODEL is set. Synthetic claims; passages are short
// quotes from public papers (Ioffe & Szegedy 2015; Lewis et al. 2020).
import { describe, expect, it } from "vitest";
import { createLlm, loadLlmConfig } from "../../src/lib/llm/adapter";
import type { JudgePassage } from "../../src/lib/pipeline/judge";
import { reviewSupported } from "../../src/lib/pipeline/review";
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
    const overstated = await reviewSupported(llm!, {
      claimText: "Batch Normalization removes the need for Dropout entirely (Ioffe & Szegedy, 2015).",
      citation: "(Ioffe & Szegedy, 2015)",
      verified: asSupported("bn", "It also acts as a regularizer, in some cases eliminating the need for Dropout."),
      passages,
    });
    const reviewMs = Date.now() - started;
    const truthful = await reviewSupported(llm!, {
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

  it("catches a wrong number in code, before any model call", async () => {
    const result = await reviewSupported(llm!, {
      claimText: "Batch Normalization reaches the same accuracy with 41 times fewer training steps (Ioffe & Szegedy, 2015).",
      citation: "(Ioffe & Szegedy, 2015)",
      verified: asSupported("bn", "Batch Normalization achieves the same accuracy with 14 times fewer training steps"),
      passages,
    });
    expect(result).toMatchObject({ verdict: "partial", reason: "The source passage does not show 41 from your sentence." });
  }, 30_000);
});
