// Shared types for the fixed pipeline of typed stages (docs/architecture.md).
// The verdict values match the `verdict` check constraint in db/migrations/0001_init.sql
// and the eight verdicts in docs/verdicts.md.

export const VERDICTS = [
  "supported",
  "partial",
  "contradicted",
  "not_in_sources",
  "cant_tell",
  "reference_not_found",
  "cant_check",
  "no_citation_given",
] as const;

export type Verdict = (typeof VERDICTS)[number];

/** Verdicts produced before the judge runs (stages 2 to 4). They are real verdicts, not errors. */
export type PreJudgeVerdict = "no_citation_given" | "reference_not_found" | "cant_check";

/** Stage numbers as in the architecture table. They match `verdicts.exit_stage` (2 to 9). */
export type ExitStage = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** A claim that ends early with a verdict, and why. Every stage records an exit reason. */
export interface StageExit {
  verdict: PreJudgeVerdict | "cant_tell";
  exitStage: ExitStage;
  /** One plain sentence. Stored on the verdict row. Never put in an analytics event. */
  reason: string;
}
