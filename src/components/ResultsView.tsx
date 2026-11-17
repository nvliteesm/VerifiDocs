"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FLAG_REASON_LABELS, type FlagReason } from "@/lib/flag-reasons";
import { NO_REFERENCE_LIST, NOT_IN_REFERENCE_LIST } from "@/lib/reasons";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { SUMMARY_ORDER, VERDICT_INFO, attentionCount } from "@/lib/client/verdict-info";
import type { VerifierState } from "@/lib/client/verifier-state";

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
  const info = VERDICT_INFO[verdict];
  return (
    <span className={`badge badge-${info.tone}`}>
      <span aria-hidden="true">{info.symbol}</span> {info.label}
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
  const info = verdict ? VERDICT_INFO[verdict] : null;
  // After "This verdict is wrong", the student picks a reason. The button they pressed has left the page, so focus
  // goes to the first reason, and then to the thank-you line once they choose.
  const [asking, setAsking] = useState(false);
  const firstReason = useRef<HTMLButtonElement>(null);
  const thanks = useRef<HTMLParagraphElement>(null);
  const justChose = useRef(false);
  useEffect(() => {
    if (asking) firstReason.current?.focus();
  }, [asking]);
  useEffect(() => {
    if (flagged && justChose.current) {
      justChose.current = false;
      thanks.current?.focus();
    }
  }, [flagged]);
  // These two end before the judge, with a reason that already says exactly what happened. The general
  // explanation would repeat it, and for an empty reference list it would even point the wrong way.
  const reasonSaysItAll = (verdict === "cant_check" || verdict === "reference_not_found") && Boolean(claim.reason);
  const listMissing = verdict === "reference_not_found" && Boolean(claim.reason?.includes(NO_REFERENCE_LIST));
  const notInList = verdict === "reference_not_found" && Boolean(claim.reason?.includes(NOT_IN_REFERENCE_LIST));

  return (
    <li className="claim" id={`claim-${claim.id}`}>
      <div className="claim-head">
        {verdict ? <Badge verdict={verdict} /> : <span className="badge badge-muted">{error || ended ? "Not checked" : "Waiting…"}</span>}
        {claim.citation && <span className="citation">{claim.citation}</span>}
      </div>
      <p className="claim-text">{claim.text}</p>

      {info && !reasonSaysItAll && <p className="meaning">{info.meaning}</p>}
      {claim.reason && <p className="reason">{claim.reason}</p>}
      {info && info.advice && !listMissing && (
        <p className="next">
          <strong>What to do:</strong>{" "}
          {notInList ? "Add this reference to your reference list, or correct the citation so it matches an entry." : info.advice}
        </p>
      )}

      {claim.quote && (
        <details
          onToggle={(event) => {
            if ((event.currentTarget as HTMLDetailsElement).open && verdict) onEvent("evidence_opened", { verdict });
          }}
        >
          <summary>
            What your source says{claim.page !== null ? ` (page ${claim.page})` : ""}
          </summary>
          <blockquote>{claim.quote}</blockquote>
        </details>
      )}

      {claim.fixSuggestion && (
        <div className="fix">
          <strong>Suggested sentence</strong>
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
            {copied === "copied" ? "Copied" : "Copy sentence"}
          </button>
          {copied === "failed" && <span className="hint hint-bad">Could not copy. Select the sentence and copy it by hand.</span>}
        </div>
      )}

      {error && (
        <p role="alert" className="notice notice-warn">
          {error}{" "}
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}

      {verdict &&
        (flagged ? (
          <p className="hint" role="status" ref={thanks} tabIndex={-1}>
            Thanks, noted.
          </p>
        ) : asking ? (
          <div className="flag-reasons" role="group" aria-label="What looks wrong with this verdict?">
            <p className="hint">What looks wrong?</p>
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
                  {FLAG_REASON_LABELS[reason]}
                </button>
              ))}
              <button type="button" className="link" onClick={() => setAsking(false)}>
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" className="link" onClick={() => setAsking(true)}>
              This verdict is wrong
            </button>
          </div>
        ))}
    </li>
  );
}

export function ResultsView({ state, focusWhenDone = false, onRetryClaim, onEvent }: Props) {
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
      ? "Stopped before any claim was checked."
      : `Stopped after ${checked} of ${total} ${total === 1 ? "claim" : "claims"}.${attention > 0 ? ` ${attention} ${attention === 1 ? "needs" : "need"} attention.` : ""}`
    : attention === 0
      ? "Every checked claim is supported."
      : `${attention} of ${total} ${total === 1 ? "claim needs" : "claims need"} attention.`;

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
          {finished ? (stopped ? "Check stopped by you" : "Check complete") : state.phase === "error" ? "Check stopped" : "Checking"}
        </p>
        <h2 id="results-title" ref={heading} tabIndex={-1}>
          Results
        </h2>
      </div>

      {/* Stays mounted so screen readers hear the outcome when the progress line goes away. */}
      <p className="sr-only" role="status">
        {finished
          ? total === 0
            ? stopped
              ? "Check stopped before any claims were found."
              : "Check finished. No checkable claims were found."
            : `${stopped ? "Check stopped" : "Check finished"}. ${tally}`
          : ""}
      </p>

      {!finished && state.phase !== "error" && (
        <div className="progress" aria-live="polite">
          <progress max={Math.max(total, 1)} value={checked} aria-label="Claims checked" />
          <span className="hint">{state.message || (total > 0 ? `${checked} of ${total} claims checked` : "Working…")}</span>
        </div>
      )}

      {state.phase === "error" && state.error && (
        <p role="alert" className="notice notice-bad">
          {state.error}
        </p>
      )}

      {finished && total === 0 && !stopped && (
        <p className="empty">No checkable claims were found in this draft. Try pasting a section with factual statements and citations.</p>
      )}
      {finished && total === 0 && stopped && <p className="empty">You stopped the check before any claims were found.</p>}

      {total > 0 && (
        <>
          <div className="tally">
            {finished && <p className="tally-number">{tally}</p>}
            <p className="hint">Most urgent first. Where a claim has one, open &ldquo;What your source says&rdquo; to see the exact quote.</p>
          </div>

          <div className="chips" role="group" aria-label="Filter claims">
            <button type="button" className="chip" aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>
              Needs attention ({attention})
            </button>
            {SUMMARY_ORDER.filter((verdict) => (state.counts[verdict] ?? 0) > 0).map((verdict) => (
              <button key={verdict} type="button" className="chip" aria-pressed={filter === verdict} onClick={() => setFilter(verdict)}>
                <span aria-hidden="true">{VERDICT_INFO[verdict].symbol}</span> {VERDICT_INFO[verdict].label} ({state.counts[verdict]})
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All ({total})
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
          {shown.length === 0 && <p className="empty">Nothing in this filter.</p>}
        </>
      )}
    </section>
  );
}
