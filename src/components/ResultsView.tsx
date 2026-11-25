"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FlagReason } from "@/lib/flag-reasons";
import { pluralKey, type MessageKey } from "@/lib/i18n";
import { localizeReason } from "@/lib/i18n/reasons";
import { NO_REFERENCE_LIST, NOT_IN_REFERENCE_LIST } from "@/lib/reasons";
import { markDifferences } from "@/lib/client/numbers";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { SUMMARY_ORDER, VERDICT_INFO, verdictAdvice, verdictLabel } from "@/lib/client/verdict-info";
import { isOptional } from "@/lib/fix-list";
import type { VerifierState } from "@/lib/client/verifier-state";
import { Badge, copy, Pieces, previewOf, shortQuote } from "./claim-bits";
import { reasonsFor } from "./FlagVerdict";
import { FoundSources, type AttachStage } from "./FoundSources";
import { useT } from "./LocaleProvider";

// Kept for the tests of the code it shares with the workspace; the app no longer renders this list (see Workspace).
export { previewOf, shortQuote };

export type { AttachStage };

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
  onEvent: (name: "evidence_opened" | "verdict_flagged_wrong" | "fix_accepted" | "source_copied", props?: Record<string, unknown>) => void;
  /** Find a source for an uncited claim: null when it worked, else a message for the card. */
  onFindSources?: (claimId: string) => Promise<string | null>;
  /** Search the web for an uncited claim after Find a source found no paper: null when it worked, else a message for the card. */
  onFindWebSources?: (claimId: string) => Promise<string | null>;
  /**
   * Check a claim against found paper `rank`: its free PDF (file null) or the student's upload. Reports each stage,
   * and resolves with null when the check ran, else a message for the card.
   */
  onAttachSource?: (claimId: string, rank: number, title: string, file: File | null, stage: (stage: AttachStage) => void) => Promise<string | null>;
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
  onFindSources?: Props["onFindSources"];
  onFindWebSources?: Props["onFindWebSources"];
  onAttachSource?: Props["onAttachSource"];
  /** The check has ended, so a claim with no verdict was not checked rather than waiting. */
  ended: boolean;
  /** The scan is over and the check has not started: a claim with no verdict is cited and waiting for it. */
  scanned: boolean;
}

