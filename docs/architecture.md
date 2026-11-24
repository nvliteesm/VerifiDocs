# Architecture

Status: design from 16 Nov 2026 (PRD v0.3), updated 17 Nov 2026 to match `docs/rebuild-brief.md`. Built so far (17 Nov 2026): the Neon schema, the Gemini adapter, quote normalization, the chunker, embedding helpers, hybrid retrieval, stages 1 to 9 as library code, the API routes and the session cookie (see "Stages 1 to 4 as built", "Stage 5 as built", "Stages 6 to 9 as built" and "API as built"). The UI, the eval harness and deployment are not built. The legacy Python app was removed and is preserved at the git tag `legacy-rag-chat` (see `docs/current-state.md`). Items marked "starting value" are meant to be tuned on the eval set. Items marked "unverified" must be checked before building.

## Components

| Component | Role |
| --- | --- |
| Web app (Next.js, TypeScript) | Upload, progress, results, ranked fix list |
| App server (Next.js route handlers) | Routes and a session token; no accounts in v1; state lives in Postgres |
| Pipeline | Fixed sequence of typed stages; Gemini at extract, judge and embeddings only |
| Postgres (Neon free plan, Singapore) with pgvector | Claims, verdicts, event log, chunks and vector index; 1 GB per project |
| External APIs | Gemini through one adapter, Crossref, OpenAlex |
| Eval harness | Runs the same pipeline offline on the eval set (not built yet) |

There is no file store. PDFs are deleted after ingestion. There is no Python backend.

## Gemini adapter

One module is the only code that calls Gemini, for generation and embeddings. Model names come from env vars (generation model starts as `gemini-2.5-flash-lite`; embeddings as `gemini-embedding-001`), never from literals in stage code. The product and the eval baseline use this same adapter. The env vars are `GEMINI_API_KEY`, `GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL`. The adapter uses API version `v1beta` (the SDK default `v1` rejects JSON mode), validates every JSON answer with zod and retries once if it is malformed, checks that embeddings are 768 dimensions, and never puts prompt text or model output in an error message. A test fails the build if any other file imports the Gemini SDK or hardcodes a `gemini-` model name.

## Request model

The host is free and card-less, so no request may run long: aim for under 10 seconds each. The browser drives the work.

- `POST /api/runs`: parse the draft, save it and its reference list (no model call). `POST /api/runs/:id/extract`: extract the claims of one unit of the draft, one request per unit; claims are saved as `pending`.
- `POST /api/sources`: ingest one PDF (parse pages, chunk, embed, save chunks, delete the PDF). Long PDFs go in batches of pages, one request per batch. Ingest is all-or-nothing per PDF: if any batch fails, the partial rows are removed (or are never made visible), so no empty or half-filled source is left behind.
- `POST /api/claims/:id/check`: run stages 3 to 9 for one claim. Must be idempotent and safe to retry.
- `GET /api/runs/:id`: progress and verdicts.

The browser keeps up to 5 claim checks in flight. Reopening a run resumes the `pending` claims.

**Session token.** A session token (proposed: an httpOnly cookie issued on first request) identifies the user. Every read, write and delete is scoped to it, and nothing returns another session's documents. There is no shared API key in the browser bundle.

**Host.** Vercel Hobby is under consideration and not final. Sources disagree on its function time limit (10 seconds by default and up to 60 in older docs, 300 with Fluid compute in newer ones), so check the project's setting before the first deploy and keep each request short regardless. Hobby is for personal, non-commercial use only and has hard usage caps.

**Neon cold start.** Free compute sleeps after 5 minutes idle, so the first request after a pause is slower. The client retries and shows a "waking up" state, not an error.

## Pipeline stages

| # | Stage | Input | Output | Gemini | Exit verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Parse draft | .docx or pasted text | Plain text with sections | No | none |
| 2 | Extract claims | Draft text | Claims, each with its citation or none | Yes | No citation given |
| 3 | Resolve reference | Citation text | Crossref or OpenAlex match, or none | No | Reference not found |
| 4 | Find source file | Matched reference | An ingested source with extractable text, or none | No | Can't check |
| 5 | Ingest source (once per PDF) | PDF | Page-tagged chunks with embeddings | Embeddings | none |
| 6 | Retrieve passages | Claim text | Top 5 chunks with page numbers | Query embedding | none |
| 7 | Judge claim | Claim and passages | Judge output (below) | Yes | Supported, Partial, Contradicted, Not in sources, or Can't tell |
| 8 | Verify quote, then a second look at Supported and Partly supported | Judge output and passages | Verified or downgraded verdict | Review model, Supported and Partly supported only | Can't tell if the quote is not found; Partly supported if a number in the sentence is not in the quote's passage; the review model's stricter verdict if it disagrees (Supported to Partly supported or Contradicted; Partly supported to Contradicted) |
| 9 | Save and log | Final verdict | Verdict row and events | No | none |

