"use client";

// Small pieces every claim view shares: the verdict badge, marked numbers, the quote cut-offs, and the clipboard.
import type { Piece } from "@/lib/client/numbers";
import type { Verdict } from "@/lib/client/types";
import { VERDICT_INFO, verdictLabel } from "@/lib/client/verdict-info";
import { useT } from "./LocaleProvider";

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The verdict's icon, drawn in the surrounding text colour. Decorative: the label next to it carries the meaning. */
export function VerdictIcon({ verdict, size = 18 }: { verdict: Verdict; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={VERDICT_INFO[verdict].icon} />
    </svg>
  );
}

/** `optional`: a general statement with no citation, shown as a suggestion rather than a problem. */
export function Badge({ verdict, optional = false }: { verdict: Verdict; optional?: boolean }) {
  const { t } = useT();
  return (
    <span className={`badge ${optional ? "badge-muted" : `v-${verdict}`}`}>
      {!optional && <VerdictIcon verdict={verdict} />}
      {optional ? t("claim.optional") : verdictLabel(t, verdict)}
    </span>
  );
}

/** Text split by `markDifferences`: the numbers that differ are marked, with weight and underline as well as colour. */
export function Pieces({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      {pieces.map((piece, index) =>
        piece.marked ? (
          <mark key={index} className="num">
            {piece.text}
          </mark>
        ) : (
          piece.text
        ),
      )}
    </>
  );
}

/**
 * An abstract sentence can run to 60 words (seen on a real search), which buries the paper under it on a phone. The
 * view shows about 240 characters, cut at a word with "…"; the whole sentence is what was verified and stored.
 */
const QUOTE_CHARS = 240;
export function shortQuote(sentence: string): string {
  if (sentence.length <= QUOTE_CHARS) return sentence;
  const cut = sentence.slice(0, QUOTE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), QUOTE_CHARS / 2)).replace(/[\s,;:]+$/, "")}…`;
}
