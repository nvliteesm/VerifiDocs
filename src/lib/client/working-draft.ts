// The working draft behind the draft canvas: the student's text cut into plain stretches and claim sentences, so a
// claim can be underlined, selected, and have its suggested sentence applied or undone.
//
// Nothing here is stored or sent anywhere (Hard Rules 4 and 11). Applied fixes are a map of claim id to sentence, held
// in memory by the caller; the text itself is never edited, so an undo is deleting one map entry and offsets cannot drift.
import { isOptional } from "../fix-list";
import type { ClaimView } from "./types";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "claim"; claim: ClaimView; label: string; text: string };

export interface WorkingDraft {
  segments: Segment[];
  /** Claims whose sentence could not be found in the text. They are shown apart, and their fix cannot be applied in place. */
  unplaced: ClaimView[];
  /** Claim id to its "C-n" tag, for every claim, placed or not. */
  labels: Map<string, string>;
}

export type ClaimGroup = "fix" | "source" | "ok" | "waiting";

/** "C-1", "C-2", ... in the order the claims appear in the draft. */
export function claimLabels(claims: readonly ClaimView[]): Map<string, string> {
  const ordered = [...claims].sort((a, b) => a.position - b.position);
  return new Map(ordered.map((claim, index) => [claim.id, `C-${index + 1}`]));
}

