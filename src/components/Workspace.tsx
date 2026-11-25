"use client";

// The three-pane workspace shown once a check exists: sources and filters on the left, the draft in the middle, one
// claim at a time on the right. This component owns which claim is selected, which fixes were applied or ignored,
// and which pane a phone shows. Applied fixes live here, in memory, and are never sent anywhere (Hard Rules 4 and 11).
import { useCallback, useMemo, useRef, useState } from "react";
import type { FlagReason } from "@/lib/flag-reasons";
import type { MessageKey } from "@/lib/i18n";
import type { VerifierState } from "@/lib/client/verifier-state";
import { buildWorkingDraft, fitFix, groupOf, openIssues, resolvedText, stepIssue } from "@/lib/client/working-draft";
import { ClaimFilters, type Filter } from "./ClaimFilters";
import { ClaimInspector, type Resolution } from "./ClaimInspector";
import { copy } from "./claim-bits";
import { DraftCanvas } from "./DraftCanvas";
import type { AttachFn, EventFn, FindFn } from "./FoundSources";
import { useT } from "./LocaleProvider";
import { RunStatus } from "./RunStatus";

type Pane = "draft" | "claim" | "sources";

interface Props {
  state: VerifierState;
  /** The pasted draft, or null when the browser has none (a .docx, or a check reopened after a reload). */
  draftText: string | null;
  draftLabel: string | null;
  focusWhenDone: boolean;
  /** The sources list, with its own upload and retry handlers, which belong to the app. */
  sources: React.ReactNode;
  /** The buttons that run the check: check, copy report, edit, stop, delete. */
  actions: React.ReactNode;
  /** Quieter controls under the panes: start over, delete, the one-question survey. */
  after?: React.ReactNode;
  onRetryClaim: (claimId: string) => void;
  onReadPart?: (unit: number) => Promise<void>;
  onEvent: EventFn;
  onFindSources?: FindFn;
  onFindWebSources?: FindFn;
  onAttachSource?: AttachFn;
}

export function Workspace({ state, draftText, draftLabel, focusWhenDone, sources, actions, after, onRetryClaim, onReadPart, onEvent, onFindSources, onFindWebSources, onAttachSource }: Props) {
  const { t } = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [applied, setApplied] = useState<Readonly<Record<string, string>>>({});
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(new Set());
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [pane, setPane] = useState<Pane>("draft");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finished = state.phase === "done";
  const scanned = state.phase === "scanned";
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

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: state.claims.length, fix: 0, source: 0, ok: 0, waiting: 0 };
    for (const claim of state.claims) out[groupOf(claim)] += 1;
    return out;
  }, [state.claims]);
  const shown = useMemo(() => (filter === "all" ? null : new Set(state.claims.filter((claim) => groupOf(claim) === filter).map((claim) => claim.id))), [filter, state.claims]);

  const active = state.claims.find((claim) => claim.id === activeId) ?? null;
  const at = active ? issues.findIndex((claim) => claim.id === active.id) : -1;

  const select = useCallback((id: string) => {
    setActiveId(id);
    setPane("claim");
    setInspectorOpen(true);
    // Bring the sentence into view in the draft; the inspector already shows the claim.
    document.getElementById(`hl-${id}`)?.scrollIntoView?.({ block: "center", behavior: "auto" });
  }, []);
  const step = (direction: 1 | -1) => {
    const next = stepIssue(issues, activeId, direction, active?.position);
    if (next) select(next.id);
  };

  const apply = (id: string, sentence: string) => setApplied((prev) => ({ ...prev, [id]: sentence }));
  const ignore = (id: string) => setIgnored((prev) => new Set(prev).add(id));
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

  return (
    <div className="ws" data-pane={pane}>
      <RunStatus state={state} focusWhenDone={focusWhenDone} onReadPart={onReadPart} />

      <div className="ws-bar">
        <div className="actions">{actions}</div>
        {state.claims.length > 0 && (
          <p className="ws-progress">
            {t("ws.progress", { checked: state.claims.filter((claim) => claim.verdict !== null).length, total: state.claims.length })}
          </p>
        )}
        <div className="actions ws-toggles">
          <button type="button" className="btn btn-small ws-toggle" aria-expanded={sideOpen} aria-controls="side" onClick={() => setSideOpen((open) => !open)}>
            {sideOpen ? t("ws.side.hide") : t("ws.side.show")}
          </button>
          <button type="button" className="btn btn-small ws-toggle" aria-expanded={inspectorOpen} aria-controls="inspector" onClick={() => setInspectorOpen((open) => !open)}>
            {inspectorOpen ? t("ws.insp.hide") : t("ws.insp.show")}
          </button>
        </div>
      </div>

      {state.claims.length > 0 && (
        <div className="ws-panes" role="group" aria-label={t("ws.panes")}>
          {(["draft", "claim", "sources"] as const).map((name) => (
            <button key={name} type="button" className="ws-pane-btn" aria-pressed={pane === name} onClick={() => setPane(name)}>
              {t(`ws.pane.${name}` as MessageKey)}
            </button>
          ))}
        </div>
      )}

      <div className="ws-grid" data-inspector={inspectorOpen ? "open" : "closed"} data-side={sideOpen ? "open" : "closed"}>
        <aside className="pane pane-side" id="side" aria-label={t("ws.side")}>
          {sources}
          {state.claims.length > 0 && (
            <div className="side-filters">
              <h2 className="pane-title">{t("ws.filters")}</h2>
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
            !finished && <p className="empty">{t("results.working")}</p>
          )}
        </section>

        <aside className="pane pane-insp" id="inspector" aria-label={t("ws.insp.title")}>
          {state.claims.length > 0 && (
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
              onApply={() => active?.fixSuggestion && apply(active.id, fitFix(active.text, active.fixSuggestion))}
              onIgnore={() => active && ignore(active.id)}
              onUndo={() => active && undo(active.id)}
              onFlag={(reason) => active && flag(active.id, reason)}
              onRetry={() => active && onRetryClaim(active.id)}
              onEvent={onEvent}
              onFindSources={onFindSources}
              onFindWebSources={state.webSearch ? onFindWebSources : undefined}
              onAttachSource={onAttachSource}
            />
          )}
        </aside>
      </div>

      {after && <div className="ws-after">{after}</div>}
    </div>
  );
}
