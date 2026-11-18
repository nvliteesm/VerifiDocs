"use client";

import { useState } from "react";
import { MAX_DOCX_BYTES, MAX_DRAFT_CHARS, megabytes } from "@/lib/client/limits";
import type { VerifyInput } from "@/lib/client/types";
import { verdictLabel } from "@/lib/client/verdict-info";
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
}

export function DraftPanel({ disabled, disabledReason, noReadySources = false, onStart, initial = null, onTryExample, exampleNote = null, locked = false }: Props) {
  const { t, locale } = useT();
  const [mode, setMode] = useState<"paste" | "docx">(initial?.draft.kind === "docx" ? "docx" : "paste");
  const [text, setText] = useState(initial?.draft.kind === "paste" ? initial.draft.text : "");
  const [file, setFile] = useState<File | null>(initial?.draft.kind === "docx" ? initial.draft.file : null);
  const [references, setReferences] = useState(initial?.references ?? "");
  const [fileError, setFileError] = useState<string | null>(null);

  const tooLong = text.length > MAX_DRAFT_CHARS;
  const hasDraft = mode === "paste" ? text.trim().length > 0 && !tooLong : file !== null;
  const canStart = hasDraft && !disabled;

  function pickFile(picked: File | null) {
    setFileError(null);
    if (!picked) return setFile(null);
    if (!/\.docx$/i.test(picked.name)) {
      setFile(null);
      return setFileError(t("docx.errType"));
    }
    if (picked.size > MAX_DOCX_BYTES) {
      setFile(null);
      return setFileError(t("docx.errSize", { size: megabytes(MAX_DOCX_BYTES) }));
    }
    setFile(picked);
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
        <button type="button" aria-pressed={mode === "docx"} onClick={() => setMode("docx")}>
          {t("draft.mode.docx")}
        </button>
      </div>

      {mode === "paste" ? (
        <div className="field">
          <label htmlFor="draft-text">{t("draft.label")}</label>
          <textarea
            id="draft-text"
            rows={10}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("draft.placeholder")}
          />
          <p className={`hint${tooLong ? " hint-bad" : ""}`} aria-live="polite">
            {t("draft.count", { n: text.length.toLocaleString(locale), max: MAX_DRAFT_CHARS.toLocaleString(locale) })}
            {tooLong ? t("draft.tooLong") : ""}
          </p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="draft-file">{t("docx.label", { size: megabytes(MAX_DOCX_BYTES) })}</label>
          <input id="draft-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
          {file && <p className="hint">{t("docx.selected", { name: file.name })}</p>}
          {fileError && (
            <p role="alert" className="notice notice-warn">
              {fileError}
            </p>
          )}
        </div>
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
        <button type="button" className="btn btn-primary" disabled={!canStart} aria-describedby={canStart ? undefined : "start-reason"} onClick={() => onStart({ draft: mode === "paste" ? { kind: "paste", text } : { kind: "docx", file: file! }, references })}>
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
