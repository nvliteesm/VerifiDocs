"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_DOCX_BYTES, MAX_DRAFT_CHARS, MAX_PDF_BYTES, MAX_TXT_BYTES, megabytes } from "@/lib/client/limits";
import { messageOf } from "@/lib/client/run-verification";
import type { ImportResponse, Importer, VerifyInput } from "@/lib/client/types";
import { verdictLabel } from "@/lib/client/verdict-info";
import { looksLikeGoogleDocLink } from "@/lib/import/google-link";
import { pluralKey, type MessageKey } from "@/lib/i18n";
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
}

type Mode = "paste" | "link" | "file";
/** What was read, kept so the note about it can change language and so edits can clear it. */
interface Imported {
  source: "link" | "pdf" | "txt";
  characters: number;
  warnings: ImportResponse["warnings"];
  /** How many references the document ends with; null when it is not known (a .txt file is read in the browser). */
  referenceCount: number | null;
}

/** Text read from a .txt file: no byte-order mark, \n line endings, no long runs of blank lines. */
function cleanTextFile(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

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
}: Props) {
  const { t, locale } = useT();
  const [mode, setMode] = useState<Mode>(initial?.draft.kind === "docx" ? "file" : "paste");
  const [text, setText] = useState(initial?.draft.kind === "paste" ? initial.draft.text : "");
  const [file, setFile] = useState<File | null>(initial?.draft.kind === "docx" ? initial.draft.file : null);
  const [references, setReferences] = useState(initial?.references ?? "");
  const [fileError, setFileError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [reading, setReading] = useState<"link" | "file" | null>(null);
  const [imported, setImported] = useState<Imported | null>(null);
  // After an import the text is shown as a short card, not a box that may hold a hundred pages. "Edit the text" opens the box.
  const [editing, setEditing] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);
  const showCard = imported !== null && !editing;

  const tooLong = text.length > MAX_DRAFT_CHARS;
  const hasDraft = mode === "file" ? file !== null : mode === "paste" && text.trim().length > 0 && !tooLong;
  const canStart = hasDraft && !disabled && reading === null;
  const busy = reading !== null || locked;

  // After something is read in, the card is shown and the cursor goes to the button that scans it (the link or file
  // control the student used has just left the page). Opening the text box moves it into the box instead.
  const justImported = useRef(false);
  useEffect(() => {
    if (!justImported.current) return;
    if (editing) document.getElementById("draft-text")?.focus();
    else if (imported) startButton.current?.focus();
    justImported.current = false;
  }, [imported, editing]);

  function showImported(read: { text: string; warnings: ImportResponse["warnings"]; referenceCount: number | null }, source: Imported["source"]) {
    justImported.current = true;
    setText(read.text);
    setMode("paste");
    setEditing(false);
    setFile(null);
    setFileError(null);
    setImported({ source, characters: read.text.length, warnings: read.warnings, referenceCount: read.referenceCount });
  }

  async function readLink(url: string) {
    if (!importer || reading || url.trim() === "") return;
    setFileError(null);
    setImported(null); // the note about the last read is no longer true
    setReading("link");
    try {
      showImported(await importer.link(url.trim()), "link");
      setLinkUrl("");
    } catch (error) {
      setFileError(messageOf(error, t, locale));
    } finally {
      setReading(null);
    }
  }

  async function pickFile(picked: File | null) {
    setFileError(null);
    if (!picked) return setFile(null);
    const name = picked.name.toLowerCase();

    if (name.endsWith(".docx")) {
      if (picked.size > MAX_DOCX_BYTES) {
        setFile(null);
        return setFileError(t("docx.errSize", { size: megabytes(MAX_DOCX_BYTES) }));
      }
      return setFile(picked);
    }

    setFile(null);
    setImported(null);
    const isPdf = name.endsWith(".pdf");
    const isTxt = name.endsWith(".txt");
    if ((!isPdf && !isTxt) || (isPdf && !importer)) return setFileError(t("docx.errType"));
    const limit = isPdf ? MAX_PDF_BYTES : MAX_TXT_BYTES;
    if (picked.size > limit) return setFileError(t("docx.errSize", { size: megabytes(limit) }));

    setReading("file");
    try {
      if (isPdf) showImported(await importer!.pdf(picked), "pdf");
      else showImported({ text: cleanTextFile(await picked.text()), warnings: [], referenceCount: null }, "txt");
    } catch (error) {
      setFileError(isTxt ? t("file.txtFail") : messageOf(error, t, locale));
    } finally {
      setReading(null);
    }
  }

  return (
    <section className="panel" aria-labelledby="draft-title">
      <div className="panel-head">
        <h2 id="draft-title">{t("draft.title")}</h2>
        <p className="hint">{t("draft.hint")}</p>
      </div>

      {onTryExample && text.trim() === "" && file === null && (
        <div className="example">
          <button type="button" className="btn btn-quiet" disabled={locked} onClick={onTryExample}>
            {t("example.button")}
          </button>
          <span className="hint">{t("example.hint")}</span>
        </div>
      )}
      {exampleNote && (
        <p role="alert" className="notice notice-warn">
          {exampleNote}
        </p>
      )}

      <div className="segment" role="group" aria-label={t("draft.mode.group")}>
        <button type="button" aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>
          {t("draft.mode.paste")}
        </button>
        {importer && (
          <button type="button" aria-pressed={mode === "link"} onClick={() => setMode("link")}>
            {t("draft.mode.link")}
          </button>
        )}
        <button type="button" aria-pressed={mode === "file"} onClick={() => setMode("file")}>
          {t("draft.mode.docx")}
        </button>
      </div>

      {mode === "paste" && showCard && imported && (
        <div className="import-card">
          <p role="status" className="notice notice-info">
            {t("import.done", {
              n: imported.characters.toLocaleString(locale),
              source: t(`import.source.${imported.source}` as MessageKey),
              check: t("check.button"),
            })}
          </p>
          {imported.referenceCount !== null && (
            <p className="hint">
              {imported.referenceCount > 0
                ? t(pluralKey(locale, "import.refs", imported.referenceCount), { n: imported.referenceCount.toLocaleString(locale) })
                : t("import.norefs")}
            </p>
          )}
          {imported.warnings.includes("footnotes") && (
            <p className="notice notice-warn">{t("import.footnotes", { label: verdictLabel(t, "no_citation_given") })}</p>
          )}
          {imported.warnings.includes("tables") && <p className="notice notice-warn">{t("import.tables")}</p>}
          <blockquote className="import-preview" aria-label={t("import.preview")}>
            {text.trim().slice(0, 320)}
            {text.trim().length > 320 ? "…" : ""}
          </blockquote>
          <div className="actions">
            <button type="button" className="btn btn-quiet" onClick={() => { justImported.current = true; setEditing(true); }}>
              {t("import.edit")}
            </button>
          </div>
        </div>
      )}

      {mode === "paste" && !showCard && (
        <div className="field">
          <label htmlFor="draft-text">{t("draft.label")}</label>
          <textarea
            id="draft-text"
            rows={10}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setImported(null);
            }}
            placeholder={t("draft.placeholder")}
          />
          <p className={`hint${tooLong ? " hint-bad" : ""}`} aria-live="polite">
            {t("draft.count", { n: text.length.toLocaleString(locale), max: MAX_DRAFT_CHARS.toLocaleString(locale) })}
            {tooLong ? t("draft.tooLong") : ""}
          </p>
          {/* A student who pastes the link instead of the draft gets one press to read it. */}
          {importer && looksLikeGoogleDocLink(text) && (
            <div className="example">
              <span className="hint">{t("link.detected")}</span>
              <button type="button" className="btn" disabled={busy} onClick={() => void readLink(text)}>
                {t("link.button")}
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "link" && importer && (
        <div className="field">
          <label htmlFor="draft-link">{t("link.label")}</label>
          <input
            id="draft-link"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={linkUrl}
            placeholder={t("link.placeholder")}
            aria-describedby="draft-link-hint"
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!busy) void readLink(linkUrl);
              }
            }}
          />
          <p className="hint" id="draft-link-hint">
            {t("link.hint")}
          </p>
          <div className="actions">
            <button type="button" className="btn" disabled={busy || linkUrl.trim() === ""} onClick={() => void readLink(linkUrl)}>
              {t("link.button")}
            </button>
          </div>
        </div>
      )}

      {mode === "file" && (
        <div className="field">
          <label htmlFor="draft-file">{t("file.label")}</label>
          <input
            id="draft-file"
            type="file"
            disabled={busy}
            accept={`.docx,.txt,${importer ? ".pdf," : ""}application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain${importer ? ",application/pdf" : ""}`}
            onChange={(event) => void pickFile(event.target.files?.[0] ?? null)}
          />
          {file && <p className="hint">{t("docx.selected", { name: file.name })}</p>}
        </div>
      )}

      {reading !== null && (
        <p role="status" className="hint">
          {reading === "link" ? t("link.reading") : t("file.reading")}
        </p>
      )}
      {fileError && (
        <p role="alert" className="notice notice-warn">
          {fileError}
        </p>
      )}
      <div className="field">
        <label htmlFor="draft-refs">
          {t("refs.label")} <span className="hint">{t("refs.hint")}</span>
        </label>
        <textarea
          id="draft-refs"
          rows={6}
          value={references}
          onChange={(event) => setReferences(event.target.value)}
          placeholder={t("refs.placeholder")}
        />
      </div>

      {noReadySources && (
        <p className="notice notice-info">
          {t("nosrc.notice", { label: verdictLabel(t, "cant_check") })}
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          ref={startButton}
          disabled={!canStart}
          aria-describedby={canStart ? undefined : "start-reason"}
          onClick={() => onStart({ draft: mode === "file" ? { kind: "docx", file: file! } : { kind: "paste", text }, references })}
        >
          {t("check.button")}
        </button>
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
      </div>
    </section>
  );
}
