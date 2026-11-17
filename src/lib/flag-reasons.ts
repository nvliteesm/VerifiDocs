// Why a student says a verdict is wrong. A fixed list: the screen offers these as buttons, never a text box, so
// nothing from the draft or the source can travel in the event (hard rule 11). No imports, so the browser can use
// it without bundling the server's event code.
export const FLAG_REASONS = [
  "quote_does_not_support",
  "wrong_page",
  "source_says_otherwise",
  "claim_misread",
  "source_was_uploaded",
  "other",
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export const FLAG_REASON_LABELS: Record<FlagReason, string> = {
  quote_does_not_support: "The quote does not support this",
  wrong_page: "It is on a different page",
  source_says_otherwise: "The source says something else",
  claim_misread: "It misread my claim",
  source_was_uploaded: "I already uploaded this source",
  other: "Something else",
};
