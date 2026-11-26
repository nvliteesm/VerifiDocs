"use client";

// The strip above the draft: how far the check is, one block per claim as it lands, what it found in one line, and anything that went wrong. Ported
// from the old card list (its tally, scan headline, unread parts and focus handling) so none of that behaviour is lost.
import { useEffect, useRef, useState } from "react";
import { pluralKey } from "@/lib/i18n";
import { isOptional } from "@/lib/fix-list";
import type { VerifierState } from "@/lib/client/verifier-state";
import { useT } from "./LocaleProvider";

interface Props {
  state: VerifierState;
  /**
   * Move focus to the Results heading when the check finishes. True only when the student started this check in
   * this visit: they pressed a button that has since left the page. A check reopened after a reload must not take focus.
   */
  focusWhenDone: boolean;
  /** Reads a part of the draft the AI could not read before. */
  onReadPart?: (unit: number) => Promise<void>;
  /** The scan has ended and the check starts by itself once the sources finish reading (DESIGN.md J1). */
  waitingForSources?: boolean;
  /** The workspace shows the coverage summary in place of the scan headline, so the headline here would say it twice. */
  coverageShown?: boolean;
  /** The lookup for the reference list: how many entries were looked at, and whether it is still going. */
  sourcesStage?: { active: boolean; done: number; total: number } | null;
}

