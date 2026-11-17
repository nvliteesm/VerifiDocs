"use client";

import { useState } from "react";
import { MAX_DOCX_BYTES, MAX_DRAFT_CHARS, megabytes } from "@/lib/client/limits";
import type { VerifyInput } from "@/lib/client/types";

interface Props {
  /** True while sources are still being read or a check is running. */
  disabled: boolean;
  disabledReason: string | null;
  /** True once the source list has loaded and none of them is ready to check against. */
  noReadySources?: boolean;
  onStart: (input: VerifyInput) => void;
  /** The last submitted input, so a failed or finished check can be edited instead of retyped. */
  initial?: VerifyInput | null;
}

export function DraftPanel({ disabled, disabledReason, noReadySources = false, onStart, initial = null }: Props) {
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
      return setFileError("Choose a .docx file. Older .doc files are not supported; save as .docx first.");
    }
    if (picked.size > MAX_DOCX_BYTES) {
      setFile(null);
      return setFileError(`That file is larger than ${megabytes(MAX_DOCX_BYTES)}.`);
    }
    setFile(picked);
  }

  return (
    <section className="panel" aria-labelledby="draft-title">
      <div className="panel-head">
        <p className="eyebrow">Step 2 of 2</p>
        <h2 id="draft-title">Your draft</h2>
        <p className="hint">Paste the paragraphs you want checked, or upload a Word file. Keep your citations as you wrote them.</p>
      </div>

      <div className="segment" role="group" aria-label="How to add your draft">
        <button type="button" aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>
          Paste text
        </button>
        <button type="button" aria-pressed={mode === "docx"} onClick={() => setMode("docx")}>
          Upload .docx
        </button>
      </div>

      {mode === "paste" ? (
        <div className="field">
          <label htmlFor="draft-text">Draft text</label>
          <textarea
            id="draft-text"
            rows={10}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste your paragraphs here, with the citations as you wrote them."
          />
          <p className={`hint${tooLong ? " hint-bad" : ""}`} aria-live="polite">
            {text.length.toLocaleString()} / {MAX_DRAFT_CHARS.toLocaleString()} characters
            {tooLong ? ". Too long: check one chapter at a time." : ""}
          </p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="draft-file">Word document (.docx, up to {megabytes(MAX_DOCX_BYTES)})</label>
          <input id="draft-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
          {file && <p className="hint">Selected: {file.name}</p>}
          {fileError && (
            <p role="alert" className="notice notice-warn">
              {fileError}
            </p>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="draft-refs">
          Reference list <span className="hint">(needed to match your citations, unless the list is already inside your draft)</span>
        </label>
        <textarea
          id="draft-refs"
          rows={6}
          value={references}
          onChange={(event) => setReferences(event.target.value)}
          placeholder="One reference per line, as in your bibliography."
        />
      </div>

      {noReadySources && (
        <p className="notice notice-info">
          You have not added a readable source yet. You can still run a check, but claims will show as &ldquo;Can&apos;t check yet&rdquo; until you upload the PDFs you cite.
        </p>
      )}

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!canStart} aria-describedby={canStart ? undefined : "start-reason"} onClick={() => onStart({ draft: mode === "paste" ? { kind: "paste", text } : { kind: "docx", file: file! }, references })}>
          Check my claims
        </button>
        {disabled && disabledReason && (
          <span id="start-reason" className="hint">
            {disabledReason}
          </span>
        )}
        {!disabled && !hasDraft && (
          <span id="start-reason" className="hint">
            Add your draft to continue.
          </span>
        )}
      </div>
    </section>
  );
}
