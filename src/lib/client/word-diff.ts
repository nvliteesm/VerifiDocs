// Shows a student what a suggested fix changes: the words that differ between their sentence and the fix, with the
// shared start and end left plain. It trims the common words from both ends and keeps what is left in the middle, so
// one edit reads as one highlighted run. It is a reading aid, not an edit: nothing here changes any text.

export interface WordDiff {
  /** Shared words at the start, including the white space that follows them. */
  pre: string;
  /** What the student's sentence has in the middle that the fix does not. Empty when the fix only adds words. */
  oldMid: string;
  /** What the fix has in the middle. Empty when the fix only removes words. */
  newMid: string;
  /** Shared words at the end. */
  post: string;
}

/** Splits into words and the white space between them, so joining the pieces gives the text back exactly. */
function pieces(text: string): string[] {
  return text.split(/(\s+)/).filter((piece) => piece !== "");
}

export function wordDiff(before: string, after: string): WordDiff {
  const a = pieces(before);
  const b = pieces(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const join = (list: string[], from: number, to: number) => list.slice(from, to).join("");
  return { pre: join(a, 0, start), oldMid: join(a, start, endA), newMid: join(b, start, endB), post: join(a, endA, a.length) };
}
