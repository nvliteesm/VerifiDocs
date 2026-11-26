"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_DOCX_BYTES, MAX_DRAFT_CHARS, MAX_PDF_BYTES, MAX_TXT_BYTES, megabytes } from "@/lib/client/limits";
import { messageOf } from "@/lib/client/run-verification";
import type { ImportResponse, Importer, VerifyInput } from "@/lib/client/types";
import { verdictLabel } from "@/lib/client/verdict-info";
import { looksLikeGoogleDocLink } from "@/lib/import/google-link";
import { pluralKey } from "@/lib/i18n";
import { useT } from "./LocaleProvider";

interface Props {
  /** True while sources are still being read or a check is running. */
  disabled: boolean;
  disabledReason: string | null;
  /** True once the source list has loaded and none of them is ready to check against. */
  noReadySources?: boolean;
  onStart: (input: VerifyInput) => void;
  /** The last submitted input, so a failed or finished check can be edited instead of retyped. */
  initial?: VerifyInput | null;
  /** Loads the made-up example report and draft. Offered only while the draft is still empty. */
  onTryExample?: () => void;
  /** Why the example could not be loaded, if it could not. */
  exampleNote?: string | null;
  /** True until the student has pressed "Got it" on the privacy note: the example sends text out, so it waits too. */
  locked?: boolean;
  /** Reads a Google Docs link or a PDF draft. Without it only pasting, .docx and .txt are offered. */
  importer?: Importer;
  /** The heading and one line above the draft card. */
  intro?: ReactNode;
  /** The sources step. It has its own upload handlers, which belong to the app. */
  sources?: ReactNode;
  /** The privacy line under the button. */
  footer?: ReactNode;
  /** What the sources list holds, for the "Ready to check" cards. */
  sourceSummary?: { total: number; ready: number; scans: number; reading: boolean };
}

/**
 * A draft that was read in (a link or a file) rather than pasted. It is shown as one line, never in the text box: a
 * hundred pages in a box is not something the student can review there, and they edit it in their own document.
 */
interface Loaded {
  /** "Google Doc" or the file name. */
  label: string;
  /** The text read from a link, PDF or .txt; null for a .docx, which the server reads. */
  text: string | null;
  /** The .docx itself, sent to the server as it is. */
  file: File | null;
  characters: number | null;
  /** How many references the document ends with; null when it is not known (.docx, .txt, a reopened draft). */
  referenceCount: number | null;
  warnings: ImportResponse["warnings"];
}

