"use client";

// The claim list at the top of the review column: every claim, grouped by verdict with the most serious group first,
// each group headed by its icon, name and count. A row is the status icon, the claim's tag, its sentence on one line,
// and the page. Selecting a row selects the claim in the draft and below.
import type { ClaimView, Verdict } from "@/lib/client/types";
import { SUMMARY_ORDER, verdictLabel } from "@/lib/client/verdict-info";
import { VerdictIcon } from "./claim-bits";
import { useT } from "./LocaleProvider";

interface Props {
  /** The claims to list (the left rail's filter has already been applied). */
  claims: readonly ClaimView[];
  labels: ReadonlyMap<string, string>;
  activeId: string | null;
  /** Claims the student has applied a fix to or ignored: shown as done. */
  resolved: ReadonlySet<string>;
  onSelect: (claimId: string) => void;
}

export function ClaimList({ claims, labels, activeId, resolved, onSelect }: Props) {
  const { t } = useT();
  if (claims.length === 0) return <p className="empty review-empty">{t("ws.list.empty")}</p>;

  const groups: { key: string; verdict: Verdict | null; items: ClaimView[] }[] = [];
  for (const verdict of SUMMARY_ORDER) {
    const items = claims.filter((claim) => claim.verdict === verdict).sort((a, b) => a.position - b.position);
    if (items.length > 0) groups.push({ key: verdict, verdict, items });
  }
  const waiting = claims.filter((claim) => claim.verdict === null).sort((a, b) => a.position - b.position);
  if (waiting.length > 0) groups.push({ key: "waiting", verdict: null, items: waiting });

  return (
    <div className="claim-list">
      {groups.map((group) => (
        <section key={group.key} className={`cl-group v-${group.verdict ?? "waiting"}`} aria-label={group.verdict ? verdictLabel(t, group.verdict) : t("ws.f.waiting")}>
          <h3 className="cl-head">
            {group.verdict ? <VerdictIcon verdict={group.verdict} size={14} /> : null}
            <span className="cl-name">{group.verdict ? verdictLabel(t, group.verdict) : t("ws.f.waiting")}</span>
            <span className="mono cl-count">{group.items.length}</span>
          </h3>
          <ul className="cl-rows">
            {group.items.map((claim) => (
              <li key={claim.id}>
                <button type="button" className={`cl-row${resolved.has(claim.id) ? " cl-done" : ""}`} aria-current={activeId === claim.id ? "true" : undefined} onClick={() => onSelect(claim.id)}>
                  <span className="cl-icon">{claim.verdict ? <VerdictIcon verdict={claim.verdict} size={16} /> : null}</span>
                  <span className="mono cl-id">{labels.get(claim.id) ?? ""}</span>
                  <span className="cl-text">{claim.text}</span>
                  <span className="mono cl-page">{claim.page !== null ? t("ws.page", { n: claim.page }) : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
