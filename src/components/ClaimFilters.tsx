"use client";

// The status filters in the left pane. Each is a toggle button with a count. The coloured dot is decoration: the
// words carry the meaning, and the same colours underline the claims in the draft.
import type { ClaimGroup } from "@/lib/client/working-draft";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "./LocaleProvider";

export type Filter = "all" | ClaimGroup;

const ORDER: readonly Filter[] = ["all", "fix", "source", "ok", "waiting"];

interface Props {
  counts: Record<Filter, number>;
  value: Filter;
  onChange: (filter: Filter) => void;
}

export function ClaimFilters({ counts, value, onChange }: Props) {
  const { t } = useT();
  return (
    <div className="filters" role="group" aria-label={t("filter.group")}>
      {ORDER.filter((filter) => filter === "all" || counts[filter] > 0).map((filter) => (
        <button key={filter} type="button" className="filter" aria-pressed={value === filter} onClick={() => onChange(filter)}>
          <span className={`dot dot-${filter}`} aria-hidden="true" />
          <span>{t(`ws.f.${filter}` as MessageKey, { n: counts[filter] })}</span>
        </button>
      ))}
    </div>
  );
}
