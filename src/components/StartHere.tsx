"use client";

// The few findings most worth a look first. A paper can have a hundred findings; this is the short list a student starts
// on, with repeated findings already grouped ("Darmono 2016 is not in your reference list: 6 places"). Calm by design:
// one quiet card per finding and one action each.
import { pluralKey } from "@/lib/i18n";
import type { FindingGroup } from "@/lib/client/findings";
import { verdictLabel } from "@/lib/client/verdict-info";
import { localizeReason } from "@/lib/i18n/reasons";
import { VerdictIcon } from "./claim-bits";
import { useT } from "./LocaleProvider";

interface Props {
  groups: readonly FindingGroup[];
  /** How many findings there are in all, so the line under the cards can say how many more the list holds. */
  totalGroups: number;
  labels: ReadonlyMap<string, string>;
  onReview: (claimId: string) => void;
}

const SHORT = 140;

export function StartHere({ groups, totalGroups, labels, onReview }: Props) {
  const { t, locale } = useT();
  if (groups.length === 0) return null;
  const more = totalGroups - groups.length;
  return (
    <section className="start-here" aria-labelledby="start-here-title">
      <div>
        <h2 id="start-here-title" className="start-title">
          {t("start.title")}
        </h2>
        <p className="hint">{t("start.sub")}</p>
      </div>
      <ol className="start-list">
        {groups.map((group) => {
          const first = group.claims[0]!;
          const places = group.claims.length;
          const text = group.citation ?? (first.text.length > SHORT ? `${first.text.slice(0, SHORT).trimEnd()}…` : first.text);
          return (
            <li key={group.key} className={`start-item v-${group.verdict}`}>
              <div className="start-what">
                <span className="start-verdict">
                  <VerdictIcon verdict={group.verdict} size={16} />
                  {verdictLabel(t, group.verdict)}
                </span>
                <p className={group.citation ? "start-text mono" : "start-text"}>{text}</p>
                {first.reason && <p className="hint">{localizeReason(first.reason, t)}</p>}
                {places > 1 && <p className="start-places mono">{t(pluralKey(locale, "start.places", places), { n: places })}</p>}
              </div>
              <button type="button" className="btn btn-small" aria-label={`${t("start.review")}: ${labels.get(first.id) ?? ""} ${text}`} onClick={() => onReview(first.id)}>
                {t("start.review")}
              </button>
            </li>
          );
        })}
      </ol>
      {more > 0 && <p className="hint">{t(pluralKey(locale, "start.more", more), { n: more })}</p>}
    </section>
  );
}