export function RunStatus({ state, focusWhenDone, onReadPart, waitingForSources = false, coverageShown = false, sourcesStage = null }: Props) {
  const { t, locale } = useT();
  // The part being read again, if any (one at a time: each is one model request).
  const [readingPart, setReadingPart] = useState<number | null>(null);
  const checked = state.claims.filter((claim) => claim.verdict !== null).length;
  const total = state.claims.length;
  const attention = state.fixList.length;
  const finished = state.phase === "done";
  const scanned = state.phase === "scanned";
  const isStopped = state.stopped;
  const uncited = state.claims.filter((claim) => claim.verdict === "no_citation_given");
  const needSource = uncited.filter((claim) => !isOptional(claim)).length;
  const couldUseSource = uncited.length - needSource;
  const waiting = state.claims.filter((claim) => claim.verdict === null).length;
  const notListed = state.counts.reference_not_found ?? 0;
  // Only No citation and Reference not found come from the scan; any other verdict means a source was really looked
  // at. Until then the result is a scan result, never "Check complete" and never "171 of 171 need attention".
  const sourceChecked = state.claims.some((claim) => claim.verdict !== null && claim.verdict !== "no_citation_given" && claim.verdict !== "reference_not_found");
  const scanView = scanned || (finished && !isStopped && !sourceChecked);
  // Lead with the problem. "No sentence is missing a source" would read as an all-clear beside a citation not in the list.
  const scanHeadline =
    needSource > 0
      ? t(pluralKey(locale, "scan.need", needSource), { n: needSource })
      : notListed > 0
        ? t(pluralKey(locale, "scan.missingHead", notListed), { n: notListed })
        : t("scan.noneNeeded");
  const tally = isStopped
    ? checked === 0
      ? t("tally.stoppedNone")
      : `${t(pluralKey(locale, "tally.stoppedAfter", total), { checked, total })}${attention > 0 ? ` ${t(pluralKey(locale, "tally.suffix", attention), { n: attention })}` : ""}`
    : attention === 0
      ? t("tally.allSupported")
      : t(pluralKey(locale, "tally.attention", total), { n: attention, total });

  // Wrong years go in the summary too, by citation: a Supported claim is not an issue, and its year still needs fixing.
  const yearItems = new Map<number, string>();
  for (const claim of state.claims) {
    for (const note of claim.yearNotes ?? []) {
      if (!yearItems.has(note.position)) yearItems.set(note.position, t("tally.yearItem", { citation: claim.citation ?? "", published: note.published }));
    }
  }

  // A keyboard or screen-reader user who pressed a button that has since left the page: move focus to the Results
  // heading when the results arrive, instead of leaving it on the page body.
  const heading = useRef<HTMLHeadingElement>(null);
  const wasFinished = useRef(finished);
  const wasScanned = useRef(scanned);
  useEffect(() => {
    if (focusWhenDone && ((finished && !wasFinished.current) || (scanned && !wasScanned.current))) {
      const active = document.activeElement;
      if (!active || active === document.body) heading.current?.focus();
    }
    wasFinished.current = finished;
    wasScanned.current = scanned;
  }, [finished, scanned, focusWhenDone]);

  // "Check complete" and "Scan complete" repeat what the headline says, so they are for screen readers only.
  const eyebrowHidden = scanView || (finished && !isStopped);
  const eyebrow =
    finished && !scanView
      ? isStopped
        ? t("results.eyebrow.stopped")
        : t("results.eyebrow.done")
      : scanView
        ? t("results.eyebrow.scanned")
        : state.phase === "error"
          ? t("results.eyebrow.error")
          : state.phase === "checking"
            ? t("results.eyebrow.running")
            : t("results.eyebrow.scanning");

  return (
    <section className="run-status" aria-labelledby="results-title">
      <p className={eyebrowHidden ? "eyebrow sr-only" : "eyebrow"}>{eyebrow}</p>
      <h2 id="results-title" className="sr-only" ref={heading} tabIndex={-1}>
        {t("results.title")}
      </h2>

      {/* Stays mounted so screen readers hear the outcome when the progress line goes away. */}
      <p className="sr-only" role="status">
        {finished ? (total === 0 ? (isStopped ? t("sr.stoppedNone") : t("sr.noClaims")) : t(isStopped ? "sr.stopped" : "sr.finished", { tally: scanView ? scanHeadline : tally })) : ""}
      </p>

      {((!finished && !scanned && state.phase !== "error") || (scanned && waitingForSources)) && (
        <div className="run-main" aria-live="polite">
          <span className="run-now">
            <span className="pulse-dot" aria-hidden="true" />
            <span>
              {waitingForSources
                ? t("ws.r.waitSources")
                : state.phase === "checking"
                  ? t("ws.r.checking", { done: checked, total })
                  : state.message || (total > 0 ? t("results.progress.count", { checked, total }) : t("results.working"))}
            </span>
          </span>
          {/* One block per claim: it takes the colour of its verdict as the answer lands. Decorative; the line says it. */}
          {state.phase === "checking" && total > 0 ? (
            <div className="segs" aria-hidden="true">
              {[...state.claims]
                .sort((a, b) => a.position - b.position)
                .map((claim) => (
                  <span key={claim.id} className={claim.verdict ? `seg v-${claim.verdict}` : claim.status === "checking" ? "seg seg-now" : "seg"} />
                ))}
            </div>
          ) : (
            <div className="scanbar" aria-hidden="true" />
          )}
          <progress className="sr-only" max={Math.max(total, 1)} value={checked} aria-label={t("results.progress.aria")} />
          {/* The real stages of this run, each in the state it is really in. No percentages. */}
          <ol className="stages" aria-label={t("results.title")}>
            {(
              [
                ["stage.read", "done", null],
                ["stage.claims", state.phase === "starting" || state.phase === "extracting" ? "active" : "done", null],
                ...(sourcesStage
                  ? ([["stage.sources", sourcesStage.active ? "active" : "done", sourcesStage.active ? `${sourcesStage.done}/${sourcesStage.total}` : null]] as const)
                  : []),
                ["stage.check", state.phase === "checking" ? "active" : "todo", state.phase === "checking" && total > 0 ? `${checked}/${total}` : null],
                ["stage.results", "todo", null],
              ] as const
            ).map(([key, status, detail]) => (
              <li key={key} data-status={status}>
                <span className="stage-mark" aria-hidden="true" />
                {t(key)}
                {detail && <span className="mono"> {detail}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {state.phase === "error" && state.error && (
        <p role="alert" className="notice notice-bad">
          {state.error}
        </p>
      )}

      {(finished || (scanned && !waitingForSources)) && total > 0 && !coverageShown && (
        // Once a check is done the workspace's result line says it; a stopped check and a scan still say it here.
        <p className={finished && !scanView && !isStopped ? "run-line sr-only" : "run-line"}>{finished && !scanView ? tally : scanHeadline}</p>
      )}
      {scanView && !waitingForSources && total > 0 && (
        <ul className="scan-list">
          {couldUseSource > 0 && <li>{t("scan.optional", { n: couldUseSource })}</li>}
          {notListed > 0 && needSource > 0 && <li>{t("scan.missing", { n: notListed })}</li>}
          {waiting > 0 && <li>{t("scan.ready", { n: waiting })}</li>}
        </ul>
      )}
      {(finished || scanned) && yearItems.size > 0 && <p className="year-tag">{t("tally.years", { list: [...yearItems.values()].join("; ") })}</p>}

      {/* Parts the AI could not read: their claims are missing, so the student is told where, and can try again. */}
      {(finished || scanned) && state.failedParts.length > 0 && (
        <div className="notice notice-warn unread" role="group" aria-labelledby="unread-title">
          <p id="unread-title">{t(pluralKey(locale, "parts.failed", state.failedParts.length), { n: state.failedParts.length })}</p>
          <ul>
            {state.failedParts.map((part) => (
              <li key={part.unit}>
                <span>{part.section ?? t("parts.start")}</span>
                {onReadPart && (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={readingPart !== null}
                    onClick={async () => {
                      setReadingPart(part.unit);
                      try {
                        await onReadPart(part.unit);
                      } finally {
                        setReadingPart(null);
                      }
                    }}
                  >
                    {readingPart === part.unit ? t("parts.reading") : t("parts.retry")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {finished && total === 0 && !isStopped && <p className="empty">{t("empty.noClaims")}</p>}
      {finished && total === 0 && isStopped && <p className="empty">{t("empty.stoppedNone")}</p>}
    </section>
  );
}
