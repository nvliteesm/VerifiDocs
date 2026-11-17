# Current state audit

Date: 17 Nov 2026. Commit audited: `847d49c` on `main`. Scope: what the repo contains today, compared with PRD v0.3 and CLAUDE.md.

Method: I read the backend source, migration, docs, READMEs and `package.json` files. I did **not** run the backend tests, the frontend lint or build, or the app, because `pytest` is not installed, there is no backend venv, and `frontend/node_modules` is absent. Anything about runtime behaviour below is read from code, not observed. Git history was not scanned for secrets.

## Summary

The repo is a **general PDF question-answering app** (RAG chat plus a manual "accuracy testing" page). It is not the claim verifier in the PRD. It shares the building blocks (PDF parsing, page-tagged chunking, Gemini embeddings, pgvector retrieval) but none of the verifier pipeline exists, and the stack differs from the one CLAUDE.md assumes.

## Stack: assumed vs actual

| | CLAUDE.md assumes | Repo has |
| --- | --- | --- |
| Language (backend) | TypeScript | Python 3.11+ |
| Server | Next.js app server | FastAPI + uvicorn |
| Frontend | Next.js | React 19 + Vite 8, plain JS (JSX), Tailwind 4, react-router |
| Database | Neon Postgres + pgvector | Supabase Postgres + pgvector, accessed through the Supabase client and its service-role key |
| LLM | `gemini-4-hydrogen` through one adapter | `gemini-2.5-flash-lite` hardcoded; embeddings `gemini-embedding-001` at 768 dimensions |
| Host | Free, no card (Vercel Hobby under consideration) | README documents Railway (backend) + Vercel (frontend); whether Railway meets zero-card is unverified |
| Reference lookup | Crossref, OpenAlex | none |

## What exists

**Backend** (`backend/app`, about 1,600 lines of source, about 1,950 lines of tests)

- `POST /documents/upload`: validates a PDF (10 MB cap, 5 per minute), saves it to local `uploads/`, extracts text per page with PyMuPDF, cleans and chunks it, embeds the chunks, inserts them. Also list, get, chunks and delete.
- `POST /chat`: embeds the question, calls the `match_document_chunks` RPC (vector search, top 5), builds a grounded prompt, asks Gemini, and returns an answer with a heuristic confidence label and source previews. Chat history is stored. A hardcoded shortcut answers "how many pages" from metadata.
- `/accuracy-tests`: saves a chat answer with its evidence, generates a "reference answer" with Gemini, runs a Gemini evaluator that returns a judgment, status and confidence, and stores a human review status. Table `accuracy_tests` comes from `migrations/001_create_accuracy_tests.sql`.
- Demo gate: a shared `X-API-Key` header checked on every route. Rate limiting through slowapi. CORS from an env list.

**Frontend** (`frontend/src`): Chat page (upload, document list, chat, source cards) and an Accuracy Testing page (cards, summary). There is no test runner; `npm run lint` is the only check script.

**Tests** (`backend/tests`, 79 test functions, hypothesis property tests plus unit tests): chunker, text cleaner, response utils, auth, accuracy evaluator, accuracy API, save-payload integrity. Not run in this audit.

## Gap list against the pipeline

