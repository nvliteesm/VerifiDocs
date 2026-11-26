// "Check my numbers": finds the same figure reported with different values in different places of the student's own
// paper (a table says 1.893%, the discussion says 1.839%). A separate check from source verification. It never says
// which value is right and never changes anything: it only shows where the values are.
//
// The model labels each reported figure (what it measures, with its subject and condition); this decides, in plain code,
// which figures are "the same quantity" and whether their values disagree. Two bars keep it honest:
//  - labels that match closely (almost the same words): any difference in value is reported;
//  - labels that match loosely: only a difference that looks like a slip (one or two digits changed or swapped).
// So a different condition ("day 7" against "day 14") is not reported just because the numbers differ.
import { editDistance, normalizeForMatch } from "../pipeline/citations";

export interface FigureOccurrence {
  label: string;
  value: string;
  unit: string | null;
  sentence: string;
  section: string | null;
  /** The part of the draft it was read from, to keep draft order. */
  part: number;
}

export interface InconsistentFigures {
  key: string;
  /** What the figures measure, as labelled most often. */
  label: string;
  /** "value": the numbers differ. "unit": the number is the same but written with different units. */
  kind: "value" | "unit";
  /** Every place, in draft order, each with its own value. */
  places: FigureOccurrence[];
}

const STOP = new Set(["rata", "yang", "dan", "pada", "dari", "dalam", "untuk", "dengan", "the", "of", "and", "for", "in", "on", "per", "total", "hasil", "nilai", "sebesar", "jumlah"]);
const LOOSE = 0.6;
const CLOSE = 0.85;

