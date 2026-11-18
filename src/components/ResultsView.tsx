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

/** Cards shown at once in a section; "Show more" adds this many again. */
export const SECTION_PAGE = 20;

interface Props {
  state: VerifierState;
  /** What the draft was read from ("Google Doc", a file name), when it was not pasted. */
  draftLabel?: string | null;
  /**
   * Move focus to the Results heading when the check finishes. True only when the student started this check in
   * this visit: they pressed a button that has since left the page. A check reopened after a reload must not take focus.
   */
  focusWhenDone?: boolean;
  onRetryClaim: (claimId: string) => void;
  /** Reads a part of the draft the AI could not read before. */
  onReadPart?: (unit: number) => Promise<void>;
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
  /** The scan is over and the check has not started: a claim with no verdict is cited and waiting for it. */
  scanned: boolean;
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
function ClaimCard({ claim, error, flagged, copied, onFlag, onCopied, onRetry, onEvent, ended, scanned }: CardProps) {
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
        {verdict ? <Badge verdict={verdict} /> : <span className="badge badge-muted">{error || ended ? t("claim.notChecked") : scanned ? t("claim.notCheckedYet") : t("claim.waiting")}</span>}
        {claim.citation && (
          <span className="citation">
            {claim.citation}
            {claim.citationInherited ? ` · ${t("claim.inherited")}` : ""}
          </span>
        )}
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

interface Group {
  /** The heading text, or "" for claims before the first heading. */
  key: string;
  heading: string | null;
  claims: ClaimView[];
  /** How many of them need attention. */
  attention: number;
}

/**
 * The shown claims, grouped by the heading they sit under, in the order the sections appear in the draft. Inside a
 * section the claims keep the order they were given (the ranked fix list first, then document order).
 */
export function groupBySection(claims: ClaimView[], needsAttention: (claim: ClaimView) => boolean): Group[] {
  const groups = new Map<string, Group & { first: number }>();
  for (const claim of claims) {
    const key = claim.section ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { key, heading: claim.section, claims: [], attention: 0, first: claim.position };
      groups.set(key, group);
    }
    group.claims.push(claim);
    if (needsAttention(claim)) group.attention += 1;
    group.first = Math.min(group.first, claim.position);
  }
  // Claims with no known heading go last: they are not always before the first heading (a heading may not be found).
  return [...groups.values()]
    .sort((a, b) => (a.heading === null ? 1 : 0) - (b.heading === null ? 1 : 0) || a.first - b.first)
    .map(({ key, heading, claims: list, attention }) => ({ key, heading, claims: list, attention }));
}

export function ResultsView({ state, draftLabel = null, focusWhenDone = false, onRetryClaim, onReadPart, onEvent }: Props) {
  const { t, locale } = useT();
  // The part being read again, if any (one at a time: each is one model request).
  const [readingPart, setReadingPart] = useState<number | null>(null);
  const [chosen, setFilter] = useState<Verdict | "attention" | "all">("attention");
  // Which sections the student opened or closed by hand, and how many cards each one shows.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [pages, setPages] = useState<Readonly<Record<string, number>>>({});
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [copiedFix, setCopiedFix] = useState<Record<string, "copied" | "failed">>({});
  const checked = state.claims.filter((claim) => claim.verdict !== null).length;
  const total = state.claims.length;
  const attention = attentionCount(state.counts);
  const finished = state.phase === "done";
  // The scan is over and the cited claims wait for the student to start the check.
  const scanned = state.phase === "scanned";
  const noCitation = state.counts.no_citation_given ?? 0;
  const notListed = state.counts.reference_not_found ?? 0;
  const waiting = state.claims.filter((claim) => claim.verdict === null).length;
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
  // Two moments hand the student a new set of results: the scan ending, and the check ending after they pressed
  // "Check N cited claims" (that button has left the page by then, so focus would otherwise fall to the top).
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

  const groups = useMemo(() => {
    const ranked = new Set(state.fixList);
    return groupBySection(shown, (claim) => ranked.has(claim.id));
  }, [shown, state.fixList]);
  // With no headings at all there is nothing to group: the list is shown as it is, a page at a time.
  const flat = groups.length === 1 && groups[0]!.heading === null;
  // Open by default: every section when the whole list is short, else the first one that needs attention.
  const firstWithWork = groups.find((group) => group.attention > 0)?.key ?? groups[0]?.key;
  const isOpen = (group: Group) =>
    flat || (toggled.get(group.key) ?? (shown.length <= SECTION_PAGE || group.key === firstWithWork));

  const card = (claim: ClaimView) => (
    <ClaimCard
      key={claim.id}
      claim={claim}
      error={state.claimErrors[claim.id]}
      flagged={flagged.has(claim.id)}
      copied={copiedFix[claim.id] ?? "idle"}
      ended={finished}
      scanned={scanned}
      onFlag={(reason) => {
        setFlagged((prev) => new Set(prev).add(claim.id));
        if (claim.verdict) onEvent("verdict_flagged_wrong", { verdict: claim.verdict, reason });
      }}
      onCopied={(result) => setCopiedFix((prev) => ({ ...prev, [claim.id]: result }))}
      onRetry={() => onRetryClaim(claim.id)}
      onEvent={onEvent}
    />
  );

  const cards = (group: Group) => {
    const limit = pages[group.key] ?? SECTION_PAGE;
    const left = group.claims.length - limit;
    return (
      <>
        <ol className="claims">{group.claims.slice(0, limit).map(card)}</ol>
        {left > 0 && (
          <button
            type="button"
            className="btn btn-small section-more"
            onClick={() => setPages((prev) => ({ ...prev, [group.key]: limit + SECTION_PAGE }))}
          >
            {t("section.more", { n: Math.min(left, SECTION_PAGE), left })}
          </button>
        )}
      </>
    );
  };

  return (
    <section className="panel" aria-labelledby="results-title">
      <div className="panel-head">
        <p className="eyebrow">
          {finished
            ? stopped
              ? t("results.eyebrow.stopped")
              : t("results.eyebrow.done")
            : scanned
              ? t("results.eyebrow.scanned")
              : state.phase === "error"
                ? t("results.eyebrow.error")
                : t("results.eyebrow.running")}
        </p>
        <h2 id="results-title" ref={heading} tabIndex={-1}>
          {t("results.title")}
        </h2>
        {draftLabel && <p className="hint">{t("results.draft", { label: draftLabel })}</p>}
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

      {!finished && !scanned && state.phase !== "error" && (
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

          {scanned && (
            <div className="tally">
              <p className="tally-number">{t(pluralKey(locale, "scan.summary", total), { n: total })}</p>
              <ul className="scan-list">
                {noCitation > 0 && <li>{t("scan.nocite", { n: noCitation })}</li>}
                {notListed > 0 && <li>{t("scan.missing", { n: notListed })}</li>}
                <li>{t("scan.ready", { n: waiting })}</li>
              </ul>
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

          {flat
            ? groups.map((group) => <div key={group.key}>{cards(group)}</div>)
            : (
              <div className="sections">
                {groups.map((group, index) => {
                  const open = isOpen(group);
                  const id = `section-${index}`;
                  return (
                    <section key={group.key} className="section" aria-labelledby={`${id}-head`}>
                      <h3 className="section-head">
                        <button
                          type="button"
                          id={`${id}-head`}
                          aria-expanded={open}
                          aria-controls={id}
                          onClick={() => setToggled((prev) => new Map(prev).set(group.key, !open))}
                        >
                          <span className="section-arrow" aria-hidden="true">
                            {open ? "▾" : "▸"}
                          </span>
                          <span className="section-name">{group.heading ?? t("section.none")}</span>
                          <span className={`section-count${group.attention > 0 ? " section-count-work" : ""}`}>
                            {group.attention > 0
                              ? t(pluralKey(locale, "section.attention", group.attention), { n: group.attention })
                              : t(pluralKey(locale, "section.claims", group.claims.length), { n: group.claims.length })}
                          </span>
                        </button>
                      </h3>
                      <div id={id} hidden={!open}>
                        {open && cards(group)}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          {shown.length === 0 && <p className="empty">{t("filter.nothing")}</p>}
        </>
      )}
    </section>
  );
}
