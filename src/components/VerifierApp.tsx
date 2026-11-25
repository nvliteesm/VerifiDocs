"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApi } from "@/lib/client/api";
import { exampleFor } from "@/lib/client/example";
import { pluralKey } from "@/lib/i18n";
import { buildReport } from "@/lib/client/report";
import { messageOf } from "@/lib/client/run-verification";
import type { ClientEventName, VerifyInput } from "@/lib/client/types";
import { DraftPanel } from "./DraftPanel";
import { LanguageToggle } from "./LanguageToggle";
import { useT } from "./LocaleProvider";
import type { AttachStage } from "./FoundSources";
import { SourcesPanel } from "./SourcesPanel";
import { CONSENT_KEY, readStored, writeStored } from "./storage";
import { ThemeToggle } from "./ThemeToggle";
import { useSources } from "./useSources";
import { useVerification } from "./useVerification";
import { Workspace } from "./Workspace";

function Frame({ children, busy, wide }: { children?: React.ReactNode; busy?: boolean; wide?: boolean }) {
  const { t } = useT();
  return (
    <div className={`shell${wide ? " shell-wide" : ""}`}>
      <a className="skip" href="#main">
        {t("skip")}
      </a>
      <header className="top">
        <span className="wordmark">
          Verifi<span>Docs</span>
        </span>
        <div className="tools">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" aria-busy={busy}>
        {children}
      </main>
    </div>
  );
}

