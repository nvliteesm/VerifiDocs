"use client";

// "Filter by verdict" in the left pane: one toggle per verdict that is present, with its icon and a count. The icon
// and the word carry the meaning; the colour is the same one the verdict has everywhere else.
import type { Severity } from "@/lib/client/findings";
import type { Verdict } from "@/lib/client/types";
import { verdictLabel } from "@/lib/client/verdict-info";
import { VerdictIcon } from "./claim-bits";
import { useT } from "./LocaleProvider";

export type Filter = "all" | "waiting" | Verdict;

/** The order the design lists the verdicts in. */
export const FILTER_ORDER: readonly Verdict[] = ["supported", "partial", "contradicted", "not_in_sources", "cant_tell", "reference_not_found", "cant_check", "no_citation_given"];

const LIST = "M5 7h14 M5 12h14 M5 17h14";
const CLOCK = "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16z M12 8v4l3 2";

export type SeverityFilter = "all" | Severity;

interface Props {
  counts: Record<Filter, number>;
  value: Filter;
  onChange: (filter: Filter) => void;
  /** Filter by how much a finding matters, and by the section of the draft it sits in. Both optional. */
  severity?: SeverityFilter;
  onSeverity?: (severity: SeverityFilter) => void;
  sections?: readonly string[];
  section?: string;
  onSection?: (section: string) => void;
}

function Plain({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

export function ClaimFilters({ counts, value, onChange, severity = "all", onSeverity, sections = [], section = "", onSection }: Props) {
  const { t } = useT();
  const row = (filter: Filter, icon: React.ReactNode, label: string, tone: string) => (
    <button key={filter} type="button" className={`filter ${tone}`} aria-pressed={value === filter} onClick={() => onChange(filter)}>
      <span className="filter-icon">{icon}</span>
      <span className="filter-label">{label}</span>
      <span className="mono filter-count">{counts[filter]}</span>
    </button>
  );
  return (
    <>
      <div className="filters" role="group" aria-label={t("filter.group")}>
        {row("all", <Plain path={LIST} />, t("ws.f.all"), "")}
        {FILTER_ORDER.filter((verdict) => counts[verdict] > 0).map((verdict) => row(verdict, <VerdictIcon verdict={verdict} />, verdictLabel(t, verdict), `v-${verdict}`))}
        {counts.waiting > 0 && row("waiting", <Plain path={CLOCK} />, t("ws.f.waiting"), "v-waiting")}
      </div>
      {onSeverity && (
        <div className="filters filters-row" role="group" aria-label={t("sev.group")}>
          {(["all", "high", "medium", "low"] as const).map((level) => (
            <button key={level} type="button" className="chip" aria-pressed={severity === level} onClick={() => onSeverity(level)}>
              {level === "all" ? t("sev.all") : t(`sev.${level}` as const)}
            </button>
          ))}
        </div>
      )}
      {onSection && sections.length > 0 && (
        <div className="field">
          <label htmlFor="filter-section">{t("filter.section")}</label>
          <select id="filter-section" value={section} onChange={(event) => onSection(event.target.value)}>
            <option value="">{t("filter.sectionAll")}</option>
            {sections.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
