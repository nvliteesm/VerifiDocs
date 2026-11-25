"use client";

// "Find a source" and "Search the web" on a claim with no citation. Moved out of ResultsView unchanged (25 Nov 2026).
import { useEffect, useRef, useState } from "react";
import { inTextCitation, referenceEntry, webInTextCitation, webReferenceEntry } from "@/lib/client/cite";
import type { ClaimView, FoundSourceView } from "@/lib/client/types";
import { copy, shortQuote } from "./claim-bits";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "./LocaleProvider";

export type AttachStage = "getting" | "reading" | "checking";

export type EventFn = (name: "evidence_opened" | "verdict_flagged_wrong" | "fix_accepted" | "source_copied", props?: Record<string, unknown>) => void;
/** Find a source for an uncited claim: null when it worked, else a message for the card. */
export type FindFn = (claimId: string) => Promise<string | null>;
/**
 * Check a claim against found paper `rank`: its free PDF (file null) or the student's upload. Reports each stage,
 * and resolves with null when the check ran, else a message for the card.
 */
export type AttachFn = (claimId: string, rank: number, title: string, file: File | null, stage: (stage: AttachStage) => void) => Promise<string | null>;

/** "Lee & Tan · 2024 · Journal" (the first two surnames, or the first and "et al."). */
function paperMeta(source: FoundSourceView): string {
  const names = source.authors.map((name) => name.trim().split(/\s+/).pop() ?? name);
  const who = names.length === 0 ? "" : names.length <= 2 ? names.join(" & ") : `${names[0]} et al.`;
  return [who, source.year ? String(source.year) : "n.d.", source.venue ?? ""].filter(Boolean).join(" · ");
}

/**
 * Find a source, on a No citation card. The papers are "not read yet" (PRD guard rule 1): the note sits right above
 * them, and nothing here changes the verdict. The button leaves the page when the answer arrives, so focus moves to
 * the answer.
 */
export function FoundSources({
  claim,
  onFind,
  onAttach,
  onFindWeb,
  onEvent,
}: {
  claim: ClaimView;
  onFind: (claimId: string) => Promise<string | null>;
  onAttach?: AttachFn;
  /** Offered under "No paper found" when web search is set up on the server. */
  onFindWeb?: FindFn;
  onEvent: EventFn;
}) {
  const { t } = useT();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Checking the claim against one paper: which one, and how far it has got. One at a time.
  const [attaching, setAttaching] = useState<{ rank: number; stage: AttachStage } | null>(null);
  const [attachError, setAttachError] = useState<{ rank: number; message: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<{ rank: number; title: string } | null>(null);

  const attach = async (rank: number, title: string, file: File | null) => {
    if (!onAttach) return;
    setAttachError(null);
    setAttaching({ rank, stage: "getting" });
    const failed = await onAttach(claim.id, rank, title, file, (stage) => setAttaching({ rank, stage }));
    // On success the claim has a new verdict and this block leaves the card; on failure it stays with the message.
    setAttaching(null);
    if (failed) setAttachError({ rank, message: failed });
  };
  const answer = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const justFound = useRef(false);
  useEffect(() => {
    if (claim.sourcesSearched && justFound.current) {
      justFound.current = false;
      // The answer is either the "No paper found" line or the list's heading: only one is on the page.
      (answer.current ?? titleRef.current)?.focus();
    }
  }, [claim.sourcesSearched]);

  if (!claim.sourcesSearched) {
    return (
      <div className="find">
        <button
          type="button"
          className="btn btn-small"
          disabled={searching}
          onClick={async () => {
            setSearching(true);
            setError(null);
            justFound.current = true;
            const failed = await onFind(claim.id);
            setSearching(false);
            if (failed) {
              justFound.current = false;
              setError(failed);
            }
          }}
        >
          {searching ? t("found.searching") : t("found.button")}
        </button>
        <span className="sr-only" role="status">
          {searching ? t("found.searching") : ""}
        </span>
        {error && (
          <p role="alert" className="hint hint-bad">
            {error}
          </p>
        )}
      </div>
    );
  }

  const sources = claim.sources ?? [];
  if (sources.length === 0) {
    return (
      <>
        <p className="hint found-none" ref={answer} tabIndex={-1}>
          {t("found.none")}
        </p>
        {onFindWeb && <WebSources claim={claim} onFind={onFindWeb} onEvent={onEvent} />}
      </>
    );
  }

  const copyText = async (key: string, text: string, kind: "reference" | "in_text") => {
    const ok = await copy(text);
    setCopied(ok ? key : null);
    if (ok) onEvent("source_copied", { kind });
  };

  return (
    <section className="found" aria-labelledby={`found-${claim.id}`}>
      <h4 className="found-title" id={`found-${claim.id}`} ref={titleRef} tabIndex={-1}>
        {t("found.title")}
      </h4>
      <p className="found-note">{t("found.unread")}</p>
      <ol className="found-list">
        {sources.map((source) => (
          <li key={source.rank}>
            {/* The arrow marks a link that leaves the app; the hidden words say so to a screen reader. */}
            <a className="found-paper" href={source.doi ?? source.openalexId} target="_blank" rel="noopener noreferrer">
              {source.title}
              <span aria-hidden="true"> ↗</span>
              <span className="sr-only"> {t("found.newTab")}</span>
            </a>
            <span className="hint">{paperMeta(source)}</span>
            {source.relevance === "related" && <span className="hint">{t("found.related")}</span>}
            <p className="found-quote">
              <span className="hint">{t("found.abstract")}</span> “{shortQuote(source.sentence)}”
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void copyText(`${source.rank}:ref`, referenceEntry(source), "reference")}
              >
                {copied === `${source.rank}:ref` ? t("found.copied") : t("found.copyRef")}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void copyText(`${source.rank}:in`, inTextCitation(source), "in_text")}
              >
                {copied === `${source.rank}:in` ? t("found.copied") : t("found.copyInText")}
              </button>
            </div>
            {onAttach && (
              <div className="actions">
                {source.openAccessPdf && (
                  <button type="button" className="btn btn-small" disabled={attaching !== null} onClick={() => void attach(source.rank, source.title, null)}>
                    {t("found.check")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={attaching !== null}
                  onClick={() => {
                    uploadFor.current = { rank: source.rank, title: source.title };
                    fileInput.current?.click();
                  }}
                >
                  {t("found.upload")}
                </button>
              </div>
            )}
            {attaching?.rank === source.rank && (
              <p role="status" className="hint">
                {t(`found.${attaching.stage}` as MessageKey)}
              </p>
            )}
            {attachError?.rank === source.rank && (
              <p role="alert" className="hint hint-bad">
                {attachError.message}
              </p>
            )}
          </li>
        ))}
      </ol>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept="application/pdf,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (file && uploadFor.current) void attach(uploadFor.current.rank, uploadFor.current.title, file);
        }}
      />
    </section>
  );
}