/** Text read from a .txt file: no byte-order mark, \n line endings, no long runs of blank lines. */
function cleanTextFile(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function loadedFrom(initial: VerifyInput | null): Loaded | null {
  if (!initial) return null;
  if (initial.draft.kind === "docx") {
    return { label: initial.label ?? initial.draft.file.name, text: null, file: initial.draft.file, characters: null, referenceCount: null, warnings: [] };
  }
  if (!initial.label) return null;
  const text = initial.draft.text;
  return { label: initial.label, text, file: null, characters: text.length, referenceCount: null, warnings: [] };
}

// The start screen: three steps (draft, reference list, source PDFs) and one button, in one calm column.
export function DraftPanel({
  disabled,
  disabledReason,
  noReadySources = false,
  onStart,
  initial = null,
  onTryExample,
  exampleNote = null,
  locked = false,
  importer,
  intro,
  sources,
  footer,
  sourceSummary = { total: 0, ready: 0, scans: 0, reading: false },
}: Props) {
  const { t, locale } = useT();
  const [loaded, setLoaded] = useState<Loaded | null>(() => loadedFrom(initial));
  const [text, setText] = useState(initial?.draft.kind === "paste" && !initial.label ? initial.draft.text : "");
  const [references, setReferences] = useState(initial?.references ?? "");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<"link" | "file" | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);

  const tooLong = (loaded ? (loaded.characters ?? 0) : text.length) > MAX_DRAFT_CHARS;
  const pastedLink = !loaded && importer !== undefined && looksLikeGoogleDocLink(text);
  const hasDraft = loaded ? !tooLong : text.trim().length > 0 && !tooLong && !pastedLink;
  const canStart = hasDraft && !disabled && reading === null;
  const busy = reading !== null || locked;
  // The reference list box is open when the student will need it: they already typed one, or the document they
  // brought in has none at its end.
  const [refsOpen, setRefsOpen] = useState(references.trim() !== "");

  function input(next: Loaded | null): VerifyInput | null {
    if (next?.file) return { draft: { kind: "docx", file: next.file }, references, label: next.label };
    if (next?.text != null) return { draft: { kind: "paste", text: next.text }, references, label: next.label };
    if (!next && text.trim()) return { draft: { kind: "paste", text }, references };
    return null;
  }

  // After a link or file is read, the scan starts at once when nothing is missing. When something is (no reference
  // list was found, the draft is too long, sources are still uploading), the card stays and focus goes to what to do.
  const justLoaded = useRef(false);
  useEffect(() => {
    if (!justLoaded.current || !loaded) return;
    justLoaded.current = false;
    const ready = !disabled && (loaded.characters ?? 0) <= MAX_DRAFT_CHARS;
    if (ready && loaded.referenceCount !== 0) {
      const next = input(loaded);
      if (next) return onStart(next);
    }
    if (loaded.referenceCount === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the box is the answer to what was just read
      setRefsOpen(true);
      // Wait for the box to open before moving into it.
      requestAnimationFrame(() => document.getElementById("draft-refs")?.focus());
    } else {
      startButton.current?.focus();
    }
    // Runs once per read-in draft; `input` and `onStart` are read at that moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  function show(next: Loaded) {
    justLoaded.current = true;
    setText("");
    setError(null);
    setLoaded(next);
  }

  async function readLink(url: string) {
    if (!importer || reading || url.trim() === "") return;
    setError(null);
    setReading("link");
    try {
      const read = await importer.link(url.trim());
      show({
        label: t("import.source.link"),
        text: read.text,
        file: null,
        characters: read.text.length,
        referenceCount: read.referenceCount,
        warnings: read.warnings,
      });
    } catch (failure) {
      setError(messageOf(failure, t, locale));
    } finally {
      setReading(null);
    }
  }

  async function pickFile(picked: File | null) {
    setError(null);
    if (!picked) return;
    const name = picked.name.toLowerCase();

    if (name.endsWith(".docx")) {
      if (picked.size > MAX_DOCX_BYTES) return setError(t("docx.errSize", { size: megabytes(MAX_DOCX_BYTES) }));
      return show({ label: picked.name, text: null, file: picked, characters: null, referenceCount: null, warnings: [] });
    }

    const isPdf = name.endsWith(".pdf");
    const isTxt = name.endsWith(".txt");
    if ((!isPdf && !isTxt) || (isPdf && !importer)) return setError(t("docx.errType"));
    const limit = isPdf ? MAX_PDF_BYTES : MAX_TXT_BYTES;
    if (picked.size > limit) return setError(t("docx.errSize", { size: megabytes(limit) }));

    setReading("file");
    try {
      const read = isPdf
        ? await importer!.pdf(picked)
        : { text: cleanTextFile(await picked.text()), warnings: [] as ImportResponse["warnings"], referenceCount: null };
      show({ label: picked.name, text: read.text, file: null, characters: read.text.length, referenceCount: read.referenceCount, warnings: read.warnings });
    } catch (failure) {
      setError(isTxt ? t("file.txtFail") : messageOf(failure, t, locale));
    } finally {
      setReading(null);
    }
  }

  function change() {
    setLoaded(null);
    setError(null);
    requestAnimationFrame(() => document.getElementById("draft-text")?.focus());
  }

  const tick = (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3.5 8.4l3 3 6-6.6" />
    </svg>
  );

  return (
    <div className="start">
      <section className="start-main" aria-labelledby="draft-title">
        {intro}

        <div className="steps">
          <div className={`step${hasDraft ? " step-done" : ""}`}>
            <div className="step-head">
              <span className="step-n" aria-hidden="true">
                [{hasDraft ? tick : "1"}]
              </span>
              <div className="step-text">
                <h2 id="draft-title" className="step-title">
                  {t("draft.title")}
                </h2>
                <p className="step-sub">{importer ? t("draft.hint") : t("draft.hintNoLink")}</p>
              </div>
              {onTryExample && !loaded && text.trim() === "" && (
                <button type="button" className="btn" disabled={locked} onClick={onTryExample}>
                  {t("example.button")}
                </button>
              )}
            </div>

            <div className="step-body">
              {onTryExample && !loaded && text.trim() === "" && <p className="hint">{t("example.hint")}</p>}
              {exampleNote && (
                <p role="alert" className="notice notice-warn">
                  {exampleNote}
                </p>
              )}

              {loaded ? (
                <div className="draft-card">
                  <div className="draft-card-main">
                    <p className="draft-card-name">{loaded.label}</p>
                    {loaded.characters !== null && (
                      <p className={`hint${tooLong ? " hint-bad" : ""}`}>
                        {t("draft.count", { n: loaded.characters.toLocaleString(locale), max: MAX_DRAFT_CHARS.toLocaleString(locale) })}
                        {tooLong ? t("draft.tooLong") : ""}
                      </p>
                    )}
                    {loaded.referenceCount !== null && (
                      <p className="hint">
                        {loaded.referenceCount > 0
                          ? t(pluralKey(locale, "import.refs", loaded.referenceCount), { n: loaded.referenceCount.toLocaleString(locale) })
                          : t("import.norefs")}
                      </p>
                    )}
                  </div>
                  <button type="button" className="link" disabled={busy} onClick={change}>
                    {t("draft.change")}
                  </button>
                  {loaded.warnings.includes("footnotes") && (
                    <p className="notice notice-warn draft-card-note">{t("import.footnotes", { label: verdictLabel(t, "no_citation_given") })}</p>
                  )}
                  {loaded.warnings.includes("tables") && <p className="notice notice-warn draft-card-note">{t("import.tables")}</p>}
                </div>
              ) : (
                <div
                  className={`field draft-drop${dragging ? " drop-active" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    if (!busy) void pickFile(event.dataTransfer.files?.[0] ?? null);
                  }}
                >
                  <label htmlFor="draft-text">{importer ? t("draft.label") : t("draft.labelNoLink")}</label>
                  <textarea
                    id="draft-text"
                    rows={8}
                    value={text}
                    disabled={reading !== null}
                    onChange={(event) => setText(event.target.value)}
                    onPaste={(event) => {
                      // A pasted Google Docs link is read at once: the student never sees the link sit in the box.
                      const pasted = event.clipboardData.getData("text");
                      if (importer && !locked && text.trim() === "" && looksLikeGoogleDocLink(pasted)) {
                        event.preventDefault();
                        void readLink(pasted);
                      }
                    }}
                    placeholder={importer ? t("draft.placeholder") : t("draft.placeholderNoLink")}
                  />
                  <div className="draft-tools">
                    <button type="button" className="btn btn-small" disabled={busy} onClick={() => fileInput.current?.click()}>
                      {t("file.choose")}
                    </button>
                    <span className="hint">{importer ? t("file.types") : t("file.typesNoPdf")}</span>
                    <input
                      ref={fileInput}
                      type="file"
                      // Opened by the "Choose a file" button; a visually hidden input still took its full width on a phone.
                      hidden
                      accept={`.docx,.txt,${importer ? ".pdf," : ""}application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain${importer ? ",application/pdf" : ""}`}
                      onChange={(event) => {
                        void pickFile(event.target.files?.[0] ?? null);
                        event.target.value = "";
                      }}
                    />
                  </div>
                  {text.length > 0 && !pastedLink && (
                    <p className={`hint${tooLong ? " hint-bad" : ""}`} aria-live="polite">
                      {t("draft.count", { n: text.length.toLocaleString(locale), max: MAX_DRAFT_CHARS.toLocaleString(locale) })}
                      {tooLong ? t("draft.tooLong") : ""}
                    </p>
                  )}
                  {/* A link typed rather than pasted gets one press to read it. */}
                  {pastedLink && (
                    <div className="example">
                      <span className="hint">{t("link.detected")}</span>
                      <button type="button" className="btn" disabled={busy} onClick={() => void readLink(text)}>
                        {t("link.button")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {reading !== null && (
                <p role="status" className="hint">
                  {reading === "link" ? t("link.reading") : t("file.reading")}
                </p>
              )}
              {error && (
                <p role="alert" className="notice notice-warn">
                  {error}
                </p>
              )}
            </div>
          </div>

          <details className={`step refs${references.trim() !== "" ? " step-done" : ""}`} open={refsOpen} onToggle={(event) => setRefsOpen(event.currentTarget.open)}>
            <summary>
              <span className="step-n" aria-hidden="true">
                [{references.trim() !== "" ? tick : "2"}]
              </span>
              <span className="step-title">{t("refs.label")}</span>
              <span className="hint">{t("refs.hint")}</span>
            </summary>
            <div className="step-body">
              <div className="field">
                <label htmlFor="draft-refs" className="sr-only">
                  {t("refs.label")}
                </label>
                <textarea id="draft-refs" rows={6} value={references} onChange={(event) => setReferences(event.target.value)} placeholder={t("refs.placeholder")} />
              </div>
            </div>
          </details>

          {sources}
        </div>

        {/* Only once there is a draft: before that it warns about a mistake the student has not made. */}
        {noReadySources && hasDraft && <p className="notice notice-info">{t("nosrc.notice", { label: verdictLabel(t, "cant_check") })}</p>}

        <div className="start-go" role="group" aria-label={t("start.ready")}>
          <button
            type="button"
            className="btn btn-primary"
            ref={startButton}
            disabled={!canStart}
            aria-describedby={canStart ? undefined : "start-reason"}
            onClick={() => {
              const next = input(loaded);
              if (next) onStart(next);
            }}
          >
            {t("check.button")}
          </button>
          <p className="ready-line">
            <span>
              {hasDraft ? t("start.r.draft") : t("start.r.noDraft")}{" "}
              {sourceSummary.total === 0 ? t("start.r.noSrc") : t("start.r.src", { ready: sourceSummary.ready, total: sourceSummary.total })}
            </span>
            {sourceSummary.scans > 0 && (
              <span className="hint ready-note">{t(pluralKey(locale, "start.src.scan", sourceSummary.scans), { n: sourceSummary.scans, label: verdictLabel(t, "cant_check") })}</span>
            )}
            {sourceSummary.reading && <span className="hint ready-note">{t("start.src.reading")}</span>}
            {disabled && disabledReason && (
              <span id="start-reason" className="hint">
                {disabledReason}
              </span>
            )}
            {!disabled && !hasDraft && (
              <span id="start-reason" className="hint">
                {t("check.needDraft")}
              </span>
            )}
          </p>
        </div>

        {footer}
      </section>
    </div>
  );
}
