"use client";

// "Check my numbers": where the same figure is written with different values in the student's own paper. A separate tool
// from checking sources, with its own plain wording: it shows where the values are and never says which one is right.
import type { InconsistentFigures } from "@/lib/client/consistency";
import type { ContradictionView } from "@/lib/client/types";
import type { ConsistencyPhase } from "./useConsistency";
import { useT } from "./LocaleProvider";

interface Props {
  phase: ConsistencyPhase;
  done: number;
  total: number;
  found: readonly InconsistentFigures[];
  /** Findings of different sections that may contradict. */
  contradictions?: readonly ContradictionView[];
  figureCount: number;
  /** The main check is still running: wait, so the two do not compete. */
  disabled?: boolean;
  onRun: () => void;
}

const EXCERPT = 170;

export function ConsistencyPanel({ phase, done, total, found, contradictions = [], figureCount, disabled = false, onRun }: Props) {
  const { t } = useT();
  const excerpt = (sentence: string) => (sentence.length > EXCERPT ? `${sentence.slice(0, EXCERPT).trimEnd()}…` : sentence);
  return (
    <section className="consistency" aria-labelledby="cons-title">
      <div>
        <h2 id="cons-title" className="cons-title">
          {t("cons.title")}
        </h2>
        <p className="hint">{t("cons.sub")}</p>
      </div>

      {phase === "running" ? (
        <p className="hint" role="status">
          <span className="pulse-dot" aria-hidden="true" />
          {t("cons.running", { done: Math.min(done + 1, total), total })}
        </p>
      ) : (
        <div className="actions">
          <button type="button" className="btn" disabled={disabled || total === 0} onClick={onRun}>
            {phase === "idle" ? t("cons.run") : t("cons.again")}
          </button>
        </div>
      )}

      {phase === "failed" && (
        <p role="alert" className="notice notice-warn">
          {t("cons.failed")}
        </p>
      )}

      {phase === "done" && found.length === 0 && contradictions.length === 0 && (
        <p className="hint" role="status">
          {t("cons.clean")} {t("cons.read", { n: figureCount })}
        </p>
      )}

      {phase === "done" && contradictions.length > 0 && (
        <div className="cons-found" role="status">
          <h3 className="cons-found-title">{t("cons.may")}</h3>
          <p className="hint">{t("cons.mayExplain")}</p>
          <ul className="cons-list">
            {contradictions.map((pair) => (
              <li key={`${pair.a.sentence}|${pair.b.sentence}`} className="cons-item">
                <p className="cons-label">{pair.note}</p>
                <ul className="cons-places" aria-label={t("cons.where")}>
                  {[pair.a, pair.b].map((place) => (
                    <li key={place.sentence}>
                      <span className="cons-where hint">{place.section ?? ""}</span>
                      <span className="cons-sentence">{excerpt(place.sentence)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === "done" && found.length > 0 && (
        <div className="cons-found" role="status">
          <h3 className="cons-found-title">{t("cons.found")}</h3>
          <p className="hint">{t("cons.explain")}</p>
          <ul className="cons-list">
            {found.map((item) => (
              <li key={item.key} className="cons-item">
                <p className="cons-label">{item.label}</p>
                <p className="cons-kind mono">{item.kind === "unit" ? t("cons.kind.unit") : t("cons.kind.value")}</p>
                <ul className="cons-places" aria-label={t("cons.where")}>
                  {item.places.map((place) => (
                    <li key={`${place.sentence}|${place.value}`}>
                      <span className="cons-value mono">
                        {place.value}
                        {place.unit ? ` ${place.unit}` : ""}
                      </span>
                      <span className="cons-where hint">{place.section ?? ""}</span>
                      <span className="cons-sentence">{excerpt(place.sentence)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