| # | PRD stage | Status | Notes |
| --- | --- | --- | --- |
| 1 | Parse draft (.docx or paste) | Missing | The app only accepts PDFs. No draft concept and no sections. |
| 2 | Extract claims | Missing | The unit of work is a free-text question, not a claim with a citation. |
| 3 | Resolve reference (Crossref, OpenAlex) | Missing | No reference list, no external lookup. |
| 4 | Find source file | Missing | Chat can scope to one document or all documents; there is no reference-to-PDF matching. |
| 5 | Ingest source | Partial, reusable | `pdf_loader.py`, `text_cleaner.py`, `chunker.py`, `embeddings.py`, upload route. Issues below. |
| 6 | Retrieve passages | Partial | Vector-only top 5. No keyword search, no rank merging. |
| 7 | Judge claim | Partial, different | The accuracy evaluator judges a Q&A answer, not a claim. It returns no quote or chunk id. |
| 8 | Verify quote | Missing | Nothing checks a quote against a chunk, because nothing returns a quote. |
| 9 | Save and log | Partial | Chat messages and accuracy tests are saved. No verdict rows, no events. |
| | Fix this claim | Missing | |
| | Ranked fix list | Missing | |
| | Events (`docs/events.md`) | Missing | No `events` table, no instrumentation. |
| | Eval harness and `evals/claims.csv` | Missing | No `evals/` directory. The accuracy-testing page is manual, one saved answer at a time. |

### The eight verdicts

None of the eight verdicts exist as a type. The nearest thing is the evaluator's judgment enum:

| Evaluator judgment today | Closest verdict | Difference |
| --- | --- | --- |
| `supported_by_source` | Supported | No quote or page is required. |
| `partially_supported` | Partial | |
| `unsupported`, `possible_hallucination` | Contradicted or Not in sources | Contradicted and Not in sources are not separated. |
| `insufficient_evidence`, `missing_information` | Not in sources or Can't tell | Not separated. |
| (none) | Reference not found, Can't check, No citation given | These are pre-judge verdicts, so they need new stages. |

One structural point for the eval: the evaluator compares the answer against a "reference answer" that the same model (`gemini-2.5-flash-lite`) wrote from the same chunks. The judge is therefore not independent of what it judges.

## Hard rules check (CLAUDE.md)

| # | Rule | Status |
| --- | --- | --- |
| 1 | Verdict with a quote must pass quote verification | Not met: no quotes, no verification |
| 2 | Gemini only through one adapter | Not met: three separate `get_gemini_client()` copies (`generator.py`, `accuracy_evaluator.py`, `embeddings.py`); an unused `_generate_with_model` in `generator.py`; model name hardcoded in three places |
| 3 | No AI detection, humanizer or plagiarism check | Met |
| 4 | Delete PDFs after ingestion; delete data after 30 days | Not met: PDFs stay in `uploads/` until the document is deleted; no expiry on anything |
| 5 | Zero-card infrastructure | Unverified: Supabase free tier is used, but PRD v0.3 says the Supabase free slot is gone; Railway is unchecked |
| 6 | No long-running jobs; one short request per claim | Not met: upload parses, embeds and inserts a whole PDF in one request, so a long PDF may exceed a short function limit. The 10 MB cap helps but is not a time bound. |
| 7 | No accounts; a session token identifies the user | Not met: one shared API key, bundled into the browser (`VITE_API_KEY`), and no per-user isolation. `GET /documents` returns every document to every caller. |
| 8 | Fixed sequence of typed stages, no agent framework | No agent framework present, but there are no stages either |
| 9 | Never commit secrets | Appears met: `.env` is git-ignored and `.env.example` holds names only. History not scanned. |
| 10 | Never edit eval labels | Not applicable: no eval labels in the repo |
| 11 | Events carry no draft text or quotes | Not applicable: no events |

## Reusable pieces and their issues

| File | Reuse | Issues to know about |
| --- | --- | --- |
| `rag/pdf_loader.py` | High | Page-by-page text. No OCR, so scanned PDFs give empty pages (the README says so). |
| `rag/text_cleaner.py` | Medium | Collapses all whitespace to single spaces. Quote verification must apply the same normalization, and it does not handle line-break hyphenation or ligatures. |
| `rag/chunker.py` | High | About 500 tokens, 80 overlap, chunks never cross a page, so every chunk has a single exact page. A good fit for page-level evidence. Falls back to a whitespace tokenizer if `tiktoken` cannot load, so chunk sizes differ between environments. |
| `rag/embeddings.py` | High | 768 dimensions, batch of 100, query and document task types. Whether `gemini-embedding-001` is good enough for Bahasa Indonesia is untested; PRD lists this as open. |
| `rag/retriever.py` and the SQL RPC | Low to medium | Vector only. No full-text search and no similarity floor in SQL. IVFFlat with `lists = 100` is more than a small corpus needs. |
| `rag/accuracy_evaluator.py` | Low | Prompt and enum are for Q&A, not claims. The JSON handling (reject malformed output, enforce rules in code) matches the contract style the docs want. |
| `rag/prompts.py`, `response_utils.py` (confidence heuristic), `routes/chat.py` | Low | Specific to the chat product. |
| `tests/` | Medium | Chunker, cleaner and auth tests carry over if the Python code does. The property-test setup (hypothesis, dummy settings in `conftest.py`) is a useful pattern. |