Stages 3 to 9 run per claim. A lookup or model that is unavailable or times out never ends a claim: the browser retries a few rounds, then the card offers "Try again" (24 Nov 2026). A model that keeps giving unusable answers ends the claim as Can't tell after 3 attempts, with the reason logged. Fix this claim runs after stage 8 for Partial and Contradicted verdicts and must use only the verified quote. A source whose pages have no extractable text (a scanned PDF; there is no OCR) is not a valid source for stage 4, so the claim exits as Can't check.

## Stages 1 to 4 as built

Library code in `src/lib/pipeline/`, tested, not yet called by any API route.

- **1. Parse draft** (`parse-draft.ts`): pasted text or .docx (via `mammoth`) to cleaned text, sections, an optional trailing reference list ("References", "Daftar Pustaka" and similar; the last such heading wins, so a contents page is ignored), and extraction units of at most about 6,000 characters. A separate `parseReferenceList` splits a pasted list into entries; an entry's 1-based position is what a numeric citation refers to. Known limit: an unnumbered list whose entries wrap across lines with no blank lines between them splits too finely.
- **2. Extract claims** (`extract-claims.ts`): one request per unit through the adapter. Only claims about the outside world are asked for, not statements about the student's own project or method. Every claim and citation must appear in the unit after normalization or it is dropped and counted. A "citation" with no year, "n.d." or reference number (a table or list label) counts as none. A claim with no citation of its own takes the next citation later in its paragraph (`citation_inherited`); one with none at all exits as No citation given in `runPrelude`. Each claim also records the heading it sits under (`claims.section`), for grouping the results. The model reads the unit with one line per paragraph and no blank lines.
- **3. Resolve reference** (`citations.ts`, `resolve-reference.ts`): read the citation marker, find the reference-list entry, then look the entry up (a DOI first, then Crossref, then OpenAlex title searches). Rules are in `docs/decisions.md`. Only the entry's text is sent to those services.
- **4. Find source file** (`find-source.ts`): see `docs/decisions.md`. Reads documents with status `ready` or `no_text` for the session only.
- **The scan** (`scan.ts`, `matchCitation` in `prelude.ts`): when the last slice of a draft has been read for claims, the claims that end before any lookup (no citation, an unreadable citation, a citation not in the reference list) are given their verdict in bulk. The others stay pending until the student starts the check. See `docs/decisions.md`, 18 Nov.
- **`runPrelude`** (`prelude.ts`) chains 2 to 4 for one claim and returns an exit (a verdict with a reason and the exit stage), a retry request (a lookup failed), or the documents to retrieve from. The lookups are injected, so it is tested with fakes.

**Reference caching** (`reference-cache.ts`): `resolveEntryCached` looks an entry up once per run and saves the answer on its `reference_entries` row (migration 0003 adds `resolved_year` and `year_mismatch`), so five claims citing one paper make one lookup. Only found and not_found are saved; a failed lookup never is; the first saved answer wins if two claims race; reads and writes are scoped to the session.

## Stage 5 as built

`src/lib/pipeline/ingest.ts`. No file store, and no request runs long.

- **`createDocumentFromPdf`**: reads the PDF with `unpdf`, normalizes each page's text and saves the pages. The bytes are never stored. A PDF with no extractable text becomes `no_text` immediately. Limits (starting values): 10 MB, 300 pages, 10 sources per session; the filename is cleaned.
- **`ingestNextBatch`**: chunks the next 10 saved pages, embeds them (outside the transaction, through the adapter), then in one transaction locks the document row, checks nobody else advanced it, saves the chunks with contiguous indexes, advances `pages_ingested`, and on the last batch sets `ready` (or `no_text` if there were no chunks). A failed or overlapping call writes nothing.
- **`abandonDocument`**: deletes a document, and its pages and chunks by cascade.
- Retrieval reads only `ready` documents, so a half-ingested source is never searched. A real 15-page paper reads in about 0.3 seconds, so the page save fits easily in one short request; embedding is the slow part and is the reason for batches.

Real-PDF check (`npm run test:live`): a public two-column paper is read, chunked, and sentences quoted from it are found inside its chunks despite ligatures and line-break hyphenation.

Not done yet: the API routes that call these functions, deciding when to give up and call `abandonDocument` after repeated batch failures, and the session cookie.

