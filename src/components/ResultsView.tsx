"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FlagReason } from "@/lib/flag-reasons";
import { pluralKey, type MessageKey } from "@/lib/i18n";
import { localizeReason } from "@/lib/i18n/reasons";
import { NO_REFERENCE_LIST, NOT_IN_REFERENCE_LIST } from "@/lib/reasons";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { SUMMARY_ORDER, VERDICT_INFO, attentionCount, verdictAdvice, verdictLabel } from "@/lib/client/verdict-info";
import type { VerifierState } from "@/lib/client/verifier-state";
import { useT } from "./LocaleProvider";

interface Props {
  state: VerifierState;
  /**
   * Move focus to the Results heading when the check finishes. True only when the student started this check in
   * this visit: they pressed a button that has since left the page. A check reopened after a reload must not take focus.
   */
  focusWhenDone?: boolean;
  onRetryClaim: (claimId: string) => void;
  onEvent: (name: "evidence_opened" | "verdict_flagged_wrong" | "fix_accepted", props?: Record<string, unknown>) => void;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Badge({ verdict }: { verdict: Verdict }) {
  const { t } = useT();
  const info = VERDICT_INFO[verdict];
  return (
    <span className={`badge badge-${info.tone}`}>
      <span aria-hidden="true">{info.symbol}</span> {verdictLabel(t, verdict)}
    </span>
  );
}

interface CardProps {
  claim: ClaimView;
  error: string | undefined;
  flagged: boolean;
  copied: "idle" | "copied" | "failed";
  /** The student says the verdict is wrong, for one of a fixed list of reasons. */
  onFlag: (reason: FlagReason) => void;
  onCopied: (result: "copied" | "failed") => void;
  onRetry: () => void;
  onEvent: Props["onEvent"];
  /** The check has ended, so a claim with no verdict was not checked rather than waiting. */
  ended: boolean;
}

/** The reasons that make sense for this verdict. A quote-based reason is offered only when there is a quote. */
function reasonsFor(claim: ClaimView): FlagReason[] {
  const verdict = claim.verdict;
  const judged = verdict === "supported" || verdict === "partial" || verdict === "contradicted" || verdict === "not_in_sources" || verdict === "cant_tell";
  const noSourceMatch = verdict === "cant_check" || verdict === "reference_not_found" || verdict === "not_in_sources";
  return [
    ...(claim.quote ? (["quote_does_not_support", "wrong_page"] as const) : []),
    ...(judged ? (["source_says_otherwise"] as const) : []),
    "claim_misread",
    ...(noSourceMatch ? (["source_was_uploaded"] as const) : []),
    "other",
  ];
}

// `flagged` and `copied` live in ResultsView, because a card unmounts whenever the filter changes.
function ClaimCard({ claim, error, flagged, copied, onFlag, onCopied, onRetry, onEvent, ended }: CardProps) {
  const verdict = claim.verdict;
  const { t } = useT();
  // After "This verdict is wrong", the student picks a reason. The button they pressed has left the page, so focus
  // goes to the first reason, and then to the thank-you line once they choose.
  const [asking, setAsking] = useState(false);
  const firstReason = useRef<HTMLButtonElement>(null);
  const thanks = useRef<HTMLParagraphElement>(null);
  const justChose = useRef(false);
  const flagButton = useRef<HTMLButtonElement>(null);
  const backedOut = useRef(false);
  useEffect(() => {
    if (asking) firstReason.current?.focus();
    // "Never mind" removes the reasons, so put focus back on the button the student started from.
    if (!asking && backedOut.current) {
      backedOut.current = false;
      flagButton.current?.focus();
    }
  }, [asking]);
  useEffect(() => {
    if (flagged && justChose.current) {
      justChose.current = false;
      thanks.current?.focus();
    }
  }, [flagged]);
  // For an empty reference list the usual advice would point the wrong way, so it is left out (the reason says what to do).
  const listMissing = verdict === "reference_not_found" && Boolean(claim.reason?.includes(NO_REFERENCE_LIST));
  const notInList = verdict === "reference_not_found" && Boolean(claim.reason?.includes(NOT_IN_REFERENCE_LIST));

  return (
    <li className="claim" id={`claim-${claim.id}`}>
      <div className="claim-head">
        {verdict ? <Badge verdict={verdict} /> : <span className="badge badge-muted">{error || ended ? t("claim.notChecked") : t("claim.waiting")}</span>}
        {claim.citation && <span className="citation">{claim.citation}</span>}
      </div>
      <p className="claim-text">{claim.text}</p>

      {claim.reason && <p className="reason">{localizeReason(claim.reason, t)}</p>}
      {verdict && verdict !== "supported" && !listMissing && (
        <p className="next">
          <strong>{t("claim.todo")}</strong>{" "}
          {notInList ? t("claim.notInList") : verdictAdvice(t, verdict)}
        </p>
      )}

      {claim.quote && (
        // The quote is the proof, so it starts open for the verdicts that ask the student to change something.
        <details open={verdict === "contradicted" || verdict === "partial"}>
          <summary
            onClick={(event) => {
              // Counted only when the student opens it by hand: a toggle event would also fire for a card that starts open.
              const details = event.currentTarget.parentElement as HTMLDetailsElement;
              if (!details.open && verdict) onEvent("evidence_opened", { verdict });
            }}
          >
            {claim.page !== null ? t("evidence.page", { n: claim.page }) : t("evidence.summary")}
          </summary>
          <blockquote>{claim.quote}</blockquote>
        </details>
      )}

      {claim.fixSuggestion && (
        <div className="fix">
          <strong>{t("fix.title")}</strong>
          <p>{claim.fixSuggestion}</p>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              const ok = await copy(claim.fixSuggestion!);
              onCopied(ok ? "copied" : "failed");
              if (ok) onEvent("fix_accepted");
            }}
          >
            {copied === "copied" ? t("fix.copied") : t("fix.copy")}
          </button>
          {copied === "failed" && <span className="hint hint-bad">{t("fix.copyFail")}</span>}
        </div>
      )}

