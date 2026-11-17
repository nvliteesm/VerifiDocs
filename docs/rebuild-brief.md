# VerifiDocs rebuild: instructions for Claude Code

Date agreed: 17 Nov 2026. Owner: Steven Lim.
Read first: `CLAUDE.md`, `docs/current-state.md`, `docs/architecture.md`, `docs/verdicts.md`, `docs/decisions.md`, `docs/eval.md`, `docs/events.md`.
If anything here conflicts with those docs, this file wins for the rebuild, and you must tell Steven which doc needs updating.

## What we are building

VerifiDocs is a check-before-you-send claim verifier for final-year students who write with AI-supplied references. Indonesian skripsi is the test market. It is a PM portfolio project, so the quality bar and the evidence matter more than feature count.

The repo today is a different product: a general PDF chat app (Python/FastAPI, Vite, Supabase). `docs/current-state.md` has the audit. We are rebuilding it as the verifier.

## Decisions already made (do not reopen)

| Topic | Decision |
| --- | --- |
| Stack | Rebuild in TypeScript and Next.js. No Python backend. |
| Database | Neon free Postgres with pgvector and Postgres full-text search. Supabase is gone. |
| Host | Vercel Hobby is under consideration, not final. Design for short requests either way. |
| Cost | Zero-card. Do not add any service that needs a payment method. |
| Repo | Replace in place on `main`. Steven tags the old code first as `legacy-rag-chat` (commit `847d49c`). |
| Old features | Remove the chat page, the accuracy-testing page, and the dead `routes/evaluation.py`. |
| LLM | Gemini through one adapter. Start on `gemini-2.5-flash-lite`. The model name is an env var. `gemini-4-hydrogen` is tested later in the eval. |
| Embeddings | `gemini-embedding-001`, 768 dimensions, separate query and document task types. |
| Execution | One short browser-triggered request per claim, up to 5 in flight, state in Postgres. No long-running worker. |
| Storage | Delete the PDF after ingestion. Keep only page text and chunks. Drafts, page text and chunks auto-delete after 30 days. |
| Users | No accounts. A session token identifies the user. |
| Source discovery | Stays in v1. |

## Keep the RAG design, port it from Python

The RAG pieces stay in the project. Only the language changes. Use `legacy-rag-chat` as the reference.

- **Chunker:** about 500 tokens, 80 overlap, page-tagged, chunks never cross a page, so every chunk has one exact page. Make the tokenizer deterministic. The old code fell back to a whitespace tokenizer when `tiktoken` failed, so chunk sizes differed between environments. Pick one tokenizer and pin it.
- **Embeddings:** batch size 100, 768 dimensions, query and document task types.
- **Retrieval:** hybrid. pgvector similarity plus Postgres full-text search, merged by reciprocal rank, top 5. The old code was vector-only with an IVFFlat index at `lists = 100`. Do not copy that index setting; a small corpus does not need it.
- **PDF parsing:** page-by-page text. No OCR. Scanned PDFs give empty pages, so such a source becomes Can't check, not a wrong verdict.

## Pipeline (fixed sequence of typed stages, no agent framework)

1. Parse draft.
2. Extract claims (Gemini).
3. Resolve reference (Crossref, then OpenAlex).
4. Find source file.
5. Ingest source once per PDF (parse pages, chunk, embed, store).
6. Retrieve passages.
7. Judge claim (Gemini, JSON with verdict, quote, page, chunk_id, reason).
8. Verify quote (exact substring match after normalization; failure becomes Can't tell).
9. Save and log.

Eight verdicts: Supported, Partial, Contradicted, Not in sources, Can't tell, Reference not found, Can't check, No citation given. Definitions and the fix-list order are in `docs/verdicts.md`.

v1 features: ranked fix list, and "Fix this claim" (a suggested sentence that uses only the verified quote and page).

## Hard rules (also in CLAUDE.md)

1. A verdict that carries a quote must pass quote verification. If it fails, the verdict becomes Can't tell.
2. Gemini is called only through one adapter. No second client, no hardcoded model name.
3. No text humanizer, no AI-writing detection, no plagiarism check.
4. Delete PDFs after ingestion. Delete drafts, page text and chunks after 30 days.
5. Zero-card infrastructure only.
6. No long-running jobs. Each request must finish quickly. Aim for under 10 seconds per request.
7. No accounts. No shared API key in the browser bundle.
8. No agent framework.
9. Never commit secrets. Names only in `.env.example`.
10. Never edit eval labels.
11. Never put draft text, quotes or reference text in events.

## Known traps from the audit

- **Quote normalization:** the old `text_cleaner.py` collapses all whitespace but does not handle line-break hyphenation or ligatures. Real quotes will fail the exact-match check and show up as Can't tell. Use one normalization function for both the stored chunk text and the quote check. Handle hyphenation, ligatures and whitespace in it, and test it.
- **Judge independence:** the old evaluator compared an answer to a "reference answer" written by the same model from the same chunks. Do not repeat that. The judge verifies a claim against retrieved passages and must return a quote that is then checked in code.
- **Orphaned data:** the old upload inserted the document row before chunking and embedding, so failures left empty documents. Ingest must be all-or-nothing per PDF, or clean up on failure.
- **Isolation:** the old app returned every document to every caller. Scope all reads and deletes to the session token.
- **Vercel time limit:** sources disagree on the function time limit. Check the actual project setting before the first deploy, and keep each request short regardless.
- **Neon cold start:** free compute sleeps after 5 minutes idle, so the first request is slower. The UI must handle that without showing an error.

## First session: do in this order

1. Confirm the `legacy-rag-chat` tag exists. If not, stop and tell Steven.
2. Scaffold Next.js with TypeScript in place. Remove the old `backend/`, `frontend/`, Supabase code and `migrations/`. Do not remove `docs/`.
3. Write the Neon schema: documents, pages, chunks (with a vector column and a full-text column), claims, verdicts, events. Use a migration file.
4. Build the single Gemini adapter, with the model name from an env var.
5. Port the chunker and embeddings, with tests. Port the old property-test ideas where they still apply.
6. Build the quote normalization function and its tests before any judge code.
7. Build hybrid retrieval and test it on a small fixture.
8. Fill the Commands section of `CLAUDE.md` with the real commands, confirmed by running them.
9. Update `docs/decisions.md` and `docs/architecture.md` to match this file, then list what you changed.

Stop after step 9 and report. Do not start stages 1 to 4 or the UI in the first session.

## Not in this session

- The eval harness and `evals/claims.csv`. Steven exports the Eval Claims tab from the sheet. The quote and page columns are still empty, and about 10 Bahasa claims plus Reference-not-found, Can't check and No citation given cases still need to be written.
- Choosing the embedding model for Bahasa Indonesia and English, and the full-context vs RAG comparison.
- Choosing the final host.
- User interviews and willingness to pay (Steven's task, not yours).

## When to stop and ask Steven

- A choice that needs a payment method.
- A change to the verdict list, the hard rules or the v1 scope.
- Deleting anything outside the old backend, frontend, Supabase code and migrations.
- Anything that would put draft text, quotes or secrets into logs or events.

## How to report

Short and plain. Say what changed, what you ran and what you did not run. Do not claim a command works unless you ran it. Mark anything read from code but not observed.