## Stages 6 to 9 as built

Library code in `src/lib/pipeline/` and `src/lib/events.ts`, tested, not yet called by an API route.

- **6. Retrieve** (`src/lib/rag/retrieve.ts`): hybrid search over only the source(s) the claim cites, scoped to the session.
- **7. Judge** (`judge.ts`) and **8. Verify quote** (`verify-quote.ts`): see `docs/decisions.md` for the rules. The judge's `chunk_id` carries a passage label (P1, P2, ...), mapped back to the real chunk in code.
- **Fix this claim** (`fix.ts`): after stage 8, Partial and Contradicted only.
- **9. Save and log** (`save-verdict.ts`): one transaction saves the verdict, marks the claim done and logs events. The database rejects evidence-rule violations. Idempotent, first verdict wins.
- **`checkClaim`** (`claim-check.ts`) chains stages 2 to 9 for one claim and is what `POST /api/claims/:id/check` will call. It returns `done` with the saved verdict, or `retry` with the attempt number.
- **Events** (`events.ts`): strict schemas for all 15 events in `docs/events.md`, a `logEvent` helper, and bucket helpers.
- Not built yet: the UI, the eval harness, deployment.

**Live smoke test (17 Nov, `npm run test:live`, 11 hand-written claims, English and Bahasa Indonesia; not an accuracy measure):** 10 of 11 matched the expected verdict, and none of the 8 claims that should not be Supported was. One "contradicted" claim came out Partial. Judge calls took 0.7 to 1.1 seconds. Two of four fixes were produced; the number guard is conservative.

**Known risks:**
- *Garbled tables.* On a table whose cells did not extract in order, the judge said Supported for a wrong claim. Its quote failed verification, so the gate turned it into Can't tell, but a quote copied verbatim from a garbled row would pass. The eval needs table cases.
- *Extraction recall.* A claim that stage 2 never extracts is never checked (see `docs/eval.md`).
- *Verdict stability.* Temperature is 0 and the judge was stable (8 of 8 identical verdicts) on identical passages. The instability seen on 17 Nov (one claim got Contradicted, Partial and Not in sources over six live runs) came from retrieval: ties were broken by random chunk id, so the top 5 changed between ingests. That is fixed and four later runs agreed, but retrieval can still miss evidence, and a claim marked Not in sources because retrieval missed it is the worst failure. The first saved verdict wins, so a claim does not flip-flop within a run. Partial versus Contradicted is a judgement call the eval must measure.
- *Concurrent lookups.* Several claims citing one reference can look it up at the same moment before the first result is cached, which hit Crossref's rate limit. The 7 second deadline bounds the damage; a per-reference lock would remove it (not built).

## API as built

Handlers in `src/lib/api/` (`runs.ts`, `sources.ts`, `claims.ts`), wrapped by `handler.ts`, with thin route files under `src/app/api/`. Everything below runs through `handleWith`: refuse a cross-site write, resolve the session, run the handler, attach a new session's cookie, map any error to a safe response.

| Route | Does |
| --- | --- |
| `POST /api/runs` | Pasted draft (JSON) or .docx (multipart): parse, save the run and its reference list. Returns the unit count. |
| `POST /api/runs/:id/extract` | `{ "unit": n }`: extract that unit's claims. Idempotent per unit. When the last unit lands the run becomes `checking`. |
| `GET /api/runs/:id` | Run progress, every claim with its verdict, quote, page and fix, the references and their resolution, verdict counts, and the ranked fix list (ids). |
| `DELETE /api/runs/:id` | Delete the caller's check now (draft text, claims, verdicts, reference entries; events are kept, they hold only ids, counts and buckets). 204, or 404 for an unknown id or another session's check. Source PDFs have their own delete. |
| `POST /api/sources` | Multipart PDF. Saves page text, never the file. Returns the page count. |
| `POST /api/sources/:id/ingest` | Chunk, embed and save the next 10 pages. Call until `done`. |
| `GET /api/sources`, `DELETE /api/sources/:id` | List, and remove a source with its pages and chunks. |
| `POST /api/claims/:id/check` | Stages 3 to 9 for one claim. `done` with the verdict, or `retry` with the attempt number. |
| `POST /api/events` | Seven client-side events only, each strictly validated. |

**Live end-to-end over real HTTP (`npm run smoke:api`, 17 Nov):** a 2.2 MB, 15-page PDF uploaded and ingested in two batches; four claims checked in parallel; the run closed. Verdicts: 2 Supported with exact quotes on page 1, 1 Partial (the training-time claim, against "Training took 3.5 days on 8 P100 GPUs." on page 8, with a correct suggested fix), 1 No citation given. 11 requests; after the fixes in `docs/decisions.md`, four runs gave identical verdicts, none took over 10 seconds, and the slowest was 7.7 seconds. The pooled Neon connection with prepared statements off worked.

