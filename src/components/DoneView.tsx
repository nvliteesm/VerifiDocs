"use client";

// The finish: every issue has been handled. A big plain headline, the one thing to do next (copy the fixed draft), what
// changed in the student's own words, and a receipt of the counts. Everything shown is real: counts come from the
// check, and "Safe to send" is only said when the student left nothing as written that the source did not support.
import type { ReactNode } from "react";
import type { ClaimView } from "@/lib/client/types";
import { wordDiff } from "@/lib/client/word-diff";
import { useT } from "./LocaleProvider";

interface Props {
  label: string | null;
  claims: readonly ClaimView[];
  /** Claim id to the sentence that replaced it. */
  applied: Readonly<Record<string, string>>;
  /** Issues the student chose to leave as they wrote them. */
  ignoredCount: number;
  /** How many issues the check found (open or handled): 0 means every checked claim was supported from the start. */
  issuesFound: number;
  copied: "idle" | "copied" | "failed";
  reportCopied: "idle" | "copied" | "failed";
  onCopyDraft: () => void;
  onCopyReport?: () => void;
  onBack: () => void;
  survey?: ReactNode;
}

const MARK = (
  <svg width="64" height="64" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M8 4H4v18h4M18 4h4v18h-4" />
    <path d="M9 13.5l3 3 5.5-6.5" />
  </svg>
);

export function DoneView({ label, claims, applied, ignoredCount, issuesFound, copied, reportCopied, onCopyDraft, onCopyReport, onBack, survey }: Props) {
  const { t, locale } = useT();
  const fixed = Object.keys(applied).length;
  const checked = claims.filter((claim) => claim.verdict !== null).length;
  const supported = claims.filter((claim) => claim.verdict === "supported").length;
  const safe = ignoredCount === 0;
  const matched = supported + fixed;
  const changes = claims.filter((claim) => applied[claim.id] !== undefined).sort((a, b) => a.position - b.position);
  const when = new Date();
  const date = when.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const time = when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="done">
      <div className="done-grid">
        <div className="done-main">
          <div className="done-hero">
            <span className="done-mark">{MARK}</span>
            <h2 className="done-title">
              {safe ? t("done.safe.lead") : t("done.all.lead")} <em>{safe ? t("done.safe.em") : t("done.all.em")}</em>
            </h2>
            <p className="done-line">{issuesFound > 0 ? t("ws.done.handled", { n: issuesFound }) : t("ws.done.clean")}</p>
          </div>

          <div className="actions done-actions">
            {fixed > 0 && (
              <button type="button" className="btn btn-primary" onClick={onCopyDraft}>
                {copied === "copied" ? t("ws.copiedDraft") : t("ws.copyDraft")}
              </button>
            )}
            {onCopyReport && (
              <button type="button" className={fixed > 0 ? "btn" : "btn btn-primary"} onClick={onCopyReport}>
                {reportCopied === "copied" ? t("act.copied") : t("act.copy")}
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={onBack}>
              {t("done.back")}
            </button>
          </div>
          {copied === "failed" && (
            <p role="alert" className="hint hint-bad">
              {t("act.copyFail")}
            </p>
          )}
          {survey}

          {changes.length > 0 && (
            <section className="changes" aria-labelledby="changes-title">
              <h3 id="changes-title" className="sub-title">
                [ {t("done.changes")} ]
              </h3>
              <ul className="changes-list">
                {changes.map((claim) => {
                  const diff = wordDiff(claim.text, applied[claim.id]!);
                  return (
                    <li key={claim.id}>
                      <span className="change-from">
                        {diff.pre}
                        {diff.oldMid && <span className="wd-old">{diff.oldMid}</span>}
                        {diff.post}
                      </span>
                      <span>
                        {diff.pre}
                        {diff.newMid && <span className="wd-new">{diff.newMid}</span>}
                        {diff.post}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="receipt-wrap">
          <h3 className="sub-title">[ {t("done.receipt")} ]</h3>
          <div className="receipt">
            <div className="receipt-head">
              <span className="receipt-brand">
                <svg width="18" height="18" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="M8 4H4v18h4M18 4h4v18h-4" />
                  <path d="M9 13.5l3 3 5.5-6.5" />
                </svg>
                VERIFIDOCS
              </span>
              {label && <span>{label}</span>}
              <span>
                {date} · {time}
              </span>
            </div>
            <div className="receipt-body">
              <div className="receipt-row">
                <span>{t("done.r.checked")}</span>
                <span>{pad(checked)}</span>
              </div>
              <div className="receipt-row receipt-row-ok">
                <span>{t("done.r.ok")}</span>
                <span>{pad(supported)}</span>
              </div>
              <div className="receipt-row receipt-row-fix">
                <span>{t("done.r.fixed")}</span>
                <span>{pad(fixed)}</span>
              </div>
              <div className="receipt-row">
                <span>{t("done.r.left")}</span>
                <span>{pad(ignoredCount)}</span>
              </div>
            </div>
            <div className="receipt-total">
              <strong>
                {matched}/{checked}
              </strong>
              <span>{t("done.r.match")}</span>
            </div>
          </div>
        </div>

        <p className="done-foot">{t("done.foot")}</p>
      </div>
    </div>
  );
}
