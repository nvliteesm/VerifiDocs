"use client";

// Where each reference's source file stands, in the student's own words: "4 of 12 sources retrieved", then the ones that
// need a yes or no, then the ones that still need a file, by their real titles. Nothing here says a reference is wrong:
// a source that could not be retrieved only means the file has to come from the student.
import { useRef, useState } from "react";
import type { ReferenceSummary } from "@/lib/client/references";
import type { ReferenceSource } from "@/lib/client/types";
import { useT } from "./LocaleProvider";

interface Props {
  refs: readonly ReferenceSource[];
  summary: ReferenceSummary;
  running: boolean;
  /** The server refused another source: the limit for one check. */
  limit: boolean;
  onConfirm: (id: string, accept: boolean) => Promise<void>;
  onUpload: (id: string, file: File) => Promise<void>;
  /** Starts the lookup for a run that has not had one (a check reopened after a reload). */
  onFind?: () => void;
  /** Claims that still wait for a source, and whether a source is ready to check them against. */
  waiting: number;
  canCheck: boolean;
  onCheckWaiting?: () => void;
}

export function SourceOverview({ refs, summary, running, limit, onConfirm, onUpload, onFind, waiting, canCheck, onCheckWaiting }: Props) {
  const { t } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  if (summary.total === 0) return <p className="hint">{t("ov.none")}</p>;

  const possible = refs.filter((ref) => ref.sourceState === "possible");
  const missing = refs.filter((ref) => ref.sourceState === "not_retrieved" || ref.sourceState === "matched_no_file");
  const retrieved = refs.filter((ref) => ref.sourceState === "retrieved" || ref.sourceState === "uploaded");
  const looked = summary.total - summary.pending;

  const hint = (ref: ReferenceSource) =>
    ref.sourceState === "matched_no_file" ? t("ov.hint.nofile") : ref.refType === "regulation" || ref.refType === "standard" ? t("ov.hint.document") : t("ov.hint.missing");

  const run = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    setFailed(null);
    try {
      await work();
    } catch {
      setFailed(id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="overview" aria-labelledby="ov-title">
      <div className="ov-head">
        <h2 id="ov-title" className="ov-title">
          {t("ov.title", { retrieved: summary.retrieved, total: summary.total })}
        </h2>
        <div className="ov-bar" role="img" aria-label={t("ov.bar")}>
          {summary.retrieved > 0 && <span className="ov-seg ov-ok" style={{ flexGrow: summary.retrieved }} />}
          {summary.possible > 0 && <span className="ov-seg ov-ask" style={{ flexGrow: summary.possible }} />}
          {summary.missing > 0 && <span className="ov-seg ov-need" style={{ flexGrow: summary.missing }} />}
          {summary.pending > 0 && <span className="ov-seg ov-wait" style={{ flexGrow: summary.pending }} />}
        </div>
        {running ? (
          <p className="hint" role="status">
            <span className="pulse-dot" aria-hidden="true" />
            {t("ov.looking", { done: looked, total: summary.total })}
          </p>
        ) : (
          summary.pending > 0 &&
          onFind && (
            <button type="button" className="btn btn-primary" onClick={onFind}>
              {t("ov.find")}
            </button>
          )
        )}
        {limit && (
          <p role="alert" className="notice notice-warn">
            {t("ov.limit")}
          </p>
        )}
        {!running && canCheck && waiting > 0 && onCheckWaiting && (
          <button type="button" className="btn btn-primary" onClick={onCheckWaiting}>
            {t("ov.checkWaiting")}
          </button>
        )}
      </div>

      {possible.length > 0 && (
        <div className="ov-group">
          <h3 className="sub-title">
            [ {t("ov.possible")} · {possible.length} ]
          </h3>
          <ul className="ov-list">
            {possible.map((ref) => (
              <li key={ref.id} className="ov-item ov-ask-item">
                <p className="ov-q">{t("ov.confirm.q")}</p>
                <p className="ov-name">{ref.candidate?.title ?? ref.title}</p>
                <p className="ov-by">
                  {[ref.candidate?.year, ref.candidate?.venue].filter(Boolean).join(" · ")}
                </p>
                <p className="ov-yours hint">{ref.title}</p>
                <div className="actions">
                  <button type="button" className="btn btn-small btn-primary" disabled={busy === ref.id} onClick={() => run(ref.id, () => onConfirm(ref.id, true))}>
                    {t("ov.confirm.yes")}
                  </button>
                  <button type="button" className="btn btn-small" disabled={busy === ref.id} onClick={() => run(ref.id, () => onConfirm(ref.id, false))}>
                    {t("ov.confirm.no")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <div className="ov-group">
          <h3 className="sub-title">
            [ {t("ov.missing")} · {missing.length} ]
          </h3>
          <ul className="ov-list">
            {missing.map((ref) => (
              <li key={ref.id} className="ov-item">
                <p className="ov-name">{ref.title}</p>
                {ref.byline && <p className="ov-by mono">{ref.byline}</p>}
                <p className="hint">{hint(ref)}</p>
                <div className="actions">
                  <button type="button" className="btn btn-small" disabled={busy === ref.id} onClick={() => inputs.current[ref.id]?.click()}>
                    {busy === ref.id ? t("ov.uploading") : t("ov.upload")}
                  </button>
                  <input
                    ref={(element) => {
                      inputs.current[ref.id] = element;
                    }}
                    type="file"
                    hidden
                    accept="application/pdf,.pdf"
                    aria-label={`${t("ov.upload")}: ${ref.title}`}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void run(ref.id, () => onUpload(ref.id, file));
                    }}
                  />
                  {failed === ref.id && (
                    <span role="alert" className="hint hint-bad">
                      {t("ov.uploadFail")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {retrieved.length > 0 && (
        <details className="ov-group ov-done" open={missing.length === 0 && possible.length === 0}>
          <summary>
            {t("ov.retrieved")} <span className="mono">{retrieved.length}</span>
          </summary>
          <ul className="ov-list">
            {retrieved.map((ref) => (
              <li key={ref.id} className="ov-item">
                <p className="ov-name">{ref.candidate?.title ?? ref.title}</p>
                <p className="hint">{ref.sourceState === "uploaded" ? t("ov.youUploaded") : t("ov.foundOnline")}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