/** Which filter a claim belongs to. A claim with no verdict yet is "waiting", not a problem. */
export function groupOf(claim: Pick<ClaimView, "verdict">): ClaimGroup {
  switch (claim.verdict) {
    case null:
      return "waiting";
    case "supported":
      return "ok";
    case "no_citation_given":
    case "cant_check":
    case "cant_tell":
      return "source";
    default:
      return "fix";
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `sentence` sits in `draft` at or after `from`: exactly, or with any run of white space standing for another. */
function locate(draft: string, sentence: string, from: number): { start: number; end: number } | null {
  const exact = draft.indexOf(sentence, from);
  if (exact !== -1) return { start: exact, end: exact + sentence.length };
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const match = new RegExp(words.map(escapeRegExp).join("\\s+")).exec(draft.slice(from));
  return match ? { start: from + match.index, end: from + match.index + match[0].length } : null;
}

/**
 * Cuts the draft at each claim's sentence, in the order of the claims. With no text (a .docx, or a check reopened after
 * a reload: the browser never has it) the draft is rebuilt from the checked sentences, under their headings.
 */
export function buildWorkingDraft(draft: string | null, claims: readonly ClaimView[]): WorkingDraft {
  const ordered = [...claims].sort((a, b) => a.position - b.position);
  const labels = claimLabels(claims);
  const label = (claim: ClaimView) => labels.get(claim.id) ?? "";

  if (draft === null) {
    const segments: Segment[] = [];
    let section: string | null | undefined;
    ordered.forEach((claim, index) => {
      if (claim.section !== section) {
        section = claim.section;
        if (section) segments.push({ kind: "heading", text: section });
      } else if (index > 0) {
        segments.push({ kind: "text", text: " " });
      }
      segments.push({ kind: "claim", claim, label: label(claim), text: claim.text });
    });
    return { segments, unplaced: [], labels };
  }

  const segments: Segment[] = [];
  const unplaced: ClaimView[] = [];
  let cursor = 0;
  for (const claim of ordered) {
    const at = locate(draft, claim.text, cursor);
    if (!at) {
      unplaced.push(claim);
      continue;
    }
    if (at.start > cursor) segments.push({ kind: "text", text: draft.slice(cursor, at.start) });
    segments.push({ kind: "claim", claim, label: label(claim), text: draft.slice(at.start, at.end) });
    cursor = at.end;
  }
  if (cursor < draft.length) segments.push({ kind: "text", text: draft.slice(cursor) });
  return { segments, unplaced, labels };
}

/** The draft as it reads now: each claim sentence replaced by its applied fix, if it has one. */
export function resolvedText(working: WorkingDraft, applied: Readonly<Record<string, string>>): string {
  return working.segments
    .map((segment) => {
      if (segment.kind === "heading") return `\n${segment.text}\n`;
      if (segment.kind === "claim") return applied[segment.claim.id] ?? segment.text;
      return segment.text;
    })
    .join("")
    .trim();
}

/**
 * The claims still to look at, in the order of the draft: the ranked fix list, less what the student has already
 * applied or ignored. Previous and next walk this list.
 */
export function openIssues(claims: readonly ClaimView[], fixList: readonly string[], resolved: ReadonlySet<string>): ClaimView[] {
  const wanted = new Set(fixList);
  return claims.filter((claim) => wanted.has(claim.id) && !resolved.has(claim.id) && !isOptional(claim)).sort((a, b) => a.position - b.position);
}

/**
 * The issue after (or before) `currentId`, wrapping round. With nothing selected, the first (or last). When the
 * selected claim has just left the list (applied or ignored), `fromPosition` is where it sat in the draft, so the
 * step carries on from there instead of jumping back to the start.
 */
export function stepIssue(issues: readonly ClaimView[], currentId: string | null, direction: 1 | -1, fromPosition?: number): ClaimView | null {
  if (issues.length === 0) return null;
  const at = issues.findIndex((claim) => claim.id === currentId);
  if (at !== -1) return issues[(at + direction + issues.length) % issues.length]!;
  if (fromPosition !== undefined) {
    const after = direction === 1 ? issues.find((claim) => claim.position > fromPosition) : [...issues].reverse().find((claim) => claim.position < fromPosition);
    if (after) return after;
  }
  return direction === 1 ? issues[0]! : issues[issues.length - 1]!;
}

/** A change a student can read at a glance: the one number in the sentence that the fix changes ("18%" to "8%"). */
export function numberChange(before: string, after: string): { from: string; to: string } | null {
  const NUMBER = /\d+(?:[.,]\d+)*%?/g;
  const was: string[] = before.match(NUMBER) ?? [];
  const now: string[] = after.match(NUMBER) ?? [];
  const gone = was.filter((value) => !now.includes(value));
  const added = now.filter((value) => !was.includes(value));
  if (gone.length !== 1 || added.length !== 1) return null;
  return { from: gone[0]!, to: added[0]! };
}

/**
 * The suggested sentence, fitted to the place it goes. A claim's sentence often stops before its own full stop (the
 * citation and the stop come after it in the draft), while the suggestion is a whole sentence ending in one. Splicing
 * it in as it is would leave "...category. (Smith, 2019)." with a stray stop, so the suggestion's closing
 * punctuation is dropped when the sentence it replaces does not have any.
 */
export function fitFix(original: string, fix: string): string {
  const closed = /[.!?…]["')\]]*$/;
  const trimmed = fix.trim();
  if (closed.test(original.trim()) || !closed.test(trimmed)) return fix;
  return trimmed.replace(/[.!?…]+(["')\]]*)$/, "$1");
}

const NOT_A_TITLE = /^(?:daftar|bab|abstrak|abstract|kata pengantar|table of contents|contents|references|karya ilmiah|skripsi|tesis|thesis|proposal)\b/i;

/**
 * A title for the draft, from its own first lines (a Google Docs export has no title of its own): the first stretch of
 * lines before a blank line, when it is short and reads like a title. An all-capitals title is set in sentence case.
 * Null when nothing looks like one, so the caller keeps its generic label.
 */
export function guessTitle(text: string): string | null {
  const head = text.replace(/^\uFEFF/, "").slice(0, 600).split(/\n\s*\n/);
  const block = head.find((part) => part.trim() !== "");
  if (!block) return null;
  const lines = block.split("\n").map((line) => line.replace(/\s*\\+\s*$/, "").trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 3) return null;
  let title = lines.join(" ").replace(/\s+/g, " ").trim();
  if (title.length < 8 || title.length > 180 || NOT_A_TITLE.test(title) || /[.!?;:]$/.test(title)) return null;
  const letters = title.replace(/[^\p{L}]/gu, "");
  if (letters.length > 12 && letters === letters.toUpperCase()) title = title.charAt(0) + title.slice(1).toLowerCase();
  return title;
}
