"use client";

// The workspace shown once a check exists: the draft as a page on the left, one issue at a time on the right (a sheet
// that slides up on a phone), and sources and filters in a drawer. It owns which claim is selected, which fixes were applied or
// ignored, and which pane a phone shows. Applied fixes live here, in memory, and are never sent anywhere (Hard Rules 4
// and 11). The journey rules it follows are DESIGN.md section 4b.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FlagReason } from "@/lib/flag-reasons";
import { localizeReason } from "@/lib/i18n/reasons";
import { verdictLabel } from "@/lib/client/verdict-info";
import type { ClaimView } from "@/lib/client/types";
import type { VerifierState } from "@/lib/client/verifier-state";
import { buildWorkingDraft, fitFix, openIssues, resolvedText, stepIssue } from "@/lib/client/working-draft";
import { ClaimFilters, FILTER_ORDER, type Filter } from "./ClaimFilters";
import { ClaimInspector, type Resolution } from "./ClaimInspector";
import { ClaimList } from "./ClaimList";
import { VerdictIcon, copy } from "./claim-bits";
import { DoneView } from "./DoneView";
import { DraftCanvas } from "./DraftCanvas";
import type { AttachFn, EventFn, FindFn } from "./FoundSources";
import { useT } from "./LocaleProvider";
import { RunStatus } from "./RunStatus";

interface Props {
  state: VerifierState;
  /** The pasted draft, or null when the browser has none (a .docx, or a check reopened after a reload). */
  draftText: string | null;
  draftLabel: string | null;
  focusWhenDone: boolean;
  /** The scan has ended and the check will start by itself once the sources finish reading. */
  waitingForSources?: boolean;
  /** The sources list, with its own upload and retry handlers, which belong to the app. */
  sources: ReactNode;
  /** The quiet buttons of the top bar: check, copy report, edit, check again, new check, delete. */
  actions: ReactNode;
  /** Copies the report (the app owns it); offered again in the done state. */
  onCopyReport?: () => void;
  reportCopied?: "idle" | "copied" | "failed";
  /** The one-question survey, asked in the done state. */
  survey?: ReactNode;
  onRetryClaim: (claimId: string) => void;
  onReadPart?: (unit: number) => Promise<void>;
  onEvent: EventFn;
  onFindSources?: FindFn;
  onFindWebSources?: FindFn;
  onAttachSource?: AttachFn;
}

