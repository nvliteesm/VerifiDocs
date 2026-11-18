// Reads a Google Docs link. Plain text handling with no network and no Node-only code, so the browser (to spot a link
// pasted into the draft box) and the server (to build the one address it will fetch) use the same rule.
//
// Only the normal share link is accepted: docs.google.com/document/d/<id>/..., optionally with /u/<n>/ in front.
// A "Publish to web" link (docs.google.com/document/d/e/2PACX-.../pub) is recognised and refused with its own reason,
// because its text export does not exist (checked 18 Nov 2026: the export answers 404 for those ids).
export type LinkProblem = "bad_link" | "published_link";

export class LinkError extends Error {
  override name = "LinkError";
  readonly problem: LinkProblem;
  constructor(problem: LinkProblem) {
    super(problem);
    this.problem = problem;
  }
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{20,}$/;

/** The document id inside a Google Docs link. Throws LinkError for anything that is not one. */
export function parseGoogleDocLink(input: string): { id: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 2_000 || /\s/.test(trimmed)) throw new LinkError("bad_link");

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new LinkError("bad_link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkError("bad_link");
  if (url.hostname !== "docs.google.com" || url.username !== "" || url.password !== "") throw new LinkError("bad_link");

  // /document/d/<id>/edit, or /document/u/1/d/<id>/edit
  const parts = url.pathname.split("/").filter(Boolean);
  let i = 0;
  if (parts[i] !== "document") throw new LinkError("bad_link");
  i += 1;
  if (parts[i] === "u" && /^\d+$/.test(parts[i + 1] ?? "")) i += 2;
  if (parts[i] !== "d") throw new LinkError("bad_link");
  i += 1;
  if (parts[i] === "e") throw new LinkError("published_link");
  const id = parts[i];
  if (!id || !DOCUMENT_ID.test(id)) throw new LinkError("bad_link");
  return { id };
}

/** True when the whole text is one Google Docs link (a student pasted the link instead of the draft). */
export function looksLikeGoogleDocLink(text: string): boolean {
  try {
    parseGoogleDocLink(text);
    return true;
  } catch (error) {
    return error instanceof LinkError && error.problem === "published_link";
  }
}
