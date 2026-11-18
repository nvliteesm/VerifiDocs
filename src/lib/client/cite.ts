// APA 7 text for a paper Find a source found, built only from what OpenAlex returned (never written by the model).
// Names come as display names ("Kim Lee"): the last word is the surname, the others become initials. A one-word
// name (common in Indonesia, "Sukarno") stays whole.
import type { FoundSourceView } from "./types";

type Paper = Pick<FoundSourceView, "authors" | "year" | "title" | "venue" | "doi">;

function surname(name: string): string {
  const words = name.trim().split(/\s+/);
  return words[words.length - 1] ?? name;
}

function referenceName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words[0] ?? "";
  const initials = words
    .slice(0, -1)
    .map((word) => `${word.replace(/\./g, "").charAt(0).toUpperCase()}.`)
    .join(" ");
  return `${words[words.length - 1]}, ${initials}`;
}

/** "(Lee, 2021)", "(Lee & Tan, 2021)", "(Lee et al., 2021)"; "(n.d.)" with no year; the title with no author. */
export function inTextCitation(paper: Paper): string {
  const year = paper.year ? String(paper.year) : "n.d.";
  const names = paper.authors.map(surname);
  if (names.length === 0) return `(${paper.title.split(/\s+/).slice(0, 4).join(" ")}, ${year})`;
  if (names.length === 1) return `(${names[0]}, ${year})`;
  if (names.length === 2) return `(${names[0]} & ${names[1]}, ${year})`;
  return `(${names[0]} et al., ${year})`;
}

/** "Lee, K., & Tan, M. (2021). Title. Venue. https://doi.org/..." APA 7 lists up to 20 authors. */
export function referenceEntry(paper: Paper): string {
  const names = paper.authors.slice(0, 20).map(referenceName).filter(Boolean);
  const authors =
    names.length === 0 ? "" : names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  const year = paper.year ? `(${paper.year})` : "(n.d.)";
  const title = paper.title.replace(/\.$/, "");
  const head = authors ? `${authors} ${year}. ${title}.` : `${title}. ${year}.`;
  return [head, paper.venue ? `${paper.venue}.` : "", paper.doi ?? ""].filter(Boolean).join(" ");
}
