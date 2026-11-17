# Architecture

Status: design from 16 Nov 2026 (PRD v0.3), updated 17 Nov 2026 to match `docs/rebuild-brief.md`. Nothing below is built yet; the repo still contains the legacy Python app until the rebuild's step 2 (see `docs/current-state.md`). Items marked "starting value" are meant to be tuned on the eval set. Items marked "unverified" must be checked before building.

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

One module is the only code that calls Gemini, for generation and embeddings. Model names come from env vars (generation model starts as `gemini-2.5-flash-lite`; embeddings as `gemini-embedding-001`), never from literals in stage code. The product and the eval baseline use this same adapter. Exact env var names are decided in rebuild step 4.

## Request model

The host is free and card-less, so no request may run long: aim for under 10 seconds each. The browser drives the work.

- `POST /api/runs`: parse the draft and extract claims; claims are saved as `pending`. Long drafts are extracted per section, one request each.
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
| 8 | Verify quote | Judge output and passages | Verified or downgraded verdict | No | Can't tell if the quote is not found |
| 9 | Save and log | Final verdict | Verdict row and events | No | none |

Stages 3 to 9 run per claim. A failed claim gets a bounded retry, then Can't tell with the reason logged. Fix this claim runs after stage 8 for Partial and Contradicted verdicts and must use only the verified quote. A source whose pages have no extractable text (a scanned PDF; there is no OCR) is not a valid source for stage 4, so the claim exits as Can't check.

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

The quote must be a substring of the cited chunk's text after normalization. There is one normalization function, and it is applied to both the chunk text at ingest (or at check time) and the quote. It handles whitespace, hyphenation at line breaks, and ligatures. It has its own tests and is built before any judge code. If the quote is not found, the verdict becomes Can't tell. This check is code, not a model call.

## Retrieval

Hybrid search: pgvector cosine similarity plus Postgres full-text search, merged by reciprocal rank, top 5 returned. Chunks are about 500 tokens with 80 overlap, and a chunk never crosses a page, so each carries the one page it came from (starting values). The tokenizer is one pinned, deterministic implementation, so chunk boundaries are the same in every environment. The embedding model (`gemini-embedding-001`, 768 dimensions, separate query and document task types) must handle Bahasa Indonesia and English; this is tested on the eval set. The vector column dimension is 768. The legacy IVFFlat `lists = 100` index is not carried over; start with an exact scan or a size-appropriate index for a small corpus.

## Data model (proposed)

Minimum set: `documents`, `pages`, `chunks` (text, page, embedding, full-text vector), `claims`, `verdicts` (verdict, quote, page, chunk id, reason, fix suggestion), `events`. Earlier designs also listed `sessions`, `runs`, `drafts`, `references` and `sources`; these are likely needed for the session token and the run model and are decided when the schema is written (rebuild step 3, as a migration file). Every row can be traced to a session and expires 30 days after creation (drafts, page text, chunks). Cleanup is a scheduled job or lazy deletion on the next request; a free-host cron is unverified.

## Source discovery (in v1)

Gemini suggests candidate sources from a topic prompt. Follow the guard rules in the PRD's Source discovery section. Minimum: every suggestion passes the same Crossref or OpenAlex existence check before it is shown, and discovery never produces a Supported verdict by itself.

## Out of scope

Team workspace and board, Docs or Word add-in, accounts, payments, text humanizer, AI-writing detection, plagiarism checking, OCR.