function labelTokens(label: string): Set<string> {
  return new Set(
    normalizeForMatch(label)
      .split(" ")
      .filter((token) => !STOP.has(token) && (token.length >= 3 || /\d/.test(token))),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** A written number or date, reduced so the same value written two ways is the same: "1,893 %", "1.893" are one. */
export function canonicalValue(value: string): { text: string; digits: string | null } {
  const compact = value.replace(/[\s%]/g, "");
  if (/^[\d.,]+$/.test(compact) && /\d/.test(compact)) {
    const text = compact.replace(/,/g, ".");
    return { text, digits: text.replace(/\D/g, "") };
  }
  return { text: normalizeForMatch(value), digits: null };
}

const UNIT_ALIASES: Record<string, string> = { persen: "%", percent: "%", "kg/cm²": "kg/cm2", "kg/cm^2": "kg/cm2", gram: "g", gr: "g", kilogram: "kg" };

function unitKey(unit: string | null): string | null {
  if (!unit) return null;
  const key = unit.trim().toLowerCase().replace(/\s+/g, "");
  return UNIT_ALIASES[key] ?? key;
}

/** True when two digit strings differ by one digit changed, added or dropped, or by two neighbouring digits swapped: a slip. */
function isSlip(a: string, b: string): boolean {
  if (a === b || a.length < 3 || b.length < 3) return false;
  if (editDistance(a, b, 1) <= 1) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i += 1) {
    if (a[i] !== b[i]) return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return false;
}

const MIN_PROSE_WORDS = 5;
/** More than this is not a list a student can use: the most telling ones come first. */
const MAX_FINDINGS = 12;
const isProse = (sentence: string) => sentence.trim().split(/\s+/).length >= MIN_PROSE_WORDS;
/**
 * A whole number of three digits or more ("500 responden", "2022"). Only these are reported for ANY difference: a decimal
 * (a percentage, a mass) changes with day, material and group, and the model's labels do not always say which, so a
 * decimal is reported only when it looks like a slip of the pen.
 */
const isLargeWholeNumber = (text: string) => /^\d{3,}$/.test(text);

interface Pair {
  a: number;
  b: number;
  kind: "value" | "unit";
  slip: boolean;
}

export function findInconsistencies(figures: readonly FigureOccurrence[]): InconsistentFigures[] {
  const items = figures.map((figure) => ({ figure, tokens: labelTokens(figure.label), value: canonicalValue(figure.value), unit: unitKey(figure.unit) }));
  const pairs: Pair[] = [];
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const x = items[a]!;
      const y = items[b]!;
      if (x.figure.sentence === y.figure.sentence) continue;
      // The same quantity reported in two places: two figures next to each other (the dry and the wet mass, day 7 and day
      // 14) are different measurements, not one figure written twice.
      if (x.figure.part === y.figure.part && x.figure.section === y.figure.section) continue;
      const similarity = jaccard(x.tokens, y.tokens);
      if (similarity < LOOSE) continue;
      if (x.value.text === y.value.text) {
        if (similarity >= CLOSE && x.unit && y.unit && x.unit !== y.unit && isProse(x.figure.sentence) && isProse(y.figure.sentence)) pairs.push({ a, b, kind: "unit", slip: false });
        continue;
      }
      // A slip needs a sentence on BOTH sides. A bare table cell carries no context, and the model's label for it is a
      // guess (it put a day-14 cell under day 7), so a cell a digit away from a sentence is not enough to call a slip.
      const slip =
        x.value.digits !== null &&
        y.value.digits !== null &&
        x.unit === y.unit &&
        isProse(x.figure.sentence) &&
        isProse(y.figure.sentence) &&
        isSlip(x.value.digits, y.value.digits);
      // Any other difference counts only between sentences (not table cells), with the same unit, close labels, and a
      // large whole number: the model's labels for table cells and conditions are too loose to say more.
      const plain =
        similarity >= CLOSE &&
        x.unit === y.unit &&
        isProse(x.figure.sentence) &&
        isProse(y.figure.sentence) &&
        isLargeWholeNumber(x.value.text) &&
        isLargeWholeNumber(y.value.text);
      if (slip || plain) pairs.push({ a, b, kind: "value", slip });
    }
  }

  // One finding per quantity. Slips are joined into one group (the same figure, several places). Other differences stay
  // as pairs, so a chain of look-alike labels never turns into one finding that lists unrelated numbers.
  const parent = items.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index]!)));
  for (const pair of pairs) if (pair.slip) parent[find(pair.a)] = find(pair.b);
  const slipRoots = new Set(pairs.filter((pair) => pair.slip).flatMap((pair) => [find(pair.a), find(pair.b)]));
  const groups = new Map<string, { members: Set<number>; kind: "value" | "unit" }>();
  for (const pair of pairs) {
    // A difference between two places already joined as one slipped figure is part of that finding, not a second one.
    if (!pair.slip && find(pair.a) === find(pair.b) && slipRoots.has(find(pair.a))) continue;
    const key = pair.slip ? `slip|${find(pair.a)}` : `pair|${pair.a}|${pair.b}`;
    const group = groups.get(key) ?? { members: new Set<number>(), kind: pair.kind };
    group.members.add(pair.a).add(pair.b);
    groups.set(key, group);
  }

  const out: InconsistentFigures[] = [];
  for (const group of groups.values()) {
    const seen = new Set<string>();
    const places = [...group.members]
      .map((index) => items[index]!.figure)
      .filter((figure) => {
        const key = `${figure.sentence}|${figure.value}`;
        return seen.has(key) ? false : (seen.add(key), true);
      })
      .sort((p, q) => p.part - q.part);
    const labels = new Map<string, number>();
    for (const place of places) labels.set(place.label, (labels.get(place.label) ?? 0) + 1);
    const label = [...labels.entries()].sort((p, q) => q[1] - p[1] || p[0].length - q[0].length)[0]![0];
    out.push({ key: `${group.kind}|${normalizeForMatch(label)}|${places.map((p) => p.value).join("/")}`, label, kind: group.kind, places });
  }
  const cleaned = dedupePairs(out);
  return cleaned.sort((p, q) => q.places.length - p.places.length || p.places[0]!.part - q.places[0]!.part).slice(0, MAX_FINDINGS);
}

/** The same two values reported in several sentence pairs are one finding: keep one per label and set of values. */
function dedupePairs(found: InconsistentFigures[]): InconsistentFigures[] {
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.kind}|${normalizeForMatch(item.label)}|${[...new Set(item.places.map((p) => canonicalValue(p.value).text))].sort().join("/")}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}
