"use client";

// "Filter by verdict" in the left pane: one toggle per verdict that is present, with its icon and a count. The icon
// and the word carry the meaning; the colour is the same one the verdict has everywhere else.
import type { Verdict } from "@/lib/client/types";
import { verdictLabel } from "@/lib/client/verdict-info";
import { VerdictIcon } from "./claim-bits";
import { useT } from "./LocaleProvider";

export type Filter = "all" | "waiting" | Verdict;

/** The order the design lists the verdicts in. */
export const FILTER_ORDER: readonly Verdict[] = ["supported", "partial", "contradicted", "not_in_sources", "cant_tell", "reference_not_found", "cant_check", "no_citation_given"];

const LIST = "M5 7h14 M5 12h14 M5 17h14";
const CLOCK = "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16z M12 8v4l3 2";

interface Props {
  counts: Record<Filter, number>;
  value: Filter;
  onChange: (filter: Filter) => void;
}

function Plain({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

export function ClaimFilters({ counts, value, onChange }: Props) {
  const { t } = useT();
  const row = (filter: Filter, icon: React.ReactNode, label: string, tone: string) => (
    <button key={filter} type="button" className={`filter ${tone}`} aria-pressed={value === filter} onClick={() => onChange(filter)}>
      <span className="filter-icon">{icon}</span>
      <span className="filter-label">{label}</span>
      <span className="mono filter-count">{counts[filter]}</span>
    </button>
  );
  return (
    <div className="filters" role="group" aria-label={t("filter.group")}>
      {row("all", <Plain path={LIST} />, t("ws.f.all"), "")}
      {FILTER_ORDER.filter((verdict) => counts[verdict] > 0).map((verdict) => row(verdict, <VerdictIcon verdict={verdict} />, verdictLabel(t, verdict), `v-${verdict}`))}
      {counts.waiting > 0 && row("waiting", <Plain path={CLOCK} />, t("ws.f.waiting"), "v-waiting")}
    </div>
  );
}