      {error && (
        <p role="alert" className="notice notice-warn">
          {error}{" "}
          <button type="button" className="btn btn-small" onClick={onRetry}>
            {t("retry")}
          </button>
        </p>
      )}

      {verdict &&
        (flagged ? (
          <p className="hint" role="status" ref={thanks} tabIndex={-1}>
            {t("flag.thanks")}
          </p>
        ) : asking ? (
          <div className="flag-reasons" role="group" aria-label={t("flag.group")}>
            <p className="hint">{t("flag.ask")}</p>
            <div className="chips">
              {reasonsFor(claim).map((reason, index) => (
                <button
                  key={reason}
                  type="button"
                  className="chip"
                  ref={index === 0 ? firstReason : undefined}
                  onClick={() => {
                    justChose.current = true;
                    setAsking(false);
                    onFlag(reason);
                  }}
                >
                  {t(`flag.${reason}` as MessageKey)}
                </button>
              ))}
              <button
                type="button"
                className="link"
                onClick={() => {
                  backedOut.current = true;
                  setAsking(false);
                }}
              >
                {t("flag.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" className="link" ref={flagButton} onClick={() => setAsking(true)}>
              {t("flag.button")}
            </button>
          </div>
        ))}
    </li>
  );
}

export function ResultsView({ state, focusWhenDone = false, onRetryClaim, onEvent }: Props) {
  const { t, locale } = useT();
  const [chosen, setFilter] = useState<Verdict | "attention" | "all">("attention");
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [copiedFix, setCopiedFix] = useState<Record<string, "copied" | "failed">>({});
  const checked = state.claims.filter((claim) => claim.verdict !== null).length;
  const total = state.claims.length;
  const attention = attentionCount(state.counts);
  const finished = state.phase === "done";
  // When nothing needs attention, an empty "Needs attention" list would contradict the tally, so show everything.
  const filter = chosen === "attention" && finished && attention === 0 ? "all" : chosen;
  const stopped = state.stopped;
  const tally = stopped
    ? checked === 0
      ? t("tally.stoppedNone")
      : `${t(pluralKey(locale, "tally.stoppedAfter", total), { checked, total })}${attention > 0 ? ` ${t(pluralKey(locale, "tally.suffix", attention), { n: attention })}` : ""}`
    : attention === 0
      ? t("tally.allSupported")
      : t(pluralKey(locale, "tally.attention", total), { n: attention, total });

  // A keyboard or screen-reader user who pressed "Check my claims" has lost that button (it left the page), so
  // when the results arrive, move focus to the Results heading instead of leaving it on the page body.
  const heading = useRef<HTMLHeadingElement>(null);
  const wasFinished = useRef(finished);
  useEffect(() => {
    if (focusWhenDone && finished && !wasFinished.current) {
      const active = document.activeElement;
      if (!active || active === document.body) heading.current?.focus();
    }
    wasFinished.current = finished;
  }, [finished, focusWhenDone]);

  const shown = useMemo(() => {
    const ranked = new Map(state.fixList.map((id, index) => [id, index]));
    const rest = (a: ClaimView, b: ClaimView) => a.position - b.position;
    const list =
      filter === "all"
        ? state.claims
        : filter === "attention"
          ? state.claims.filter((claim) => ranked.has(claim.id) || claim.verdict === null)
          : state.claims.filter((claim) => claim.verdict === filter);
    return [...list].sort((a, b) => {
      const ra = ranked.get(a.id);
      const rb = ranked.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return rest(a, b);
    });
  }, [state.claims, state.fixList, filter]);

  return (
    <section className="panel" aria-labelledby="results-title">
      <div className="panel-head">
        <p className="eyebrow">
          {finished
            ? stopped
              ? t("results.eyebrow.stopped")
              : t("results.eyebrow.done")
            : state.phase === "error"
              ? t("results.eyebrow.error")
              : t("results.eyebrow.running")}
        </p>
        <h2 id="results-title" ref={heading} tabIndex={-1}>
          {t("results.title")}
        </h2>
      </div>

      {/* Stays mounted so screen readers hear the outcome when the progress line goes away. */}
      <p className="sr-only" role="status">
        {finished
          ? total === 0
            ? stopped
              ? t("sr.stoppedNone")
              : t("sr.noClaims")
            : t(stopped ? "sr.stopped" : "sr.finished", { tally })
          : ""}
      </p>

      {!finished && state.phase !== "error" && (
        <div className="progress" aria-live="polite">
          <progress max={Math.max(total, 1)} value={checked} aria-label={t("results.progress.aria")} />
          <span className="hint">{state.message || (total > 0 ? t("results.progress.count", { checked, total }) : t("results.working"))}</span>
        </div>
      )}

      {state.phase === "error" && state.error && (
        <p role="alert" className="notice notice-bad">
          {state.error}
        </p>
      )}

      {finished && total === 0 && !stopped && (
        <p className="empty">{t("empty.noClaims")}</p>
      )}
      {finished && total === 0 && stopped && <p className="empty">{t("empty.stoppedNone")}</p>}

      {total > 0 && (
        <>
          {finished && (
            <div className="tally">
              <p className="tally-number">{tally}</p>
            </div>
          )}

          <div className="chips" role="group" aria-label={t("filter.group")}>
            <button type="button" className="chip" aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>
              {t("filter.attention", { n: attention })}
            </button>
            {SUMMARY_ORDER.filter((verdict) => (state.counts[verdict] ?? 0) > 0).map((verdict) => (
              <button key={verdict} type="button" className="chip" aria-pressed={filter === verdict} onClick={() => setFilter(verdict)}>
                <span aria-hidden="true">{VERDICT_INFO[verdict].symbol}</span> {verdictLabel(t, verdict)} ({state.counts[verdict]})
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              {t("filter.all", { n: total })}
            </button>
          </div>

          <ol className="claims">
            {shown.map((claim) => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                error={state.claimErrors[claim.id]}
                flagged={flagged.has(claim.id)}
                copied={copiedFix[claim.id] ?? "idle"}
                ended={finished}
                onFlag={(reason) => {
                  setFlagged((prev) => new Set(prev).add(claim.id));
                  if (claim.verdict) onEvent("verdict_flagged_wrong", { verdict: claim.verdict, reason });
                }}
                onCopied={(result) => setCopiedFix((prev) => ({ ...prev, [claim.id]: result }))}
                onRetry={() => onRetryClaim(claim.id)}
                onEvent={onEvent}
              />
            ))}
          </ol>
          {shown.length === 0 && <p className="empty">{t("filter.nothing")}</p>}
        </>
      )}
    </section>
  );
}
