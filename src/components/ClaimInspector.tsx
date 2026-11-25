"use client";

// The right-hand pane, Claim tab: one claim at a time. The verdict and what it means, the sentence, the source's own
// words with file and page, why, and the fix, which the student applies to their working copy or ignores.
import { useEffect, useRef, useState } from "react";
import type { FlagReason } from "@/lib/flag-reasons";
import { localizeReason } from "@/lib/i18n/reasons";
import { NO_REFERENCE_LIST, NOT_IN_REFERENCE_LIST } from "@/lib/reasons";
import { markDifferences } from "@/lib/client/numbers";
import type { ClaimView } from "@/lib/client/types";
import { verdictAdvice, verdictMeaning } from "@/lib/client/verdict-info";
import { numberChange } from "@/lib/client/working-draft";
import { isOptional } from "@/lib/fix-list";
import { Badge, copy, Pieces } from "./claim-bits";
import { FlagVerdict } from "./FlagVerdict";
import { FoundSources, type AttachFn, type EventFn, type FindFn } from "./FoundSources";
import { useT } from "./LocaleProvider";

export type Resolution = "applied" | "ignored";

interface Props {
  claim: ClaimView | null;
  /** "C-3", the tag shown on the claim in the draft. */
  label: string | null;
  error?: string;
  /** The check has ended, so a claim with no verdict was not checked rather than waiting. */
  ended: boolean;
  /** The scan is over and the check has not started. */
  scanned: boolean;
  flagged: boolean;
  resolution: Resolution | null;
  /** The sentence is in the working draft, so a fix can be put in its place. */
  canApply: boolean;
  /** Where this claim is among the issues still open ("2 of 5"), or null when it is not one of them. */
  place: { at: number; of: number } | null;
  onPrev: () => void;
  onNext: () => void;
  onApply: () => void;
  onIgnore: () => void;
  onUndo: () => void;
  onFlag: (reason: FlagReason) => void;
  onRetry: () => void;
  onEvent: EventFn;
  onFindSources?: FindFn;
  onFindWebSources?: FindFn;
  onAttachSource?: AttachFn;
}