/** A page's address as a link target only when it is http(s); anything else is shown as plain text. */
function webHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

/** "25 November 2026", in the interface language. A date that cannot be read gives an empty string. */
function retrievedOn(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Search the web, under the "No paper found" line (docs/web-sources.md). The pages are "not read yet" and not peer
 * reviewed: the note sits right above them, and nothing here changes the verdict. The button leaves the page when
 * the answer arrives, so focus moves to the answer.
 */
export function WebSources({
  claim,
  onFind,
  onEvent,
}: {
  claim: ClaimView;
  onFind: (claimId: string) => Promise<string | null>;
  onEvent: EventFn;
}) {
  const { t, locale } = useT();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const answer = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const justFound = useRef(false);
  useEffect(() => {
    if (claim.webSearched && justFound.current) {
      justFound.current = false;
      (answer.current ?? titleRef.current)?.focus();
    }
  }, [claim.webSearched]);

  if (!claim.webSearched) {
    return (
      <div className="find">
        <button
          type="button"
          className="btn btn-small"
          disabled={searching}
          onClick={async () => {
            setSearching(true);
            setError(null);
            justFound.current = true;
            const failed = await onFind(claim.id);
            setSearching(false);
            if (failed) {
              justFound.current = false;
              setError(failed);
            }
          }}
        >
          {searching ? t("web.searching") : t("web.button")}
        </button>
        <span className="sr-only" role="status">
          {searching ? t("web.searching") : ""}
        </span>
        {error && (
          <p role="alert" className="hint hint-bad">
            {error}
          </p>
        )}
      </div>
    );
  }

  const pages = claim.webSources ?? [];
  if (pages.length === 0) {
    return (
      <p className="hint found-none" ref={answer} tabIndex={-1}>
        {t("web.none")}
      </p>
    );
  }

  const copyText = async (key: string, text: string, kind: "reference" | "in_text") => {
    const ok = await copy(text);
    setCopied(ok ? key : null);
    if (ok) onEvent("source_copied", { kind });
  };

  return (
    <section className="found" aria-labelledby={`web-${claim.id}`}>
      <h4 className="found-title" id={`web-${claim.id}`} ref={titleRef} tabIndex={-1}>
        {t("web.title")}
      </h4>
      <p className="found-note">{t("web.note")}</p>
      <ol className="found-list">
        {pages.map((page) => {
          const href = webHref(page.url);
          const date = retrievedOn(page.retrievedAt, locale);
          // A title's own trailing period is dropped, and the arrow is held to the last word so it never sits alone.
          const title = page.title.replace(/\.\s*$/, "");
          const words = title.split(" ");
          const last = words.pop() ?? "";
          const head = words.length > 0 ? `${words.join(" ")} ` : "";
          return (
            <li key={page.rank}>
              {href ? (
                <a className="found-paper" href={href} target="_blank" rel="noopener noreferrer">
                  {head}
                  <span className="link-end">
                    {last}
                    <span aria-hidden="true">{" ↗"}</span>
                  </span>
                  <span className="sr-only"> {t("found.newTab")}</span>
                </a>
              ) : (
                <span className="found-paper">{title}</span>
              )}
              <span className="hint">{date ? `${page.site} · ${t("web.retrieved", { date })}` : page.site}</span>
              {page.relevance === "related" && <span className="hint">{t("found.related")}</span>}
              <p className="found-quote">
                <span className="hint">{t("web.snippet")}</span> “{shortQuote(page.sentence)}”
              </p>
              <div className="actions">
                <button type="button" className="btn btn-small" onClick={() => void copyText(`${page.rank}:ref`, webReferenceEntry(page), "reference")}>
                  {copied === `${page.rank}:ref` ? t("found.copied") : t("found.copyRef")}
                </button>
                <button type="button" className="btn btn-small" onClick={() => void copyText(`${page.rank}:in`, webInTextCitation(page), "in_text")}>
                  {copied === `${page.rank}:in` ? t("found.copied") : t("found.copyInText")}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// `flagged` and `copied` live in ResultsView, because a card unmounts whenever the filter changes.
