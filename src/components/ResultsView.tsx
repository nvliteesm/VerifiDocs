"use client";

import { useMemo, useState } from "react";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { SUMMARY_ORDER, VERDICT_INFO, attentionCount } from "@/lib/client/verdict-info";
import type { VerifierState } from "@/lib/client/verifier-state";

interface Props {
  state: VerifierState;
  onRetryClaim: (claimId: string) => void;
  onEvent: (name: "evidence_opened" | "verdict_flagged_wrong" | "fix_accepted", props?: Record<string, unknown>) => void;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Badge({ verdict }: { verdict: Verdict }) {
  const info = VERDICT_INFO[verdict];
  return (
    <span className={`badge badge-${info.tone}`}>
      <span aria-hidden="true">{info.symbol}</span> {info.label}
    </span>
  );
}

function ClaimCard({ claim, error, onRetry, onEvent }: { claim: ClaimView; error: string | undefined; onRetry: () => void; onEvent: Props["onEvent"] }) {
  const [flagged, setFlagged] = useState(false);
  const [copied, setCopied] = useState(false);
  const verdict = claim.verdict;
  const info = verdict ? VERDICT_INFO[verdict] : null;

  return (
    <li className="claim" id={`claim-${claim.id}`}>
      <div className="claim-head">
        {verdict ? <Badge verdict={verdict} /> : <span className="badge badge-muted">{error ? "Not checked" : "Waiting…"}</span>}
        {claim.citation && <span className="citation">{claim.citation}</span>}
      </div>
      <p className="claim-text">{claim.text}</p>

      {info && <p className="meaning">{info.meaning}</p>}
      {claim.reason && <p className="reason">{claim.reason}</p>}
      {info && info.advice && (
        <p className="next">
          <strong>What to do:</strong> {info.advice}
        </p>
      )}

      {claim.quote && (
        <details
          onToggle={(event) => {
            if ((event.currentTarget as HTMLDetailsElement).open && verdict) onEvent("evidence_opened", { verdict });
          }}
        >
          <summary>
            What your source says{claim.page !== null ? ` (page ${claim.page})` : ""}
          </summary>
          <blockquote>{claim.quote}</blockquote>
        </details>
      )}

      {claim.fixSuggestion && (
        <div className="fix">
          <strong>Suggested sentence</strong>
          <p>{claim.fixSuggestion}</p>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              setCopied(await copy(claim.fixSuggestion!));
              onEvent("fix_accepted");
            }}
          >
            {copied ? "Copied" : "Copy sentence"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="notice notice-warn">
          {error}{" "}
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}

      {verdict && (
        <div>
          <button
            type="button"
            className="link"
            disabled={flagged}
            onClick={() => {
              setFlagged(true);
              onEvent("verdict_flagged_wrong", { verdict });
            }}
          >
            {flagged ? "Thanks, noted" : "This verdict is wrong"}
          </button>
        </div>
      )}
    </li>
  );
}

export function ResultsView({ state, onRetryClaim, onEvent }: Props) {
  const [filter, setFilter] = useState<Verdict | "attention" | "all">("attention");
  const checked = state.claims.filter((claim) => claim.verdict !== null).length;
  const total = state.claims.length;
  const attention = attentionCount(state.counts);

  const shown = useMemo(() => {
    const ranked = new Map(state.fixList.map((id, index) => [id, index]));
    const rest = (a: ClaimView, b: ClaimView) => a.position - b.position;
    const list =
      filter === "all"
        ? state.claims
        : filter === "attention"
          ? state.claims.filter((claim) => ranked.has(claim.id) || claim.verdict === null)
          : state.claims.filter((claim) => claim.verdict === filter);
    return [...list].sort((a, b) => {
      const ra = ranked.get(a.id);
      const rb = ranked.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return rest(a, b);
    });
  }, [state.claims, state.fixList, filter]);

  const finished = state.phase === "done";

  return (
    <section className="panel" aria-labelledby="results-title">
      <div className="panel-head">
        <p className="eyebrow">Step 2 of 2</p>
        <h2 id="results-title">Results</h2>
      </div>

      {!finished && state.phase !== "error" && (
        <div className="progress" aria-live="polite">
          <progress max={Math.max(total, 1)} value={checked} aria-label="Claims checked" />
          <span className="hint">{state.message || (total > 0 ? `${checked} of ${total} claims checked` : "Working…")}</span>
        </div>
      )}

      {state.phase === "error" && state.error && (
        <p role="alert" className="notice notice-bad">
          {state.error}
        </p>
      )}

      {finished && total === 0 && <p className="empty">No checkable claims were found in this draft. Try pasting a section with factual statements and citations.</p>}

      {total > 0 && (
        <>
          <div className="tally">
            <p className="tally-number">
              {attention === 0 && finished ? "Every checked claim is supported." : `${attention} of ${total} claims need attention.`}
            </p>
            <p className="hint">Most urgent first. Open a claim to see the quote from your source.</p>
          </div>

          <div className="chips" role="group" aria-label="Filter claims">
            <button type="button" className="chip" aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>
              Needs attention ({attention})
            </button>
            {SUMMARY_ORDER.filter((verdict) => (state.counts[verdict] ?? 0) > 0).map((verdict) => (
              <button key={verdict} type="button" className="chip" aria-pressed={filter === verdict} onClick={() => setFilter(verdict)}>
                <span aria-hidden="true">{VERDICT_INFO[verdict].symbol}</span> {VERDICT_INFO[verdict].label} ({state.counts[verdict]})
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All ({total})
            </button>
          </div>

          <ol className="claims">
            {shown.map((claim) => (
              <ClaimCard key={claim.id} claim={claim} error={state.claimErrors[claim.id]} onRetry={() => onRetryClaim(claim.id)} onEvent={onEvent} />
            ))}
          </ol>
          {shown.length === 0 && <p className="empty">Nothing in this filter.</p>}
        </>
      )}
    </section>
  );
}
