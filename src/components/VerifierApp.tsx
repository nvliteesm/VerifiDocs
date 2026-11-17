"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApi } from "@/lib/client/api";
import { buildReport } from "@/lib/client/report";
import type { ClientEventName, VerifyInput } from "@/lib/client/types";
import { DraftPanel } from "./DraftPanel";
import { ResultsView } from "./ResultsView";
import { SourcesPanel } from "./SourcesPanel";
import { CONSENT_KEY, readStored, writeStored } from "./storage";
import { ThemeToggle } from "./ThemeToggle";
import { useSources } from "./useSources";
import { useVerification } from "./useVerification";

// PLACEHOLDER WORDING AND BUCKETS: the privacy notice and the would-pay answers are drafts for Steven to approve.
const PRICE_BUCKETS = [
  { token: "free_only", label: "Only if it is free" },
  { token: "under_25k_idr", label: "Under Rp25.000" },
  { token: "25k_to_75k_idr", label: "Rp25.000 to Rp75.000" },
  { token: "over_75k_idr", label: "Over Rp75.000" },
];

function Frame({ children, busy }: { children?: React.ReactNode; busy?: boolean }) {
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <span className="wordmark">
          Verifi<span>Docs</span>
        </span>
        <ThemeToggle />
      </header>
      <main id="main" aria-busy={busy}>
        {children}
      </main>
    </div>
  );
}

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

  if (consent === null) return <Frame busy />;

  if (!consent) {
    return (
      <Frame>
        <div className="intro">
          <h1>A self-check before you submit</h1>
          <p className="lede">VerifiDocs reads each claim in your draft and checks it against the PDFs you cite. It is not an AI detector and not a grader.</p>
        </div>
        <section className="panel gate" aria-labelledby="notice-title">
          <h2 id="notice-title">What happens to your files</h2>
          <ul className="promise">
            <li>
              <strong>Kept for 30 days, then deleted</strong>
              <span>Your draft, the text of your sources and your results. The PDF files themselves are deleted as soon as their text is read.</span>
            </li>
            <li>
              <strong>Sent to other services to do the check</strong>
              <span>Pieces of your text go to the Google Gemini API. Reference titles are looked up in Crossref and OpenAlex.</span>
            </li>
            <li>
              <strong>No account, one private key</strong>
              <span>This browser holds the key to your checks. If you clear your browser data, you lose access to them.</span>
            </li>
          </ul>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                writeStored(CONSENT_KEY, "yes");
                setConsent(true);
              }}
            >
              I understand, continue
            </button>
          </div>
        </section>
      </Frame>
    );
  }

  const readySources = sources.rows.filter((row) => row.phase === "ready").length;

  return (
    <Frame>
      <div className="intro">
        <h1>Check every claim against your sources</h1>
        <p className="lede">Add the PDFs you cite, paste your draft, and see which claims your sources really support.</p>
      </div>

      {waking && (
        <p role="status" className="notice notice-info" style={{ marginBottom: 20 }}>
          The database is waking up. This can take a few seconds the first time. Please wait, nothing is lost.
        </p>
      )}

      <div className="workspace">
        <div className="rail">
          <SourcesPanel rows={sources.rows} loaded={sources.loaded} notice={sources.notice} onAdd={sources.addFiles} onRetry={sources.retryRow} onRemove={sources.remove} />
        </div>

        <div className="main-col">
          {idle ? (
            <DraftPanel
              disabled={sources.busy}
              disabledReason={sources.busy ? "Wait for your sources to finish reading." : null}
              noReadySources={sources.loaded && readySources === 0}
              onStart={start}
            />
          ) : (
            <>
              <ResultsView state={state} onRetryClaim={verification.retry} onEvent={event} />
              <div className="actions">
                {state.phase === "done" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
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
                <section className="panel" aria-labelledby="pay-title">
                  <h2 id="pay-title">One question</h2>
                  {answered ? (
                    <p>Thank you.</p>
                  ) : (
                    <>
                      <p>If a tool like this were not free, would you pay for it?</p>
                      <div className="chips" role="group" aria-label="Would you pay">
                        {(["yes", "maybe", "no"] as const).map((answer) => (
                          <button key={answer} type="button" className="chip" aria-pressed={paid?.answer === answer} onClick={() => setPaid({ answer, bucket: paid?.bucket ?? "free_only" })}>
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
                      <div className="actions">
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
                          Send answer
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <footer className="hint" style={{ marginTop: 40 }}>
        Drafts, source text and results are deleted 30 days after upload.
      </footer>
    </Frame>
  );
}
