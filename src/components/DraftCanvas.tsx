"use client";

// The centre pane: the draft is the hero. Each claim sentence is an inline button with a soft underline for its
// status and a [C-n] tag; the selected one has a focus border. An applied fix shows as a small diff while selected.
import type { WorkingDraft } from "@/lib/client/working-draft";
import { verdictLabel } from "@/lib/client/verdict-info";
import type { ClaimView } from "@/lib/client/types";
import type { Resolution } from "./ClaimInspector";
import { useT } from "./LocaleProvider";

interface Props {
  working: WorkingDraft;
  /** Claim id to the sentence that replaces it. */
  applied: Readonly<Record<string, string>>;
  resolutions: ReadonlyMap<string, Resolution>;
  activeId: string | null;
  /** The claims the filter keeps in view; the rest are drawn plain. Null when every claim is. */
  shown: ReadonlySet<string> | null;
  /** What the draft was read from ("Google Doc", a file name), when it was not pasted. */
  draftLabel: string | null;
  /** The text is rebuilt from the checked sentences, because the browser does not have the draft. */
  rebuilt: boolean;
  /** Open issues are left, so "Next issue" has somewhere to go. */
  hasIssues: boolean;
  copied: "idle" | "copied" | "failed";
  onSelect: (claimId: string) => void;
  onNext: () => void;
  onCopyDraft: () => void;
}

interface SentenceProps {
  claim: ClaimView;
  label: string;
  text: string;
  applied: string | undefined;
  resolution: Resolution | undefined;
  active: boolean;
  muted: boolean;
  onSelect: (claimId: string) => void;
}

function Sentence({ claim, label, text, applied, resolution, active, muted, onSelect }: SentenceProps) {
  const { t } = useT();
  const state = resolution ?? claim.verdict ?? "waiting";
  return (
    <button
      type="button"
      id={`hl-${claim.id}`}
      className={`hl v-${state}${resolution ? ` hl-${resolution}` : ""}${active ? " hl-active" : ""}${muted ? " hl-muted" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(claim.id)}
    >
      {applied !== undefined ? (
        <>
          {active && <del className="diff-old">{text}</del>}
          {active && " "}
          <ins className="diff-new">{applied}</ins>
        </>
      ) : (
        text
      )}
      {(resolution || claim.verdict) && (
        <span className="sr-only"> ({resolution === "applied" ? t("ws.fix.applied") : resolution === "ignored" ? t("ws.fix.ignored") : verdictLabel(t, claim.verdict!)})</span>
      )}
      <span className="tag" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

export function DraftCanvas({ working, applied, resolutions, activeId, shown, draftLabel, rebuilt, hasIssues, copied, onSelect, onNext, onCopyDraft }: Props) {
  const { t } = useT();
  return (
    <div className="canvas">
      <div className="canvas-head">
        <div>
          <h2 className="canvas-title">{draftLabel ?? t("ws.draftPlain")}</h2>
          <p className="hint">{t("ws.hint")}</p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-small" onClick={onNext} disabled={!hasIssues}>
            {t("ws.next")}
          </button>
          <button type="button" className="btn btn-small" onClick={onCopyDraft}>
            {copied === "copied" ? t("ws.copiedDraft") : t("ws.copyDraft")}
          </button>
        </div>
      </div>
      {rebuilt && <p className="hint">{t("ws.rebuilt")}</p>}
      {copied === "failed" && (
        <p role="alert" className="hint hint-bad">
          {t("act.copyFail")}
        </p>
      )}
      <div className="draft">
        {working.segments.map((segment, index) => {
          if (segment.kind === "heading") {
            return (
              <h3 key={index} className="draft-heading">
                {segment.text}
              </h3>
            );
          }
          if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
          const { claim } = segment;
          return (
            <Sentence
              key={claim.id}
              claim={claim}
              label={segment.label}
              text={segment.text}
              applied={applied[claim.id]}
              resolution={resolutions.get(claim.id)}
              active={activeId === claim.id}
              muted={shown !== null && !shown.has(claim.id)}
              onSelect={onSelect}
            />
          );
        })}
      </div>
      {working.unplaced.length > 0 && (
        <section className="unplaced" aria-labelledby="unplaced-title">
          <h3 id="unplaced-title" className="sub-title">
            {t("ws.unplaced")}
          </h3>
          <ul>
            {working.unplaced.map((claim) => (
              <li key={claim.id}>
                <Sentence
                  claim={claim}
                  label={working.labels.get(claim.id) ?? ""}
                  text={claim.text}
                  applied={undefined}
                  resolution={resolutions.get(claim.id)}
                  active={activeId === claim.id}
                  muted={shown !== null && !shown.has(claim.id)}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
