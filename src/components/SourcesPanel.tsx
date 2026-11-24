"use client";

import { useRef, useState } from "react";
import { MAX_PDF_BYTES, MAX_SOURCES, megabytes } from "@/lib/client/limits";
import { pluralKey, type Locale, type Translate } from "@/lib/i18n";
import { useT } from "./LocaleProvider";
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

function statusText(row: SourceRow, t: Translate, locale: Locale): string {
  switch (row.phase) {
    case "waiting":
      return t("src.waiting");
    case "uploading":
      return t("src.uploading");
    case "ingesting":
      return row.pageCount ? t("src.readingPages", { done: row.pagesIngested, total: row.pageCount }) : t("src.reading");
    case "ready":
      return row.pageCount ? t(pluralKey(locale, "src.readyPages", row.pageCount), { n: row.pageCount }) : t("src.ready");
    case "no_text":
      return t("src.noText");
    case "failed":
      return row.error ?? t("src.failed");
  }
}

export function SourcesPanel({ rows, loaded, notice, onAdd, onRetry, onRemove, locked = false }: Props) {
  const { t, locale } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <section className="panel panel-tray" aria-labelledby="sources-title">
      <div className="panel-head">
        <h2 id="sources-title">{t("src.title")}</h2>
        <p className="hint">{t("src.hint", { max: MAX_SOURCES, size: megabytes(MAX_PDF_BYTES) })}</p>
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
          {t("src.choose")}
        </button>
        <span className="hint">{t("src.drop")}</span>
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

      {loaded && rows.length === 0 && <p className="empty">{t("src.empty")}</p>}

      {rows.length > 0 && (
        <ul className="source-list">
          {rows.map((row) => (
            <li key={row.key} className={`source source-${row.phase}`}>
              <div className="source-main">
                <span className="source-name">{row.filename}</span>
                <span className="source-status" aria-live="polite">
                  {statusText(row, t, locale)}
                </span>
                {row.phase === "ingesting" && row.pageCount ? (
                  <progress max={row.pageCount} value={row.pagesIngested} aria-label={t("src.progress", { name: row.filename })} />
                ) : null}
              </div>
              <div className="source-actions">
                {row.phase === "failed" && row.id && (
                  <button type="button" className="btn btn-small" onClick={() => onRetry(row)}>
                    {t("retry")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-small btn-quiet"
                  onClick={() => onRemove(row)}
                  disabled={row.phase === "uploading"}
                  aria-label={t("src.removeLabel", { name: row.filename })}
                >
                  {t("src.remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
