"use client";

import { useState } from "react";
import { MAX_DOCX_BYTES, MAX_DRAFT_CHARS, megabytes } from "@/lib/client/limits";
import type { VerifyInput } from "@/lib/client/types";

interface Props {
  /** True while sources are still being read or a check is running. */
  disabled: boolean;
  disabledReason: string | null;
  onStart: (input: VerifyInput) => void;
}

export function DraftPanel({ disabled, disabledReason, onStart }: Props) {
  const [mode, setMode] = useState<"paste" | "docx">("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [references, setReferences] = useState("");
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
    <section className="card" aria-labelledby="draft-title">
      <h2 id="draft-title">Your draft</h2>

      <div className="tabs" role="group" aria-label="How to add your draft">
        <button type="button" className={`tab${mode === "paste" ? " tab-on" : ""}`} aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>
          Paste text
        </button>
        <button type="button" className={`tab${mode === "docx" ? " tab-on" : ""}`} aria-pressed={mode === "docx"} onClick={() => setMode("docx")}>
          Upload .docx
        </button>
      </div>

      {mode === "paste" ? (
        <div className="field">
          <label htmlFor="draft-text">Paste the part of your draft to check</label>
          <textarea
            id="draft-text"
            rows={10}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste your paragraphs here, with the citations as you wrote them."
          />
          <p className={`hint${tooLong ? " hint-bad" : ""}`}>
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
          Reference list <span className="hint">(optional if it is already inside your draft)</span>
        </label>
        <textarea
          id="draft-refs"
          rows={6}
          value={references}
          onChange={(event) => setReferences(event.target.value)}
          placeholder="One reference per line, as in your bibliography."
        />
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!canStart} onClick={() => onStart({ draft: mode === "paste" ? { kind: "paste", text } : { kind: "docx", file: file! }, references })}>
          Check my claims
        </button>
        {disabled && disabledReason && <span className="hint">{disabledReason}</span>}
      </div>
    </section>
  );
}
