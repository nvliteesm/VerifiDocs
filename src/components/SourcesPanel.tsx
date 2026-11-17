"use client";

import { useRef, useState } from "react";
import { MAX_PDF_BYTES, MAX_SOURCES, megabytes } from "@/lib/client/limits";
import type { SourceRow } from "./useSources";

interface Props {
  rows: SourceRow[];
  loaded: boolean;
  notice: string | null;
  onAdd: (files: File[]) => void;
  onRetry: (row: SourceRow) => void;
  onRemove: (row: SourceRow) => void;
  /** True until the student has pressed "Got it" on the privacy note: an upload sends text to other services. */
  locked?: boolean;
}

function statusText(row: SourceRow): string {
  switch (row.phase) {
    case "uploading":
      return "Uploading…";
    case "ingesting":
      return row.pageCount ? `Reading page ${row.pagesIngested} of ${row.pageCount}…` : "Reading…";
    case "ready":
      return row.pageCount ? `Ready, ${row.pageCount} page${row.pageCount === 1 ? "" : "s"}` : "Ready";
    case "no_text":
      return "No text found. Upload a text PDF, not a scan.";
    case "failed":
      return row.error ?? "Could not be read.";
  }
}

export function SourcesPanel({ rows, loaded, notice, onAdd, onRetry, onRemove, locked = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <section className="panel panel-tray" aria-labelledby="sources-title">
      <div className="panel-head">
        <h2 id="sources-title">Your sources</h2>
        <p className="hint">
          PDFs you cite. Up to {MAX_SOURCES} files, {megabytes(MAX_PDF_BYTES)} each. Text PDFs only, no scans.
        </p>
      </div>

      <div
        className={`drop${dragging ? " drop-active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!locked) onAdd(Array.from(event.dataTransfer.files));
        }}
      >
        <button type="button" className="btn" disabled={locked} onClick={() => input.current?.click()}>
          Choose PDFs
        </button>
        <span className="hint">or drop them here</span>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          data-testid="source-input"
          onChange={(event) => {
            onAdd(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      {notice && (
        <p role="alert" className="notice notice-warn">
          {notice}
        </p>
      )}

      {loaded && rows.length === 0 && <p className="empty">No sources yet.</p>}

      {rows.length > 0 && (
        <ul className="source-list">
          {rows.map((row) => (
            <li key={row.key} className={`source source-${row.phase}`}>
              <div className="source-main">
                <span className="source-name">{row.filename}</span>
                <span className="source-status" aria-live="polite">
                  {statusText(row)}
                </span>
                {row.phase === "ingesting" && row.pageCount ? (
                  <progress max={row.pageCount} value={row.pagesIngested} aria-label={`Reading ${row.filename}`} />
                ) : null}
              </div>
              <div className="source-actions">
                {row.phase === "failed" && row.id && (
                  <button type="button" className="btn btn-small" onClick={() => onRetry(row)}>
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-small btn-quiet"
                  onClick={() => onRemove(row)}
                  disabled={row.phase === "uploading"}
                  aria-label={`Remove ${row.filename}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