export function ClaimInspector(props: Props) {
  const { claim, label, error, ended, scanned, flagged, resolution, canApply, place, onPrev, onNext, onApply, onIgnore, onUndo, onFlag, onRetry, onEvent } = props;
  const { t } = useT();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const verdict = claim?.verdict ?? null;

  // Opening a claim with a quote is the student looking at the evidence. Once per claim, not on every re-render.
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (claim && verdict && claim.quote && reported.current !== claim.id) {
      reported.current = claim.id;
      onEvent("evidence_opened", { verdict });
    }
  }, [claim, verdict, onEvent]);

  const nav = (
    <div className="insp-nav" role="group" aria-label={t("ws.nav")}>
      <button type="button" className="btn btn-small" onClick={onPrev} aria-label={t("ws.prev")}>
        <span aria-hidden="true">‹</span>
      </button>
      {place && <span className="mono">{t("ws.place", { at: place.at, of: place.of })}</span>}
      <button type="button" className="btn btn-small" onClick={onNext} aria-label={t("ws.next")}>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );

  if (!claim) {
    return (
      <div className="insp">
        <div className="insp-head">
          <span />
          {nav}
        </div>
        <p className="empty">{t("ws.insp.empty")}</p>
      </div>
    );
  }

  // For an empty reference list the usual advice would point the wrong way, so it is left out (the reason says what to do).
  const listMissing = verdict === "reference_not_found" && Boolean(claim.reason?.includes(NO_REFERENCE_LIST));
  const notInList = verdict === "reference_not_found" && Boolean(claim.reason?.includes(NOT_IN_REFERENCE_LIST));
  const optional = isOptional(claim);
  // Numbers that differ between the sentence and the quote are marked in both. A fact from the numbers, not a verdict.
  const marks = claim.quote ? markDifferences(claim.text, claim.citation, claim.quote) : null;
  const numberMarks = marks?.any ? marks : null;
  const change = claim.fixSuggestion ? numberChange(claim.text, claim.fixSuggestion) : null;

  return (
    <div className="insp" id={`claim-${claim.id}`}>
      <div className="insp-head">
        <span className="mono">{label}</span>
        {nav}
      </div>

      <div className="insp-verdict">
        {verdict ? <Badge verdict={verdict} optional={optional} /> : <span className="badge badge-muted">{error || ended ? t("claim.notChecked") : scanned ? t("claim.notCheckedYet") : t("claim.waiting")}</span>}
        {verdict && !optional && <p className="meaning">{verdictMeaning(t, verdict)}</p>}
        {claim.citation && (
          <p className="mono citation">
            {claim.citation}
            {claim.citationInherited ? ` · ${t("claim.inherited")}` : ""}
          </p>
        )}
      </div>

      <blockquote className="insp-sentence">{numberMarks ? <Pieces pieces={numberMarks.claim} /> : claim.text}</blockquote>

      {/* The audit trail (PRD guard rule 2): this citation was attached here, after the claim was written. */}
      {claim.citationSource === "found" && <p className="found-tag">{t("claim.found")}</p>}
      {/* The reference exists but its year in the list is off. A separate fix: the verdict stands. */}
      {claim.yearNotes?.map((note) => (
        <p key={note.position} className="year-tag">
          {t("claim.year", { cited: note.cited, published: note.published })}
        </p>
      ))}

      {claim.quote && (
        <section className="evidence" aria-label={t("evidence.summary")}>
          <div className="evidence-head">
            <span className="mono evidence-file">{claim.sourceFile ?? ""}</span>
            <span className="mono evidence-page">{claim.page !== null ? t("ws.page", { n: claim.page }) : ""}</span>
          </div>
          <p className="evidence-quote">“{numberMarks ? <Pieces pieces={numberMarks.quote} /> : claim.quote}”</p>
          {numberMarks && <p className="hint evidence-note">{t("evidence.numbers")}</p>}
          {/* Help to read an English quote. The quote above stays the evidence; this line is never checked. */}
          {claim.quoteGloss && (
            <p className="gloss">
              <span className="gloss-label">{t("evidence.gloss")}</span> {claim.quoteGloss}
            </p>
          )}
        </section>
      )}

      {claim.reason && (
        <div>
          <h3 className="sub-title">{t("ws.why")}</h3>
          <p className="reason">{localizeReason(claim.reason, t)}</p>
        </div>
      )}
      {verdict && verdict !== "supported" && !listMissing && (
        <p className="next">
          <strong>{t("claim.todo")}</strong> {notInList ? t("claim.notInList") : optional ? t("claim.optionalAdvice") : verdictAdvice(t, verdict)}
        </p>
      )}

      {verdict === "no_citation_given" && props.onFindSources && (
        <FoundSources claim={claim} onFind={props.onFindSources} onAttach={props.onAttachSource} onFindWeb={props.onFindWebSources} onEvent={onEvent} />
      )}

      {verdict && verdict !== "supported" && !optional && (
        <section className="remedy" aria-labelledby="remedy-title">
          <div>
            <h3 id="remedy-title" className="remedy-title">
              {t("ws.fix.title")}
            </h3>
            {claim.fixSuggestion && !resolution && <p className="hint">{t("ws.fix.note")}</p>}
          </div>
          {resolution ? (
            <>
              <p className="remedy-done" role="status">
                {resolution === "applied" ? t("ws.fix.applied") : t("ws.fix.ignored")}
              </p>
              <div className="actions">
                <button type="button" className="btn btn-small" onClick={onUndo}>
                  {t("ws.fix.undo")}
                </button>
              </div>
            </>
          ) : (
            <>
              {claim.fixSuggestion ? (
                <>
                  {change && <p className="remedy-change">{t("ws.fix.change", { from: change.from, to: change.to })}</p>}
                  <div className="before-after">
                    <div>
                      <span className="ba-label">{t("ws.fix.before")}</span>
                      <p className="ba-before">{claim.text}</p>
                    </div>
                    <div>
                      <span className="ba-label ba-label-after">{t("ws.fix.after")}</span>
                      <p className="ba-after">{claim.fixSuggestion}</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="hint">{t("ws.fix.none")}</p>
              )}
              <div className="actions remedy-actions">
                {claim.fixSuggestion && canApply && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      onApply();
                      onEvent("fix_accepted");
                    }}
                  >
                    {t("ws.fix.apply")}
                  </button>
                )}
                {claim.fixSuggestion && !canApply && (
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const ok = await copy(claim.fixSuggestion!);
                      setCopied(ok ? "copied" : "failed");
                      if (ok) onEvent("fix_accepted");
                    }}
                  >
                    {copied === "copied" ? t("fix.copied") : t("fix.copy")}
                  </button>
                )}
                <button type="button" className="btn" onClick={onIgnore}>
                  {t("ws.fix.ignore")}
                </button>
              </div>
              {copied === "failed" && <span className="hint hint-bad">{t("fix.copyFail")}</span>}
            </>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="notice notice-warn">
          {error}{" "}
          <button type="button" className="btn btn-small" onClick={onRetry}>
            {t("retry")}
          </button>
        </p>
      )}

      {verdict && <FlagVerdict key={claim.id} claim={claim} flagged={flagged} onFlag={onFlag} />}
    </div>
  );
}