export function Workspace(props: Props) {
  const { state, draftText, draftLabel, focusWhenDone, waitingForSources = false, sources, actions, onCopyReport, reportCopied = "idle", survey } = props;
  const { onRetryClaim, onReadPart, onEvent, onFindSources, onFindWebSources, onAttachSource } = props;
  const { t } = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [applied, setApplied] = useState<Readonly<Record<string, string>>>({});
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(new Set());
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  // Sources and filters live in a drawer that slides over the draft, closed until the student asks for it.
  const [sideOpen, setSideOpen] = useState(false);
  const sideToggle = useRef<HTMLButtonElement>(null);
  const sideClose = useRef<HTMLButtonElement>(null);
  const sideWasOpen = useRef(false);
  // After "Back to the draft" on the done screen: the number of handled issues then, so any later change brings it back.
  const [backAt, setBackAt] = useState<number | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last Apply fix or Ignore, kept on screen with Undo after the panel has moved on.
  const [lastAction, setLastAction] = useState<{ id: string; kind: Resolution } | null>(null);
  const lastActionLine = useRef<HTMLParagraphElement>(null);

  const finished = state.phase === "done";
  const scanned = state.phase === "scanned";
  const scanning = state.phase === "starting" || state.phase === "extracting";
  const working = useMemo(() => buildWorkingDraft(draftText, state.claims), [draftText, state.claims]);
  const placed = useMemo(() => new Set(working.segments.flatMap((segment) => (segment.kind === "claim" ? [segment.claim.id] : []))), [working]);

  const resolutions = useMemo(() => {
    const map = new Map<string, Resolution>();
    for (const id of ignored) map.set(id, "ignored");
    for (const id of Object.keys(applied)) map.set(id, "applied");
    return map;
  }, [applied, ignored]);
  const resolvedIds = useMemo(() => new Set(resolutions.keys()), [resolutions]);
  const issues = useMemo(() => openIssues(state.claims, state.fixList, resolvedIds), [state.claims, state.fixList, resolvedIds]);
  // Issues found by the check, open or handled.
  const handled = state.fixList.filter((id) => resolvedIds.has(id)).length;
  const issuesFound = issues.length + handled;

  const counts = useMemo(() => {
    const out = { all: state.claims.length, waiting: 0 } as Record<Filter, number>;
    for (const verdict of FILTER_ORDER) out[verdict] = 0;
    for (const claim of state.claims) out[claim.verdict ?? "waiting"] += 1;
    return out;
  }, [state.claims]);
  const shown = useMemo(
    () => (filter === "all" ? null : new Set(state.claims.filter((claim) => (filter === "waiting" ? claim.verdict === null : claim.verdict === filter)).map((claim) => claim.id))),
    [filter, state.claims],
  );
  // The list shows what the left rail's filter keeps; the draft mutes the rest.
  const listed = useMemo(() => (shown ? state.claims.filter((claim) => shown.has(claim.id)) : state.claims), [shown, state.claims]);

  const active = state.claims.find((claim) => claim.id === activeId) ?? null;
  const at = active ? issues.findIndex((claim) => claim.id === active.id) : -1;

  const select = useCallback((id: string) => {
    setActiveId(id);
    // Bring the sentence into view in the draft, gliding unless the student asked for less motion.
    const calm = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`hl-${id}`)?.scrollIntoView?.({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, []);
  const step = (direction: 1 | -1) => {
    const next = stepIssue(issues, activeId, direction, active?.position);
    if (next) select(next.id);
  };

  // J3: when a check the student started this visit ends, open the most serious open issue (unless they already
  // picked a claim while it ran).
  const wasChecking = useRef(state.phase === "checking");
  useEffect(() => {
    if (wasChecking.current && finished && focusWhenDone && activeId === null) {
      const first = state.fixList.find((id) => !resolvedIds.has(id));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the first issue is the answer to the check ending
      if (first) select(first);
    }
    wasChecking.current = state.phase === "checking";
    // Runs when the phase changes; the other values are read at that moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // The drawer: Escape closes it, opening moves focus into it, and closing puts focus back on the button that opened it.
  useEffect(() => {
    if (!sideOpen) {
      if (sideWasOpen.current) sideToggle.current?.focus();
      sideWasOpen.current = false;
      return;
    }
    sideWasOpen.current = true;
    sideClose.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSideOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sideOpen]);

  // The Apply fix and Ignore buttons leave the page with the claim, so focus goes to the line that says what happened.
  useEffect(() => {
    if (lastAction) lastActionLine.current?.focus();
  }, [lastAction]);

  const undo = (id: string) => {
    setApplied((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setIgnored((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  /** J4: apply or ignore, then move straight on to the next open issue (or to the done state). */
  const resolve = (claim: ClaimView, kind: Resolution) => {
    if (kind === "applied" && claim.fixSuggestion) {
      const sentence = fitFix(claim.text, claim.fixSuggestion);
      setApplied((prev) => ({ ...prev, [claim.id]: sentence }));
    } else {
      setIgnored((prev) => new Set(prev).add(claim.id));
    }
    setLastAction({ id: claim.id, kind });
    const remaining = issues.filter((issue) => issue.id !== claim.id);
    const next = stepIssue(remaining, claim.id, 1, claim.position);
    if (next) select(next.id);
    else setActiveId(null);
  };

  const copyDraft = async () => {
    const ok = await copy(resolvedText(working, applied));
    setCopied(ok ? "copied" : "failed");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied("idle"), 3000);
  };

  const flag = (id: string, reason: FlagReason) => {
    setFlagged((prev) => new Set(prev).add(id));
    const verdict = state.claims.find((claim) => claim.id === id)?.verdict;
    if (verdict) onEvent("verdict_flagged_wrong", { verdict, reason });
  };

  // J3 and J5: one plain line for the outcome, counting down as the student fixes. Ink, not red.
  const resultLine =
    finished && !state.stopped && state.claims.length > 0
      ? issuesFound === 0
        ? t("ws.done.clean")
        : handled === 0
          ? t("ws.r.result", { n: issues.length, s: counts.supported })
          : t("ws.r.fixing", { left: issues.length, done: handled })
      : null;
  const showDone = finished && !state.stopped && state.claims.length > 0 && issues.length === 0 && activeId === null;
  const reviewing = backAt !== null && backAt === resolvedIds.size;
  const doneScreen = showDone && !reviewing;
  // While the check runs, the first open issue is offered at once so the student can start before it ends.
  const firstOpen = state.phase === "checking" ? state.claims.find((claim) => claim.id === state.fixList.find((id) => !resolvedIds.has(id))) : undefined;
  const showReady = state.phase === "checking" && activeId === null && (firstOpen !== undefined || counts.supported > 0);
  const lastLabel = lastAction ? (working.labels.get(lastAction.id) ?? "") : "";

  return (
    <div className="ws" data-sheet={active ? "open" : "closed"}>
      <RunStatus state={state} focusWhenDone={focusWhenDone} onReadPart={onReadPart} waitingForSources={waitingForSources} />

      <>
        <div className="ws-bar">
          {resultLine && (
            <div className="result">
              <p className="result-line">{resultLine}</p>
              <div className="stats-bar" role="img" aria-label={t("ws.s.bar")}>
                {FILTER_ORDER.filter((verdict) => counts[verdict] > 0).map((verdict) => (
                  <span key={verdict} className={`bar-seg v-${verdict}`} style={{ flexGrow: counts[verdict] }} />
                ))}
                {counts.waiting > 0 && <span className="bar-seg v-waiting" style={{ flexGrow: counts.waiting }} />}
              </div>
            </div>
          )}
          <div className="actions ws-actions">
            {actions}
            <button type="button" ref={sideToggle} className="btn btn-quiet btn-small ws-toggle" aria-expanded={sideOpen} aria-controls="side" onClick={() => setSideOpen((open) => !open)}>
              {sideOpen ? t("ws.side.hide") : t("ws.side.show")}
            </button>
          </div>
        </div>

        {doneScreen && (
          <DoneView
            label={draftLabel}
            claims={state.claims}
            applied={applied}
            ignoredCount={ignored.size}
            issuesFound={issuesFound}
            copied={copied}
            reportCopied={reportCopied}
            onCopyDraft={copyDraft}
            onCopyReport={onCopyReport}
            onBack={() => setBackAt(resolvedIds.size)}
            survey={survey}
          />
        )}

        {/* While the done screen shows, the draft and review column stay mounted but out of sight, so "Back to the draft" returns to the same place. */}
        <div className="ws-grid" data-side={sideOpen ? "open" : "closed"} data-done={doneScreen ? "true" : undefined}>
          <aside className="pane pane-side" id="side" aria-label={t("ws.side")}>
            <div className="drawer-head">
              <h2>{t("ws.side")}</h2>
              <button type="button" ref={sideClose} className="btn btn-small" onClick={() => setSideOpen(false)}>
                {t("ws.side.close")}
              </button>
            </div>
            {sources}
            {state.claims.length > 0 && (
              <div className="side-filters">
                <h2 className="pane-title">{t("ws.filtersTitle")}</h2>
                <ClaimFilters counts={counts} value={filter} onChange={setFilter} />
              </div>
            )}
          </aside>

          <section className="pane pane-draft" aria-label={t("ws.draftPane")}>
            {state.claims.length > 0 ? (
              <DraftCanvas
                working={working}
                applied={applied}
                resolutions={resolutions}
                activeId={activeId}
                shown={shown}
                draftLabel={draftLabel}
                rebuilt={draftText === null}
                hasIssues={issues.length > 0}
                copied={copied}
                onSelect={select}
                onNext={() => step(1)}
                onCopyDraft={copyDraft}
              />
            ) : (
              // J2: while the draft is being read, the student's own text stays on screen.
              <div className="canvas">
                <h2 className="canvas-title">{draftLabel ?? t("ws.draftPlain")}</h2>
                {draftText && !finished && <div className="draft draft-plain">{draftText}</div>}
              </div>
            )}
          </section>

          <div className="pane pane-review" id="inspector">
            <button type="button" className="sheet-grip" aria-label={t("ws.sheet.close")} onClick={() => setActiveId(null)} />
            {state.claims.length === 0 ? (
              scanning && <p className="empty review-empty">{t("ws.scanning")}</p>
            ) : (
              <>
                <aside className="review-claim" aria-label={t("ws.insp.title")}>
                  {lastAction && (
                    <p className="last-action" role="status" ref={lastActionLine} tabIndex={-1}>
                      <span>{lastAction.kind === "applied" ? t("ws.act.applied", { id: lastLabel }) : t("ws.act.ignored", { id: lastLabel })}</span>
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          const id = lastAction.id;
                          undo(id);
                          setLastAction(null);
                          select(id);
                        }}
                      >
                        {t("ws.fix.undo")}
                      </button>
                    </p>
                  )}
                  {showReady ? (
                    <section className="ready-card" aria-label={t("ws.ready.title")}>
                      {counts.supported > 0 && (
                        <p className="ready-count">
                          <em>{counts.supported}</em> {t("ws.ready.suffix")}
                        </p>
                      )}
                      {firstOpen && (
                        <>
                          <div>
                            <h2 className="ready-title">{t("ws.ready.title")}</h2>
                            <p className="hint">{t("ws.ready.sub")}</p>
                          </div>
                          {firstOpen.verdict && (
                            <div className={`ready-issue v-${firstOpen.verdict}`}>
                              <VerdictIcon verdict={firstOpen.verdict} size={18} />
                              <span>
                                <strong>{verdictLabel(t, firstOpen.verdict)}</strong>
                                {firstOpen.reason ? localizeReason(firstOpen.reason, t) : ""}
                              </span>
                            </div>
                          )}
                          <button type="button" className="btn btn-primary" onClick={() => select(firstOpen.id)}>
                            {t("ws.ready.go")}
                          </button>
                        </>
                      )}
                    </section>
                  ) : (
                    <ClaimInspector
                      key={activeId ?? "none"}
                      claim={active}
                      label={active ? (working.labels.get(active.id) ?? null) : null}
                      error={active ? state.claimErrors[active.id] : undefined}
                      ended={finished}
                      scanned={scanned}
                      flagged={active ? flagged.has(active.id) : false}
                      resolution={active ? (resolutions.get(active.id) ?? null) : null}
                      canApply={active ? placed.has(active.id) : false}
                      place={at >= 0 ? { at: at + 1, of: issues.length } : null}
                      onPrev={() => step(-1)}
                      onNext={() => step(1)}
                      onApply={() => active && resolve(active, "applied")}
                      onIgnore={() => active && resolve(active, "ignored")}
                      onUndo={() => {
                        if (!active) return;
                        undo(active.id);
                        if (lastAction?.id === active.id) setLastAction(null);
                      }}
                      onFlag={(reason) => active && flag(active.id, reason)}
                      onRetry={() => active && onRetryClaim(active.id)}
                      onEvent={onEvent}
                      onFindSources={onFindSources}
                      onFindWebSources={state.webSearch ? onFindWebSources : undefined}
                      onAttachSource={onAttachSource}
                    />
                  )}
                </aside>
                <section className="review-list" aria-label={t("ws.list")}>
                  <ClaimList claims={listed} labels={working.labels} activeId={activeId} resolved={resolvedIds} onSelect={select} />
                </section>
              </>
            )}
          </div>
        </div>
        <button type="button" className="ws-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setSideOpen(false)} />
      </>
    </div>
  );
}
