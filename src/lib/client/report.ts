// The plain-text report a student can copy: the claims that need attention first, most serious first, each with
// the evidence and a suggested rewrite where there is one, then the supported claims. It is the student's own
// text going to their own clipboard; nothing here is sent anywhere.
// It is written in the language of the screen (English when no translator is given).
import { pluralKey, translatorFor, type Locale, type Translate } from "../i18n";
import { localizeReason } from "../i18n/reasons";
import type { ClaimView } from "./types";
import { verdictLabel } from "./verdict-info";

export function buildReport(claims: ClaimView[], fixList: string[], t: Translate = translatorFor("en"), locale: Locale = "en"): string {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const attention = fixList.map((id) => byId.get(id)).filter((claim): claim is ClaimView => claim !== undefined);
  const supported = claims.filter((claim) => claim.verdict === "supported");
  const unchecked = claims.filter((claim) => claim.verdict === null).length;
  const checked = claims.length - unchecked;

  const lines: string[] = [t("report.title"), ""];
  lines.push(
    t(pluralKey(locale, "report.summary", checked), {
      n: checked,
      attention: attention.length,
      needs: t(pluralKey(locale, "report.needs", attention.length)),
      supported: supported.length,
    }) + (unchecked > 0 ? ` ${t(pluralKey(locale, "report.unchecked", unchecked), { n: unchecked })}` : ""),
  );

  if (attention.length > 0) {
    lines.push("", t("report.attention"));
    attention.forEach((claim, index) => {
      lines.push("", `${index + 1}. [${verdictLabel(t, claim.verdict!)}] ${claim.text}`);
      if (claim.citation) lines.push(`   ${t("report.citation", { citation: claim.citation })}`);
      if (claim.citationSource === "found") lines.push(`   ${t("report.found")}`);
      if (claim.quote) {
        lines.push(`   ${claim.page !== null ? t("report.saysPage", { page: claim.page, quote: claim.quote }) : t("report.says", { quote: claim.quote })}`);
      }
      if (claim.reason) lines.push(`   ${t("report.why", { reason: localizeReason(claim.reason, t) })}`);
      if (claim.fixSuggestion) lines.push(`   ${t("report.rewrite", { sentence: claim.fixSuggestion })}`);
      for (const note of claim.yearNotes ?? []) lines.push(`   ${t("claim.year", { cited: note.cited, published: note.published })}`);
    });
  }

  if (supported.length > 0) {
    lines.push("", t("report.supported"));
    for (const claim of supported) {
      lines.push(`- ${claim.text}${claim.page !== null ? ` ${t("report.page", { page: claim.page })}` : ""}`);
      if (claim.citationSource === "found") lines.push(`  ${t("report.found")}`);
      for (const note of claim.yearNotes ?? []) lines.push(`  ${t("claim.year", { cited: note.cited, published: note.published })}`);
    }
  }

  return lines.join("\n");
}
