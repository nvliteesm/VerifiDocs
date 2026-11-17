// The plain-text report a student can copy: the claims that need attention first, most serious first, each with
// the evidence and a suggested rewrite where there is one, then the supported claims. It is the student's own
// text going to their own clipboard; nothing here is sent anywhere.
import type { ClaimView } from "./types";
import { VERDICT_INFO } from "./verdict-info";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function buildReport(claims: ClaimView[], fixList: string[]): string {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const attention = fixList.map((id) => byId.get(id)).filter((claim): claim is ClaimView => claim !== undefined);
  const supported = claims.filter((claim) => claim.verdict === "supported");
  const unchecked = claims.filter((claim) => claim.verdict === null).length;

  const lines: string[] = ["VerifiDocs report", ""];
  lines.push(
    `${plural(claims.length - unchecked, "claim")} checked: ${attention.length} need${attention.length === 1 ? "s" : ""} attention, ` +
      `${supported.length} supported.` + (unchecked > 0 ? ` ${plural(unchecked, "claim")} not checked yet.` : ""),
  );

  if (attention.length > 0) {
    lines.push("", "NEEDS ATTENTION");
    attention.forEach((claim, index) => {
      const info = VERDICT_INFO[claim.verdict!];
      lines.push("", `${index + 1}. [${info.label}] ${claim.text}`);
      if (claim.citation) lines.push(`   Citation: ${claim.citation}`);
      if (claim.quote) lines.push(`   Your source says${claim.page !== null ? ` (page ${claim.page})` : ""}: "${claim.quote}"`);
      if (claim.reason) lines.push(`   Why: ${claim.reason}`);
      if (claim.fixSuggestion) lines.push(`   Suggested rewrite: ${claim.fixSuggestion}`);
    });
  }

  if (supported.length > 0) {
    lines.push("", "SUPPORTED");
    for (const claim of supported) lines.push(`- ${claim.text}${claim.page !== null ? ` (page ${claim.page})` : ""}`);
  }

  return lines.join("\n");
}
