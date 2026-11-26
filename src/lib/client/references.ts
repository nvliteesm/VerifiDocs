// What the student needs to know about their reference list's source files, in four buckets that add up to the total.
// Pure: the screen and the tests share it. A source that could not be retrieved is never "wrong": "missing" only means
// the file still has to come from the student.
import type { ReferenceSource } from "./types";

export interface ReferenceSummary {
  total: number;
  /** The file is in: found online, or uploaded by the student. */
  retrieved: number;
  /** A similar work was found and waits for the student's yes or no. */
  possible: number;
  /** No file yet: nothing reliable was found, or it was found but has no free PDF. The student uploads it. */
  missing: number;
  /** Still being looked at (not looked up yet, or matched and waiting for its PDF). */
  pending: number;
}

export function summarizeReferences(refs: readonly ReferenceSource[]): ReferenceSummary {
  const out: ReferenceSummary = { total: refs.length, retrieved: 0, possible: 0, missing: 0, pending: 0 };
  for (const ref of refs) {
    switch (ref.sourceState) {
      case "retrieved":
      case "uploaded":
        out.retrieved += 1;
        break;
      case "possible":
        out.possible += 1;
        break;
      case "not_retrieved":
      case "matched_no_file":
        out.missing += 1;
        break;
      default:
        out.pending += 1;
    }
  }
  return out;
}

/** Entries the browser should still work on: not looked up yet, or matched and waiting for the PDF. */
export function entriesToWorkOn(refs: readonly ReferenceSource[]): ReferenceSource[] {
  return refs.filter((ref) => !ref.documentId && (ref.sourceState === "pending" || ref.sourceState === "matched"));
}
