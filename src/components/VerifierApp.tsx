"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApi } from "@/lib/client/api";
import { EXAMPLE_DRAFT, EXAMPLE_REFERENCES, EXAMPLE_SOURCE_FILENAME, EXAMPLE_SOURCE_URL } from "@/lib/client/example";
import { buildReport } from "@/lib/client/report";
import type { ClientEventName, VerifyInput } from "@/lib/client/types";
import { DraftPanel } from "./DraftPanel";
import { ResultsView } from "./ResultsView";
import { SourcesPanel } from "./SourcesPanel";
import { CONSENT_KEY, readStored, writeStored } from "./storage";
import { ThemeToggle } from "./ThemeToggle";
import { useSources } from "./useSources";
import { useVerification } from "./useVerification";

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
  // Kept in memory only: it lets a failed check be retried or edited without retyping. Never stored (Hard Rules 4 and 11).
  const [lastInput, setLastInput] = useState<VerifyInput | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [answered, setAnswered] = useState(false);
  // Deleting a check is permanent, so it takes a second, explicit step.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteNote, setDeleteNote] = useState<"deleted" | "failed" | null>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const deletedNote = useRef<HTMLParagraphElement>(null);
  const cancelledDelete = useRef(false);
  const cancelDelete = () => {
    cancelledDelete.current = true;
    setConfirmingDelete(false);
  };
  useEffect(() => {
    // Opening the prompt focuses the safe choice. Closing it without deleting puts focus back on the button that
    // opened it: the prompt's own buttons leave the page, and focus would otherwise fall to the top of the page.
    if (confirmingDelete) keepButton.current?.focus();
    else if (cancelledDelete.current) {
      cancelledDelete.current = false;
      deleteButton.current?.focus();
    }
  }, [confirmingDelete]);
  useEffect(() => {
    if (!confirmingDelete) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelDelete();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmingDelete]);
  useEffect(() => {
    // After a delete the buttons the student used are gone: move to the confirmation, which is also read aloud.
    if (deleteNote === "deleted") deletedNote.current?.focus();
  }, [deleteNote]);

  const sources = useSources(api);
  const verification = useVerification(api);
  const { state } = verification;

  // Whether the notice was acknowledged lives in the browser's storage, which the server cannot read, so it is
  // read after mount. Reading it during render would make the server and the first client render disagree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // "Edit draft", "Start a new check" and "Try again" all swap the results for the form, so the button that was
  // pressed is gone. Move focus to the draft box, the natural next place, instead of letting it fall to the page top.
  const wasIdle = useRef(true);
  useEffect(() => {
    // After a delete, focus goes to the confirmation message instead (its own effect), so step aside for it.
    if (idle && !wasIdle.current && deleteNote !== "deleted") document.getElementById("draft-text")?.focus();
    wasIdle.current = idle;
  }, [idle, deleteNote]);

  useEffect(() => {
    if (copied === "idle") return;
    const timer = setTimeout(() => setCopied("idle"), 3000);
    return () => clearTimeout(timer);
  }, [copied]);

  // The button only leaves the page after React re-renders, so clicks in the same instant could each start a run.
  // The ref flips synchronously and is released when the check reaches an end state.
  const starting = useRef(false);
  useEffect(() => {
    if (state.phase === "idle" || state.phase === "done" || state.phase === "error") starting.current = false;
  }, [state.phase]);

  // "Try an example": the made-up report goes through the normal upload path (so the student sees it read like any
  // other source), and the made-up draft and reference list fill the form. Remounting the form (the key) applies them.
  const [seedKey, setSeedKey] = useState(0);
  const [exampleNote, setExampleNote] = useState<string | null>(null);
  useEffect(() => {
    // The example button leaves the page once the draft is filled; focus goes to the filled draft, not the page top.
    // seedKey only changes when the example is loaded, and the form has been remounted with the example by then.
    if (seedKey > 0) document.getElementById("draft-text")?.focus();
  }, [seedKey]);
  const tryExample = async () => {
    setExampleNote(null);
    try {
      const response = await fetch(EXAMPLE_SOURCE_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const file = new File([await response.blob()], EXAMPLE_SOURCE_FILENAME, { type: "application/pdf" });
      // A second press must not upload it again (the server would refuse the duplicate).
      if (!sources.rows.some((row) => row.filename === EXAMPLE_SOURCE_FILENAME)) sources.addFiles([file]);
      setLastInput({ draft: { kind: "paste", text: EXAMPLE_DRAFT }, references: EXAMPLE_REFERENCES });
      setSeedKey((key) => key + 1);
    } catch {
      setExampleNote("Could not load the example. Check your connection and try again.");
    }
  };

  const start = (input: VerifyInput) => {
    if (starting.current) return;
    starting.current = true;
    setLastInput(input);
    setCopied("idle");
    setAnswered(false);
    setConfirmingDelete(false);
    setDeleteNote(null);
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

      {deleteNote === "deleted" && idle && (
        <p role="status" className="notice notice-info" style={{ marginBottom: 20 }} ref={deletedNote} tabIndex={-1}>
          Your check was deleted from our servers.
        </p>
      )}

      {waking && (
        <p role="status" className="notice notice-info" style={{ marginBottom: 20 }}>
          The database is waking up. This can take a few seconds the first time. Please wait, nothing is lost.
        </p>
      )}

      <div className={`workspace${idle ? "" : " has-run"}`}>
        <div className="rail">
          <SourcesPanel rows={sources.rows} loaded={sources.loaded} notice={sources.notice} onAdd={sources.addFiles} onRetry={sources.retryRow} onRemove={sources.remove} />
        </div>

        <div className="main-col">
          {idle ? (
            <DraftPanel
              key={seedKey}
              disabled={sources.busy}
              disabledReason={sources.busy ? "Wait for your sources to finish reading." : null}
              noReadySources={sources.loaded && readySources === 0}
              initial={lastInput}
              onStart={start}
              onTryExample={tryExample}
              exampleNote={exampleNote}
            />
          ) : (
            <>
              <ResultsView state={state} focusWhenDone={lastInput !== null} onRetryClaim={verification.retry} onEvent={event} />
              <div className="actions">
                {state.phase === "done" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(buildReport(state.claims, state.fixList));
                          setCopied("copied");
                          event("report_exported", { format: "copy" });
                        } catch {
                          setCopied("failed");
                        }
                      }}
                    >
                      {copied === "copied" ? "Report copied" : "Copy report"}
                    </button>
                    {lastInput && (
                      <button
                        type="button"
                        className="btn"
                        disabled={sources.busy}
                        onClick={() => {
                          event("recheck_started", { claims_rechecked: state.claims.length });
                          start(lastInput);
                        }}
                      >
                        Check again with my sources
                      </button>
                    )}
                    {lastInput && (
                      <button type="button" className="btn" onClick={() => verification.reset()}>
                        Edit draft
                      </button>
                    )}
                  </>
                )}
                {state.phase === "error" && lastInput && (
                  <>
                    <button type="button" className="btn btn-primary" onClick={() => start(lastInput)}>
                      Try again
                    </button>
                    <button type="button" className="btn" onClick={() => verification.reset()}>
                      Edit draft
                    </button>
                  </>
                )}
                {running && (
                  <button type="button" className="btn" onClick={verification.stop}>
                    Stop checking
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={running}
                  onClick={() => {
                    setLastInput(null);
                    verification.reset();
                  }}
                >
                  Start a new check
                </button>
                {state.runId && !running && !confirmingDelete && (
                  <button type="button" className="btn btn-quiet" ref={deleteButton} onClick={() => setConfirmingDelete(true)}>
                    Delete this check
                  </button>
                )}
                {confirmingDelete && (
                  <span className="confirm" role="group" aria-label="Delete this check?">
                    <span className="hint">This removes your draft and these results from our servers. It cannot be undone.</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={async () => {
                        const gone = await verification.deleteCheck();
                        setConfirmingDelete(false);
                        if (gone) {
                          setLastInput(null);
                          setDeleteNote("deleted");
                        } else {
                          setDeleteNote("failed");
                        }
                      }}
                    >
                      Yes, delete it
                    </button>
                    <button type="button" className="btn btn-quiet" ref={keepButton} onClick={cancelDelete}>
                      Keep it
                    </button>
                  </span>
                )}
                {deleteNote === "failed" && (
                  <span role="alert" className="hint hint-bad">
                    Could not delete the check. Try again in a moment.
                  </span>
                )}
                {state.phase === "done" && !lastInput && (
                  <span className="hint">To check again after reopening, start a new check and paste your draft. Your draft is not kept in this browser.</span>
                )}
                <span className="sr-only" role="status">
                  {copied === "copied" ? "Report copied to clipboard." : copied === "failed" ? "Could not copy. Your browser blocked clipboard access." : ""}
                </span>
                {copied === "failed" && <span className="hint hint-bad">Could not copy the report. Your browser blocked clipboard access.</span>}
              </div>

              {state.phase === "done" && (
                <section className="panel" aria-labelledby="pay-title">
                  <h2 id="pay-title">One question</h2>
                  {!answered && (
                    <>
                      <p>If a tool like this were not free, would you pay for it?</p>
                      <div className="chips" role="group" aria-label="Would you pay">
                        {(["yes", "maybe", "no"] as const).map((answer) => (
                          <button
                            key={answer}
                            type="button"
                            className="chip"
                            onClick={() => {
                              event("would_pay_answered", { answer });
                              setAnswered(true);
                            }}
                          >
                            {answer === "yes" ? "Yes" : answer === "maybe" ? "Maybe" : "No"}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <p role="status">{answered ? "Thank you." : ""}</p>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <footer className="hint" style={{ marginTop: 40 }}>
        Drafts, source text and results are deleted 30 days after upload, or sooner when you delete them.
      </footer>
    </Frame>
  );
}