export function VerifierApp() {
  const { t, locale, ready } = useT();
  const [waking, setWaking] = useState(false);
  const [api] = useState(() => createApi({ onWaking: setWaking }));
  // How the draft panel reads a Google Docs link or a PDF draft.
  const [importer] = useState(() => ({ link: api.importLink, pdf: api.importPdf }));
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
  // After the scan: the cited claims that still wait for a check.
  const waitingClaims = state.claims.filter((claim) => claim.verdict === null).length;
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(buildReport(state.claims, state.fixList, t, locale));
      setCopied("copied");
      event("report_exported", { format: "copy" });
    } catch {
      setCopied("failed");
    }
  };
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
    if (state.phase === "idle" || state.phase === "scanned" || state.phase === "done" || state.phase === "error") starting.current = false;
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
      // The example matches the screen's language: an Indonesian screen gets the Indonesian report and draft.
      const example = exampleFor(locale);
      const response = await fetch(example.sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const file = new File([await response.blob()], example.sourceFilename, { type: "application/pdf" });
      // A second press must not upload it again (the server would refuse the duplicate).
      if (!sources.rows.some((row) => row.filename === example.sourceFilename)) sources.addFiles([file]);
      setLastInput({ draft: { kind: "paste", text: example.draft }, references: example.references });
      setSeedKey((key) => key + 1);
    } catch {
      setExampleNote(t("example.fail"));
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

  /**
   * "Check my claim against it" on a found paper: the server gets the PDF (or takes the upload) and links it to the
   * claim; the paper is then read like any source (it appears in "Your sources"), and the claim is checked against
   * it. A failure before the link is made comes back to the card; after it, the check itself reports on the claim.
   */
  const attachSource = async (claimId: string, rank: number, title: string, file: File | null, stage: (stage: AttachStage) => void) => {
    try {
      const attached = await api.attachSource(claimId, rank, file ?? undefined);
      stage("reading");
      await sources.adopt({ documentId: attached.documentId, filename: `${title}.pdf`, status: attached.status, pageCount: attached.pageCount });
      stage("checking");
      await verification.retry(claimId);
      return null;
    } catch (error) {
      return messageOf(error, t, locale);
    }
  };

  // Both the privacy choice and the language live in the browser, so nothing is shown until both are known.
  if (consent === null || !ready) return <Frame busy />;

  const readySources = sources.rows.filter((row) => row.phase === "ready").length;

  return (
    <Frame wide={!idle}>
      {/* Once a check exists the results come first; the heading stays for screen readers (one h1 per page). */}
      {idle ? (
        <div className="intro">
          <h1>{t("app.title")}</h1>
          <p className="lede">{t("app.lede")}</p>
        </div>
      ) : (
        <h1 className="sr-only">{t("app.title")}</h1>
      )}

      {/* The product is visible at once. Until the student presses "Got it", checking and uploading stay locked,
          because both send text to other services. */}
      {!consent && (
        <section className="panel note" aria-labelledby="notice-title">
          <h2 id="notice-title">{t("note.title")}</h2>
          <ul className="promise">
            <li>
              <strong>{t("note.kept.title")}</strong>
              <span>{t("note.kept.body")}</span>
            </li>
            <li>
              <strong>{t("note.sent.title")}</strong>
              <span>{t("note.sent.body")}</span>
            </li>
            <li>
              <strong>{t("note.account.title")}</strong>
              <span>{t("note.account.body")}</span>
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
              {t("note.ok")}
            </button>
          </div>
        </section>
      )}

      {deleteNote === "deleted" && idle && (
        <p role="status" className="notice notice-info" style={{ marginBottom: 20 }} ref={deletedNote} tabIndex={-1}>
          {t("deleted")}
        </p>
      )}

      {waking && (
        <p role="status" className="notice notice-info" style={{ marginBottom: 20 }}>
          {t("waking")}
        </p>
      )}

      {idle ? (
        <div className="workspace">
          <div className="main-col">
            <DraftPanel
              key={seedKey}
              importer={importer}
              locked={!consent}
              // The scan reads only the draft, so it does not wait for the sources (UAT 23 Nov 2026: ten PDFs held
              // it for 38 s). The check of the cited claims does, below.
              disabled={!consent}
              disabledReason={!consent ? t("locked", { ok: t("note.ok") }) : null}
              noReadySources={sources.loaded && readySources === 0 && !sources.busy}
              initial={lastInput}
              onStart={start}
              onTryExample={tryExample}
              exampleNote={exampleNote}
            />
          </div>
          <div className="rail">
          <SourcesPanel
            rows={sources.rows}
            loaded={sources.loaded}
            notice={sources.notice}
            locked={!consent}
            onAdd={sources.addFiles}
            onRetry={sources.retryRow}
            onRemove={sources.remove}
          />
          </div>
        </div>
      ) : (
        <Workspace
          key={state.runId ?? "new"}
          state={state}
          draftText={lastInput?.draft.kind === "paste" ? lastInput.draft.text : null}
          draftLabel={lastInput?.label ?? null}
          focusWhenDone={lastInput !== null}
          sources={
            <SourcesPanel
              compact
              rows={sources.rows}
              loaded={sources.loaded}
              notice={sources.notice}
              locked={!consent}
              onAdd={sources.addFiles}
              onRetry={sources.retryRow}
              onRemove={sources.remove}
            />
          }
          actions={
            <>
                {state.phase === "scanned" && (
                  <>
                    <button type="button" className="btn btn-primary" disabled={sources.busy} onClick={verification.check}>
                      {t(pluralKey(locale, "act.checkCited", waitingClaims), { n: waitingClaims })}
                    </button>
                    <button type="button" className="btn" onClick={copyReport}>
                      {copied === "copied" ? t("act.copied") : t("act.copy")}
                    </button>
                    {lastInput && (
                      <button type="button" className="btn" onClick={() => verification.reset()}>
                        {t("act.edit")}
                      </button>
                    )}
                    {sources.busy ? (
                      <span className="hint">{t("wait.sources")}</span>
                    ) : (
                      readySources === 0 && <span className="hint">{t("scan.addSources")}</span>
                    )}
                  </>
                )}
                {state.phase === "done" && (
                  <>
                    <button type="button" className="btn btn-primary" onClick={copyReport}>
                      {copied === "copied" ? t("act.copied") : t("act.copy")}
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
                        {t("act.recheck")}
                      </button>
                    )}
                    {lastInput && (
                      <button type="button" className="btn" onClick={() => verification.reset()}>
                        {t("act.edit")}
                      </button>
                    )}
                  </>
                )}
                {state.phase === "error" && lastInput && (
                  <>
                    <button type="button" className="btn btn-primary" onClick={() => start(lastInput)}>
                      {t("retry")}
                    </button>
                    <button type="button" className="btn" onClick={() => verification.reset()}>
                      {t("act.edit")}
                    </button>
                  </>
                )}
                {running && (
                  <button type="button" className="btn" onClick={verification.stop}>
                    {t("act.stop")}
                  </button>
                )}
                {state.phase === "done" && !lastInput && <span className="hint">{t("recheck.hint")}</span>}
                <span className="sr-only" role="status">
                  {copied === "copied" ? t("act.copiedSr") : copied === "failed" ? t("act.copyFailSr") : ""}
                </span>
                {copied === "failed" && <span className="hint hint-bad">{t("act.copyFail")}</span>}
            </>
          }
          after={
            <>
              {/* Starting over and deleting sit apart from the main actions: one is rare, the other cannot be undone. */}
              <div className="actions actions-quiet">
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={running}
                  onClick={() => {
                    setLastInput(null);
                    verification.reset();
                  }}
                >
                  {t("act.new")}
                </button>
                {state.runId && !running && !confirmingDelete && (
                  <button type="button" className="btn btn-quiet" ref={deleteButton} onClick={() => setConfirmingDelete(true)}>
                    {t("act.delete")}
                  </button>
                )}
                {confirmingDelete && (
                  <span className="confirm" role="group" aria-label={t("delete.group")}>
                    <span className="hint">{t("delete.hint")}</span>
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
                      {t("delete.yes")}
                    </button>
                    <button type="button" className="btn btn-quiet" ref={keepButton} onClick={cancelDelete}>
                      {t("delete.keep")}
                    </button>
                  </span>
                )}
                {deleteNote === "failed" && (
                  <span role="alert" className="hint hint-bad">
                    {t("delete.failed")}
                  </span>
                )}
              </div>
              {state.phase === "done" && (
                <div className="survey">
                  {!answered && (
                    <>
                      <span className="hint" id="pay-title">
                        {t("survey.question")}
                      </span>
                      <div className="chips" role="group" aria-labelledby="pay-title">
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
                            {answer === "yes" ? t("survey.yes") : answer === "maybe" ? t("survey.maybe") : t("survey.no")}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <span className="hint" role="status">
                    {answered ? t("survey.thanks") : ""}
                  </span>
                </div>
              )}
            </>
          }
          onRetryClaim={verification.retry}
          onReadPart={verification.readPart}
          onFindSources={verification.findSources}
          onFindWebSources={verification.findWebSources}
          onAttachSource={attachSource}
          onEvent={event}
        />
      )}

      <footer className="hint" style={{ marginTop: 40 }}>
        {t("footer")}
      </footer>
    </Frame>
  );
}