**Not done / unverified:** a per-reference lock for concurrent lookups; request-body limits on the chosen host (see `docs/decisions.md`); the first-request delay when Neon's compute is asleep was handled in code (503 with retry) but not measured live; deployment.

## Judge output contract

```json
{
  "verdict": "supported | partial | contradicted | not_in_sources | cant_tell",
  "quote": "text copied exactly from one passage, or null",
  "page": 12,
  "chunk_id": "id of the passage the quote came from, or null",
  "reason": "one sentence"
}
```

Reject any output that does not match this shape. Do not repair it silently; log the failure and retry once.

**Judge independence.** The judge sees only the claim and the retrieved passages. There is no model-written "reference answer", which the legacy evaluator used and which made the judge depend on the same model's earlier output. Whatever quote the judge returns is then checked in code.

## Quote verification

The quote must be a substring of the cited chunk's text after normalization. There is one normalization function (`src/lib/rag/normalize.ts`). It is applied to page text before chunking, so stored chunks are already normalized, and to the judge's quote at verification. It expands ligatures, removes soft hyphens and zero-width characters, makes curly quotes and dash variants plain, rejoins words hyphenated across line breaks, and collapses whitespace. It is case-sensitive and idempotent, and has its own tests. A known limit: a genuine hyphenated word broken at a line end is rejoined without its hyphen on both sides, so a quote written with the hyphen will not match and becomes Can't tell. A very short quote also matches easily; the verify stage needs a minimum quote length, to be decided when it is built. If the quote is not found, the verdict becomes Can't tell. This check is code, not a model call.

## Retrieval

Hybrid search: pgvector cosine similarity plus Postgres full-text search, merged by reciprocal rank (k = 60, 20 candidates per arm), top 5 returned. Searches are scoped to the session and to documents whose status is `ready`. The full-text arm uses the `simple` config and an OR query of the claim's content words (small English and Indonesian stopword list). There is no similarity threshold; deciding "not in sources" is the judge's job. Chunks are about 500 tokens with 80 overlap, cut at word boundaries, and a chunk never crosses a page, so each carries the one page it came from (starting values). The tokenizer is `js-tiktoken` with `cl100k_base`, pinned and bundled, so chunk boundaries are the same in every environment; it is only a size measure, not Gemini's tokenizer. The embedding model (`gemini-embedding-001`, 768 dimensions, separate query and document task types) must handle Bahasa Indonesia and English; this is tested on the eval set. The vector column dimension is 768. The legacy IVFFlat `lists = 100` index is not carried over; start with an exact scan or a size-appropriate index for a small corpus.

## Data model (proposed)

Written in `db/migrations/0001_init.sql` and applied to the Neon `dev` branch: `sessions` (only a hash of the token), `runs` (one check of one draft, holding the draft text), `documents` (source PDFs: status `ingesting`, `ready`, `no_text` or `failed`; the file itself is never stored), `pages`, `chunks` (content, page, 768-dimension embedding, generated full-text column), `reference_entries`, `claims`, `verdicts` and `events`. Every row traces to a session. Runs and documents expire 30 days after creation and take their claims, verdicts, pages and chunks with them (cascade); `purge_expired()` does the deletion and is called lazily or by a scheduler (a free-host cron is unverified). The database enforces the evidence rules: Supported needs a quote and page, only verified verdicts carry a quote, a fix suggestion exists only for Partial and Contradicted, and a claim has one verdict. Ingest is all-or-nothing: a document is `ingesting` until every batch is saved, then one update makes it `ready`, and retrieval reads only `ready` documents. Exception, decided 17 Nov: `events` do not expire and have no foreign key to sessions, so beta metrics outlive the purge; they hold ids, counts and buckets only.

## Source discovery (in v1)

Built as "Find a source" (18 Nov 2026); the plan, spike results and what was built are in `docs/source-discovery.md`. Search first: the model writes queries and copies a sentence from an abstract, OpenAlex returns works that exist, and code keeps a pick only if its sentence is in the abstract. A found paper is "not read yet" and never counts as support; checking a claim against one runs the normal check on its full text, and the claim is marked "Found here: not in your draft yet". This differs from the PRD's wording ("Gemini suggests candidate sources from a topic prompt"), which needs updating.

## Out of scope

Team workspace and board, Docs or Word add-in, accounts, payments, text humanizer, AI-writing detection, plagiarism checking, OCR.
