"use client";

// The right-hand pane, Fix list tab: the claims that still need work, most serious first. Each row says what to do in
// a few words, names the verdict, and jumps to that claim.
import type { ClaimView } from "@/lib/client/types";
import { verdictAdvice } from "@/lib/client/verdict-info";
import { numberChange } from "@/lib/client/working-draft";
import { Badge } from "./claim-bits";
import { useT } from "./LocaleProvider";

interface Props {
  /** The open issues, already ranked. */
  claims: readonly ClaimView[];
  labels: ReadonlyMap<string, string>;
  onPick: (claimId: string) => void;
}

export function FixList({ claims, labels, onPick }: Props) {
  const { t } = useT();
  if (claims.length === 0) return <p className="empty">{t("ws.fixlist.empty")}</p>;
  return (
    <div className="fixlist">
      <p className="hint fixlist-note">{t("ws.fixlist.note")}</p>
      <ol className="fixlist-rows">
        {claims.map((claim, index) => {
          const change = claim.fixSuggestion ? numberChange(claim.text, claim.fixSuggestion) : null;
          return (
            <li key={claim.id}>
              <button type="button" className="fixrow" onClick={() => onPick(claim.id)}>
                <span className="mono fixrow-n">{index + 1}</span>
                <span className="fixrow-main">
                  <span className="fixrow-action">{change ? t("ws.fix.change", { from: change.from, to: change.to }) : verdictAdvice(t, claim.verdict!)}</span>
                  <Badge verdict={claim.verdict!} />
                </span>
                <span className="mono fixrow-id">{labels.get(claim.id) ?? ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