function ClaimCard({ claim, error, flagged, copied, onFlag, onCopied, onRetry, onEvent, onFindSources, onFindWebSources, onAttachSource, ended, scanned }: CardProps) {
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
  const optional = isOptional(claim);
  // Numbers that differ between the sentence and the quote are marked in both. A fact from the numbers, not a verdict.
  const marks = claim.quote ? markDifferences(claim.text, claim.citation, claim.quote) : null;
  const numberMarks = marks?.any ? marks : null;

  return (
    <li className="claim" id={`claim-${claim.id}`}>
      <div className="claim-head">
        {verdict ? <Badge verdict={verdict} optional={optional} /> : <span className="badge badge-muted">{error || ended ? t("claim.notChecked") : scanned ? t("claim.notCheckedYet") : t("claim.waiting")}</span>}
        {claim.citation && (
          <span className="citation">
            {claim.citation}
            {claim.citationInherited ? ` · ${t("claim.inherited")}` : ""}
          </span>
        )}
      </div>
      <p className="claim-text">{numberMarks ? <Pieces pieces={numberMarks.claim} /> : claim.text}</p>
      {/* The audit trail (PRD guard rule 2): this citation was attached here, after the claim was written. */}
      {claim.citationSource === "found" && <p className="found-tag">{t("claim.found")}</p>}
      {/* The reference exists but its year in the list is off. A separate fix: the verdict stands. */}
      {claim.yearNotes?.map((note) => (
        <p key={note.position} className="year-tag">
          {t("claim.year", { cited: note.cited, published: note.published })}
        </p>
      ))}

      {claim.reason && <p className="reason">{localizeReason(claim.reason, t)}</p>}
      {verdict && verdict !== "supported" && !listMissing && (
        <p className="next">
          <strong>{t("claim.todo")}</strong>{" "}
          {notInList ? t("claim.notInList") : optional ? t("claim.optionalAdvice") : verdictAdvice(t, verdict)}
        </p>
      )}

      {verdict === "no_citation_given" && onFindSources && (
        <FoundSources claim={claim} onFind={onFindSources} onAttach={onAttachSource} onFindWeb={onFindWebSources} onEvent={onEvent} />
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
            <span>{claim.page !== null ? t("evidence.page", { n: claim.page }) : t("evidence.summary")}</span>
            {/* The first words of the quote, only while it is closed: a pass shows why it passed. */}
            <span className="evidence-preview">{previewOf(claim.quote)}</span>
          </summary>
          <div className="quote">
            <blockquote>
              {/* The page is named in the line above; this tab is the same fact, drawn on the quote. */}
              {claim.page !== null && (
                <span className="page-tag" aria-hidden="true">
                  {t("evidence.tag", { n: claim.page })}
                </span>
              )}
              {numberMarks ? <Pieces pieces={numberMarks.quote} /> : claim.quote}
            </blockquote>
          </div>
          {claim.sourceFile && <p className="hint quote-source">{t("evidence.file", { file: claim.sourceFile })}</p>}
          {numberMarks && <p className="hint quote-source">{t("evidence.numbers")}</p>}
          {/* Help to read an English quote. The quote above stays the evidence; this line is never checked. */}
          {claim.quoteGloss && (
            <p className="gloss">
              <span className="gloss-label">{t("evidence.gloss")}</span> {claim.quoteGloss}
            </p>
          )}
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
          <p className="hint claim-foot" role="status" ref={thanks} tabIndex={-1}>
            {t("flag.thanks")}
          </p>
        ) : asking ? (
          <div className="flag-reasons claim-foot" role="group" aria-label={t("flag.group")}>
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
          <div className="claim-foot">
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

export function ResultsView({ state, draftLabel = null, focusWhenDone = false, onRetryClaim, onReadPart, onEvent, onFindSources, onFindWebSources, onAttachSource }: Props) {
  const { t, locale } = useT();
  // The part being read again, if any (one at a time: each is one model request).
  const [readingPart, setReadingPart] = useState<number | null>(null);
  const [chosen, setFilter] = useState<Verdict | "attention" | "optional" | "all">("attention");
  // Which sections the student opened or closed by hand, and how many cards each one shows.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [pages, setPages] = useState<Readonly<Record<string, number>>>({});
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [copiedFix, setCopiedFix] = useState<Record<string, "copied" | "failed">>({});
  const checked = state.claims.filter((claim) => claim.verdict !== null).length;
  const total = state.claims.length;
  // What needs attention is the fix list: a general statement with no citation is a suggestion, not a problem.
  const attention = state.fixList.length;
  const finished = state.phase === "done";
  // The scan is over and the cited claims wait for the student to start the check.
  const scanned = state.phase === "scanned";
  const uncited = state.claims.filter((claim) => claim.verdict === "no_citation_given");
  const needSource = uncited.filter((claim) => !isOptional(claim)).length;
  const couldUseSource = uncited.length - needSource;
  const notListed = state.counts.reference_not_found ?? 0;
  // "No citation" counts only what needs a source; the suggestions have their own filter.
  const chipCounts: Partial<Record<Verdict, number>> = { ...state.counts, no_citation_given: needSource };
  // Only No citation and Reference not found come from the scan; any other verdict means a source was really looked
  // at. Until then the result is a scan result, never "Check complete" and never "171 of 171 need attention".
  const sourceChecked = state.claims.some(
    (claim) => claim.verdict !== null && claim.verdict !== "no_citation_given" && claim.verdict !== "reference_not_found",
  );
  const scanView = scanned || (finished && !state.stopped && !sourceChecked);
  // Lead with the problem. "No sentence is missing a source" would read as an all-clear beside a citation not in the list.
  const scanHeadline =
    needSource > 0
      ? t(pluralKey(locale, "scan.need", needSource), { n: needSource })
      : notListed > 0
        ? t(pluralKey(locale, "scan.missingHead", notListed), { n: notListed })
        : t("scan.noneNeeded");
  const waiting = state.claims.filter((claim) => claim.verdict === null).length;
  // When nothing needs attention, an empty "Needs attention" list would contradict the tally, so show everything.
  const filter = chosen === "attention" && finished && attention === 0 ? "all" : chosen;
  // "Needs attention" lists the fix list and every claim still waiting for its check (see `shown`), so its count
  // is those two together. Counting only the fix list read "(1)" above five cards.
  const attentionCards = state.claims.filter((claim) => state.fixList.includes(claim.id) || claim.verdict === null).length;
  const isStopped = state.stopped;
  // "Check complete" and "Scan complete" repeat what the headline and the buttons say, so they are for screen readers only.
  const eyebrowHidden = scanView || (finished && !isStopped);
  const tally = isStopped
    ? checked === 0
      ? t("tally.stoppedNone")
      : `${t(pluralKey(locale, "tally.stoppedAfter", total), { checked, total })}${attention > 0 ? ` ${t(pluralKey(locale, "tally.suffix", attention), { n: attention })}` : ""}`
    : attention === 0
      ? t("tally.allSupported")
      : t(pluralKey(locale, "tally.attention", total), { n: attention, total });
  // Wrong years go in the summary too, by citation: a Supported card is hidden under "Needs attention", and its
  // year still needs fixing. One item per reference, named by the first citation that points at it.
  const yearItems = new Map<number, string>();
  for (const claim of state.claims) {
    for (const note of claim.yearNotes ?? []) {
      if (!yearItems.has(note.position)) {
        yearItems.set(note.position, t("tally.yearItem", { citation: claim.citation ?? "", published: note.published }));
      }
    }
  }

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

  // When a scan or check starts, the progress line is at the top of the results; the button that started it was at
  // the bottom, so on a long page the student is left looking at the cards. Bring the top into view, once per start.
  const phase = state.phase;
  useEffect(() => {
    if (phase !== "extracting" && phase !== "checking") return;
    const top = heading.current;
    if (!top) return;
    const { y } = top.getBoundingClientRect();
    if (y < 0 || y > window.innerHeight * 0.5) top.scrollIntoView?.({ block: "start" });
  }, [phase]);

  const shown = useMemo(() => {
    const ranked = new Map(state.fixList.map((id, index) => [id, index]));
    const rest = (a: ClaimView, b: ClaimView) => a.position - b.position;
    const list =
      filter === "all"
        ? state.claims
        : filter === "attention"
          ? state.claims.filter((claim) => ranked.has(claim.id) || claim.verdict === null)
          : filter === "optional"
            ? state.claims.filter(isOptional)
            : filter === "no_citation_given"
              ? state.claims.filter((claim) => claim.verdict === filter && !isOptional(claim))
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
      onFindSources={onFindSources}
      onFindWebSources={state.webSearch ? onFindWebSources : undefined}
      onAttachSource={onAttachSource}
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
        <p className={eyebrowHidden ? "eyebrow sr-only" : "eyebrow"}>
          {finished && !scanView
            ? isStopped
              ? t("results.eyebrow.stopped")
              : t("results.eyebrow.done")
            : scanView
              ? t("results.eyebrow.scanned")
              : state.phase === "error"
                ? t("results.eyebrow.error")
                : t("results.eyebrow.running")}
        </p>
        {/* Read by screen readers and shown when a keyboard user lands on it; the headline below says it for everyone else. */}
        <h2 id="results-title" className="results-title" ref={heading} tabIndex={-1}>
          {t("results.title")}
        </h2>
        {draftLabel && <p className="hint">{t("results.draft", { label: draftLabel })}</p>}
      </div>

      {/* Stays mounted so screen readers hear the outcome when the progress line goes away. */}
      <p className="sr-only" role="status">
        {finished
          ? total === 0
            ? isStopped
              ? t("sr.stoppedNone")
              : t("sr.noClaims")
            : t(isStopped ? "sr.stopped" : "sr.finished", { tally: scanView ? scanHeadline : tally })
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

      {finished && total === 0 && !isStopped && (
        <p className="empty">{t("empty.noClaims")}</p>
      )}
      {finished && total === 0 && isStopped && <p className="empty">{t("empty.stoppedNone")}</p>}

      {total > 0 && (
        <>
          {finished && !scanView && (
            <div className="tally">
              <p className="tally-number">{tally}</p>
              {/* The shape of the draft at a glance. Decorative: the headline and the filter counts carry the numbers. */}
              <div className="tally-bar" aria-hidden="true">
                {SUMMARY_ORDER.filter((verdict) => (state.counts[verdict] ?? 0) > 0).map((verdict) => (
                  <span key={verdict} className={`tally-seg tally-${VERDICT_INFO[verdict].tone}`} style={{ flexGrow: state.counts[verdict] }} />
                ))}
              </div>
              {yearItems.size > 0 && <p className="year-tag">{t("tally.years", { list: [...yearItems.values()].join("; ") })}</p>}
            </div>
          )}

          {scanView && (
            <div className="tally">
              <p className="tally-number">{scanHeadline}</p>
              <ul className="scan-list">
                {couldUseSource > 0 && <li>{t("scan.optional", { n: couldUseSource })}</li>}
                {notListed > 0 && needSource > 0 && <li>{t("scan.missing", { n: notListed })}</li>}
                {waiting > 0 && <li>{t("scan.ready", { n: waiting })}</li>}
              </ul>
            </div>
          )}

          <div className="chips chips-filter" role="group" aria-label={t("filter.group")}>
            <button type="button" className="chip" aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>
              {t("filter.attention", { n: attentionCards })}
            </button>
            {SUMMARY_ORDER.filter((verdict) => (chipCounts[verdict] ?? 0) > 0).map((verdict) => (
              <button key={verdict} type="button" className="chip" aria-pressed={filter === verdict} onClick={() => setFilter(verdict)}>
                <span aria-hidden="true">{VERDICT_INFO[verdict].symbol}</span> {verdictLabel(t, verdict)} ({chipCounts[verdict]})
              </button>
            ))}
            {couldUseSource > 0 && (
              <button type="button" className="chip" aria-pressed={filter === "optional"} onClick={() => setFilter("optional")}>
                {t("claim.optional")} ({couldUseSource})
              </button>
            )}
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
