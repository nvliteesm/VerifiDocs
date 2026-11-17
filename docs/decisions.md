# Decisions

Settled unless marked proposed. Do not reopen without asking Steven. Updated 17 Nov 2026 to match `docs/rebuild-brief.md`.

| Date | Decision |
| --- | --- |
| 14 Nov 2026 | Direction: check-before-you-send claim verifier |
| 14 Nov 2026 | Quality bar: at least 90% correct verdicts, at most 5% missed unsupported claims |
| 14 Nov 2026 | Positioning: self-check, no AI-detection claims; drafts deleted after 30 days |
| 15 Nov 2026 | ~~Model: `gemini-4-hydrogen` for the product and the baseline~~ Superseded 17 Nov (see below) |
| 15 Nov 2026 | Timeline: 3-day build, then a beta window on real deadlines |
| 16 Nov 2026 | Scope: portfolio case study first; business viability assessed later |
| 16 Nov 2026 | Segment: final-year students with AI-supplied references; Indonesian skripsi is the test market; team features deferred |
| 16 Nov 2026 | Input: draft, reference list, optional source PDFs; existence check via Crossref and OpenAlex |
| 16 Nov 2026 | Verdicts: Reference not found, Can't check and No citation given added to the original five |
| 16 Nov 2026 | Features: ranked fix list and Fix this claim in v1 |
| 16 Nov 2026 | Not built: text humanizer and AI-writing detection |
| 16 Nov 2026 | Database: Neon free Postgres with pgvector (Supabase free slot gone; Firebase's backend functions need a card) |
| 16 Nov 2026 | Constraint: zero-card infrastructure; live demo link on a free host with a capped usage limit |
| 16 Nov 2026 | Source discovery stays in v1 (a cut was recommended and not adopted) |
| 16 Nov 2026 | Execution: one short browser-triggered request per claim, no long-running worker |
| 16 Nov 2026 | Storage: keep only page text and chunks; delete PDFs after ingestion |
| 17 Nov 2026 | Settled (was proposed 16 Nov): fixed TypeScript pipeline with no agent framework, quote-verification gate, hybrid retrieval |
| 17 Nov 2026 | Stack: rebuild in TypeScript and Next.js; no Python backend; Supabase is gone |
| 17 Nov 2026 | Repo: replace in place on `main`; old code tagged `legacy-rag-chat` (commit `847d49c`); old chat page, accuracy-testing page and `routes/evaluation.py` removed |
| 17 Nov 2026 | Model: Gemini through one adapter, starting on `gemini-2.5-flash-lite`; the model name is an env var; `gemini-4-hydrogen` is tested later in the eval. Supersedes the 15 Nov pin. |
| 17 Nov 2026 | Embeddings: `gemini-embedding-001`, 768 dimensions, separate query and document task types; final choice for Bahasa Indonesia and English comes from the eval |
| 17 Nov 2026 | Chunker: about 500 tokens, 80 overlap, page-tagged, chunks never cross a page; one pinned deterministic tokenizer |
| 17 Nov 2026 | Retrieval: pgvector plus Postgres full-text search, merged by reciprocal rank, top 5; no IVFFlat `lists = 100` |
| 17 Nov 2026 | PDF parsing: page text only, no OCR; a scanned PDF gives Can't check |
| 17 Nov 2026 | Users: no accounts; a session token identifies the user; no shared API key in the browser bundle; reads and deletes scoped to the token |
| 17 Nov 2026 | Host: Vercel Hobby under consideration, not final; every request designed to finish in under about 10 seconds either way |
| 17 Nov 2026 | Neon project `VerifiDocs` created in the Singapore region (`aws-ap-southeast-1`); credentials in git-ignored `.env.local` |
| 17 Nov 2026 | Dependencies approved: `next`, `react`, `react-dom`, `typescript`, `postgres` (no ORM; SQL migration files), `@google/genai`, `js-tiktoken` (pinned 1.0.21), `zod`, `vitest`, and the `@neon/config` and `@neon/env` packages from `neon init`. A PDF text library and a .docx reader are not yet chosen and need approval when stage 5 and stage 1 are built. |
| 17 Nov 2026 | Tokenizer: `js-tiktoken` with `cl100k_base`, pinned, bundled (no download). It is only a deterministic size measure; Gemini does not use it. Chunks are cut at word boundaries so no chunk ends in a broken character. |
| 17 Nov 2026 | Quote normalization: one function (`src/lib/rag/normalize.ts`: NFKC so ligatures expand, soft hyphens and zero-width characters removed, curly quotes and dash variants made plain, line-break hyphenation rejoined, whitespace collapsed; case-sensitive). It is applied to page text before chunking and to the judge's quote at verification. |
| 17 Nov 2026 | Retrieval settings (starting values, tune on the eval set): full-text config `simple` (no stemming, because sources mix English and Bahasa Indonesia); OR query of content words with a small English and Indonesian stopword list; reciprocal rank fusion with k = 60 over 20 candidates per arm; no vector index, so an exact scan; no similarity threshold. |
| 17 Nov 2026 | Gemini calls use API version `v1beta`, because the SDK default `v1` rejects JSON mode. Model names come from `GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL`. |
| 17 Nov 2026 | Test database: a Neon `dev` branch (expires 24 Nov 2026 under the 7-day policy in `neon.ts`). Database tests run only when `NEON_BRANCH=dev`, each in a rolled-back transaction; `npm run db:migrate` refuses `main` unless `--allow-main` is passed. |
| 17 Nov 2026 | Schema rules enforced in the database: Supported needs a quote and page; only supported, partial and contradicted verdicts may carry a quote; a fix suggestion exists only for partial and contradicted; one verdict per claim. The reference-list table is `reference_entries`, because `references` is a reserved SQL word. |
| 17 Nov 2026 | Events retention (decided by Steven): `events` rows do not expire and have no foreign key to sessions, so the beta metrics survive a 30-day purge. Events hold ids, counts and buckets only, never draft text, quotes or reference text. This is the one exception to "every row expires in 30 days". |
| 17 Nov 2026 | Dev branch (decided by Steven): leave the 7-day expiry as is and recreate the branch when it expires, using the steps in `CLAUDE.md`. |
| 17 Nov 2026 | `AGENTS.md` (decided by Steven): not kept. `agentRules: false` in `next.config.ts` stops `next dev` generating it; `CLAUDE.md` is the single source of agent guidance. |
| 17 Nov 2026 | Dependency added (approved by Steven): `mammoth` (BSD-2, no install scripts of its own) to read .docx drafts. Crossref and OpenAlex use Node's built-in `fetch`, no new package. |
| 17 Nov 2026 | A citation that matches no entry in the reference list, cannot be read, or points at an entry neither Crossref nor OpenAlex knows gets Reference not found (decided by Steven). The reason text says which, so the student can tell "not in your list" from "not found in the services". |
| 17 Nov 2026 | A claim that cites several references is Reference not found if ANY cited reference is not found; otherwise it is checked against those that have a usable PDF, and Can't check only if none does. |
| 17 Nov 2026 | Citation matching: a marker naming one author ("Lee, 2021", "Smith et al., 2021") must match the entry's FIRST author; a marker naming several surnames matches if all appear, in any order. Numeric markers map to list position. |
| 17 Nov 2026 | Reference lookup rules: a candidate matches only if its title matches the entry (80% of title words, at least two) AND its first author's surname appears in the entry. A year more than one off still counts as found but sets `yearMismatch` (preprint mirrors carry other years). "Not found" requires every lookup to have answered; a failed lookup is a retry, never a verdict. A 429 or 503 is retried once after the server's Retry-After wait, capped at 3 seconds. |
| 17 Nov 2026 | Crossref and OpenAlex requests carry only the reference entry's text and a generic User-Agent (`VerifiDocs-portfolio/0.1`), with no contact email, so no personal detail leaves the machine. The cost is that Crossref's public pool has lower rate limits than its polite pool. Decided by Steven: keep it generic and cache each resolved reference per run on `reference_entries` (migration 0003, `reference-cache.ts`) instead of adding an email. Revisit if the beta is still throttled. |
| 17 Nov 2026 | Claim extraction: the model must copy each claim and citation verbatim. Code drops any claim or citation not found in the draft (after the shared normalization), counts the drops, and never turns a dropped citation into "no citation". The draft is passed as delimited data with an instruction to ignore instructions inside it. |
| 17 Nov 2026 | Starting limits: draft 60,000 characters (longer is rejected, not cut), .docx 5 MB, about 6,000 characters per extraction unit, 40 claims per unit, 200 reference entries. |
| 17 Nov 2026 | Source finding: a student-linked document wins; otherwise the DOI or the resolved title printed in the first three pages of an uploaded PDF, then the title words in the filename (the only clue for a scan). Scanned PDFs are reported as Can't check with a reason. |
| 17 Nov 2026 | Extraction recall (decided by Steven): measured in the eval, not tuned by hand. A live test missed one plain uncited claim ("The central bank raised interest rates by 25 basis points in March."). The eval gets a set of whole drafts with every factual claim labelled, with extraction recall reported next to verdict accuracy and a held-out slice. Until then, extraction misses are an unmeasured risk. |
| 17 Nov 2026 | Next build step (decided by Steven): stage 5, PDF text extraction and all-or-nothing ingest. A PDF text library needs Steven's approval before it is added. |
| 17 Nov 2026 | Dependency added (approved by Steven): `unpdf` 2.x (MIT, 3 MB, no dependencies, no install scripts, from the `unjs` organisation) to read PDF text page by page. Its optional peers (`pdfjs-dist`, `@napi-rs/canvas`) are not installed. It requires Node 24 or newer, which matches the dev machine; whether the free host offers Node 24 is unverified. |
| 17 Nov 2026 | Stage 5 design: the PDF arrives in one request and its bytes are never stored (no file column exists), so there is nothing to delete after ingestion. Normalized page text is saved to `pages` first; the browser then calls an ingest request repeatedly, each chunking, embedding and saving the next 10 pages in one transaction. The document is `ingesting` (invisible to retrieval) until the last batch flips it to `ready` in that same transaction. A failed batch writes nothing and is safe to retry; two overlapping requests cannot double-write. A scan (no text) becomes `no_text` at upload. `abandonDocument` deletes a document with its pages and chunks. |
| 17 Nov 2026 | Stage 5 starting limits: 10 MB per PDF, 300 pages, 10 sources per session, 10 pages per ingest request. Tune after the first beta runs. |

## Why some things are out

- **Humanizer and AI detection:** they contradict the self-check positioning, detectors are unreliable, and they would attract users who do not use the checker. Demand can be probed with a question in the beta's "would you pay?" prompt.
- **Firebase:** Cloud Functions need the Blaze plan, and Blaze needs a payment method (Firebase pricing page, checked 17 Nov). Cloud Storage is listed with a no-cost Spark quota on that page, although a community source says it now needs Blaze, so that point is unresolved. Firestore also has no built-in keyword search. Neon was chosen mainly because it keeps Postgres, pgvector and full-text search with no card.
- **Python backend:** the legacy app was FastAPI and Supabase. The rebuild is one TypeScript codebase. The Python RAG code is a reference only (tag `legacy-rag-chat`).
