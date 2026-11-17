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

## Why some things are out

- **Humanizer and AI detection:** they contradict the self-check positioning, detectors are unreliable, and they would attract users who do not use the checker. Demand can be probed with a question in the beta's "would you pay?" prompt.
- **Firebase:** Cloud Functions need the Blaze plan, and Blaze needs a payment method (Firebase pricing page, checked 17 Nov). Cloud Storage is listed with a no-cost Spark quota on that page, although a community source says it now needs Blaze, so that point is unresolved. Firestore also has no built-in keyword search. Neon was chosen mainly because it keeps Postgres, pgvector and full-text search with no card.
- **Python backend:** the legacy app was FastAPI and Supabase. The rebuild is one TypeScript codebase. The Python RAG code is a reference only (tag `legacy-rag-chat`).
