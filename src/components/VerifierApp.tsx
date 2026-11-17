"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApi } from "@/lib/client/api";
import { buildReport } from "@/lib/client/report";
import type { ClientEventName, VerifyInput } from "@/lib/client/types";
import { DraftPanel } from "./DraftPanel";
import { ResultsView } from "./ResultsView";
import { SourcesPanel } from "./SourcesPanel";
import { CONSENT_KEY, readStored, writeStored } from "./storage";
import { useSources } from "./useSources";
import { useVerification } from "./useVerification";

// PLACEHOLDER WORDING AND BUCKETS: the privacy notice and the would-pay answers are drafts for Steven to approve.
const PRICE_BUCKETS = [
  { token: "free_only", label: "Only if it is free" },
  { token: "under_25k_idr", label: "Under Rp25.000" },
  { token: "25k_to_75k_idr", label: "Rp25.000 to Rp75.000" },
  { token: "over_75k_idr", label: "Over Rp75.000" },
];

export function VerifierApp() {
  const [waking, setWaking] = useState(false);
  const [api] = useState(() => createApi({ onWaking: setWaking }));
  const [consent, setConsent] = useState<boolean | null>(null);
  const lastInput = useRef<VerifyInput | null>(null);
  const [copied, setCopied] = useState(false);
  const [paid, setPaid] = useState<{ answer: "yes" | "maybe" | "no"; bucket: string } | null>(null);
  const [answered, setAnswered] = useState(false);

  const sources = useSources(api);
  const verification = useVerification(api);
  const { state } = verification;

  useEffect(() => {
    setConsent(readStored(CONSENT_KEY) === "yes");
  }, []);

  const { resume, lastRunId } = verification;
  useEffect(() => {
    if (consent !== true) return;
    const id = lastRunId();
    if (id) resume(id, true);
    // Only once, when the notice has been acknowledged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent]);

  const event = useCallback((name: ClientEventName, props?: Record<string, unknown>) => void api.event(name, props), [api]);

  const running = state.phase === "starting" || state.phase === "extracting" || state.phase === "checking";
  const idle = state.phase === "idle";

  const start = (input: VerifyInput) => {
    lastInput.current = input;
    setAnswered(false);
    verification.start(input);
  };

  if (consent === null) return <main className="page" aria-busy="true" />;

  if (!consent) {
    return (
      <main className="page">
        <h1>VerifiDocs</h1>
        <section className="card" aria-labelledby="notice-title">
          <h2 id="notice-title">Before you start</h2>
          <ul className="plain">
            <li>VerifiDocs checks each claim in your draft against the PDFs you upload. It is a self-check before you submit, not an AI detector and not a grader.</li>
            <li>Your draft, the text of your sources and your results are kept for 30 days, then deleted. The PDF files themselves are deleted as soon as their text is read.</li>
            <li>To check claims, pieces of your text are sent to the Google Gemini API, and reference titles are looked up in Crossref and OpenAlex.</li>
            <li>There are no accounts. This browser holds a private key to your checks; clear your browser data and you lose access to them.</li>
          </ul>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              writeStored(CONSENT_KEY, "yes");
              setConsent(true);
            }}
          >
            I understand
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header>
        <h1>VerifiDocs</h1>
        <p className="lede">Check every claim against your sources before you submit.</p>
      </header>

      {waking && (
        <p role="status" className="notice notice-info">
          The database is waking up. This can take a few seconds the first time. Please wait, nothing is lost.
        </p>
      )}

      <SourcesPanel rows={sources.rows} loaded={sources.loaded} notice={sources.notice} onAdd={sources.addFiles} onRetry={sources.retryRow} onRemove={sources.remove} />

      {idle ? (
        <DraftPanel disabled={sources.busy} disabledReason={sources.busy ? "Wait for your sources to finish reading." : null} onStart={start} />
      ) : (
        <>
          <ResultsView state={state} onRetryClaim={verification.retry} onEvent={event} />
          <div className="actions">
            {state.phase === "done" && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(buildReport(state.claims, state.fixList));
                      setCopied(true);
                      event("report_exported", { format: "copy" });
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "Report copied" : "Copy report"}
                </button>
                {lastInput.current && (
                  <button
                    type="button"
                    className="btn"
                    disabled={sources.busy}
                    onClick={() => {
                      event("recheck_started", { claims_rechecked: state.claims.length });
                      start(lastInput.current!);
                    }}
                  >
                    Check again with my sources
                  </button>
                )}
              </>
            )}
            <button type="button" className="btn btn-quiet" disabled={running} onClick={() => verification.reset()}>
              Start a new check
            </button>
          </div>

          {state.phase === "done" && (
            <section className="card" aria-labelledby="pay-title">
              <h2 id="pay-title">One question</h2>
              {answered ? (
                <p>Thank you.</p>
              ) : (
                <>
                  <p>If a tool like this were not free, would you pay for it?</p>
                  <div className="chips" role="group" aria-label="Would you pay">
                    {(["yes", "maybe", "no"] as const).map((answer) => (
                      <button key={answer} type="button" className={`chip${paid?.answer === answer ? " chip-on" : ""}`} aria-pressed={paid?.answer === answer} onClick={() => setPaid({ answer, bucket: paid?.bucket ?? "free_only" })}>
                        {answer === "yes" ? "Yes" : answer === "maybe" ? "Maybe" : "No"}
                      </button>
                    ))}
                  </div>
                  {paid && paid.answer !== "no" && (
                    <div className="field">
                      <label htmlFor="price">What would be fair?</label>
                      <select id="price" value={paid.bucket} onChange={(e) => setPaid({ ...paid, bucket: e.target.value })}>
                        {PRICE_BUCKETS.map((bucket) => (
                          <option key={bucket.token} value={bucket.token}>
                            {bucket.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={!paid}
                    onClick={() => {
                      if (!paid) return;
                      event("would_pay_answered", { answer: paid.answer, price_bucket: paid.answer === "no" ? "none" : paid.bucket });
                      setAnswered(true);
                    }}
                  >
                    Send
                  </button>
                </>
              )}
            </section>
          )}
        </>
      )}

      <footer className="hint">Drafts, source text and results are deleted 30 days after upload.</footer>
    </main>
  );
}