## Defects and risks noticed (read from code, not reproduced)

1. **Orphaned rows and files on upload failure.** The `documents` row is inserted before chunking and embedding. If chunking yields nothing, or embedding or the chunk insert raises, the document row stays with no chunks. Likewise the saved PDF stays on disk if text extraction returns no pages.
2. **Dead code.** `routes/evaluation.py` (221 lines) is never imported or mounted in `main.py`. It targets the old `evaluation_tests` table, which still appears in `docs/supabase-setup.md`.
3. **Stale docs.** `docs/supabase-setup.md` omits `accuracy_tests`, which exists only in `migrations/001_create_accuracy_tests.sql`. It also says "four tables" but names five. README says "Gemini answer generation" without naming the model.
4. **No isolation.** Any holder of the shared key can read, delete or query every document, and the key is visible in the frontend bundle. Acceptable for the current demo gate, in conflict with the PRD's privacy commitments.
5. **PDF kept on disk.** Conflicts with the "delete after ingestion" decision and with hosts that have ephemeral disks.
6. **`CLAUDE.md` "Commands" is empty.** See below.

## Commands (documented in the READMEs, not run here)

The READMEs use PowerShell; these are the macOS equivalents. Treat as unconfirmed until run once.

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env          # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, API_KEY
uvicorn app.main:app --reload  # http://127.0.0.1:8000/docs
pytest                         # no real credentials needed; conftest.py sets dummies

# Frontend
cd frontend
npm install
cp .env.example .env           # VITE_API_URL, VITE_API_KEY
npm run dev                    # http://localhost:5173
npm run lint
npm run build
```

There is no eval command, because there is no eval harness.

## What each path implies (your decision, not made here)

**Rebuild in TypeScript and Next.js per the docs.** Follows CLAUDE.md and `decisions.md` as written (the TypeScript pipeline is still marked "proposed"). The Python RAG code would be a reference only: chunking rules, the 768-dimension embedding setup, and the test ideas get re-implemented. The Vite frontend and FastAPI routes are mostly discarded. Largest rewrite; cleanest fit with the docs and the zero-card host constraint.

**Adapt the Python backend.** Keeps the working ingest, retrieval and test setup, and adds the missing stages as typed Python stages. Needs `decisions.md`, `architecture.md` and CLAUDE.md updated (language, framework, database host), and a host that runs a Python server without a card, since the "short request on a serverless function" assumption was written for Next.js. The frontend would need a real rebuild either way, because it has no draft input, reference list, verdict view or fix list.

**Either way, these are needed and independent of the choice:** the eval set export (`evals/claims.csv`), a single LLM adapter, quote verification, the eight verdicts, the events table, and 30-day and delete-after-ingest retention.

## Open questions for Steven

1. Rebuild or adapt (above)?
2. Is the Supabase free project still available, or is Neon the only database option? PRD v0.3 says the Supabase slot is gone, yet the repo depends on it.
3. Is `gemini-4-hydrogen` reachable from the Python `google-genai` SDK on your key? The code uses `gemini-2.5-flash-lite` today.
4. Should the old chat and accuracy-testing features stay, or be removed once the verifier replaces them?
