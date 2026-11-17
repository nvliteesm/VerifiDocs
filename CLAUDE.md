# VerifiDocs

Check-before-you-send verifier for final-year students who write with AI-supplied references. Portfolio case study (PRD v0.3, 16 Nov 2026), not a business bet yet. Indonesian skripsi is the test market.

## Status

Rebuild in progress as of 17 Nov 2026. The legacy Python/FastAPI and Vite app has been removed from the working tree; it is preserved at the git tag `legacy-rag-chat` (commit `847d49c`) and is the reference for the RAG design only. Built so far: the Next.js scaffold, the Neon schema, the single Gemini adapter, quote normalization, the chunker, embedding helpers, hybrid retrieval, and pipeline stages 1 to 9 as tested library code (the judge, the quote gate, "Fix this claim", verdict saving with strict events, and `checkClaim`, which chains stages 2 to 9 for one claim); the earlier stages (draft parsing including .docx, claim extraction, citation matching and Crossref/OpenAlex lookup, source finding, PDF text extraction with batched all-or-nothing ingest, per-run caching of resolved references, and the `runPrelude` router that chains stages 2 to 4 for one claim). Also built: the API routes (runs, sources, claims, events), the httpOnly session cookie, the origin check, safe error mapping and the ranked fix list, all verified over real HTTP. Not built: the UI, the eval harness, deployment (host not chosen). Follow `docs/rebuild-brief.md` for the order of work. If that file conflicts with another doc, the brief wins for the rebuild; tell Steven which doc needs updating.

## What it does

The user adds a draft (paste or .docx), the reference list, and source PDFs. For each claim VerifiDocs returns a verdict with the exact quote and page from the source, a fix list ranked by severity, and a suggested corrected sentence ("Fix this claim") that uses only what the source says.

## Read first

- `docs/rebuild-brief.md`: decisions, order of work, traps, when to stop and ask
- `docs/current-state.md`: audit of the legacy repo and gap list
- `docs/architecture.md`: components, request model, pipeline stages, contracts
- `docs/verdicts.md`: the eight verdicts and what each means
- `docs/eval.md`: eval set, quality bar, how to run it
- `docs/decisions.md`: settled decisions; do not reopen without asking
- `docs/events.md`: analytics events
- PRD: "VerifiDocs Reboot - PRD" (Claude Docs, v0.3). If the PRD and these docs disagree, ask Steven.

## Stack

TypeScript and Next.js. Neon free Postgres (project `VerifiDocs`, Singapore) with pgvector and Postgres full-text search. Gemini API through one adapter, starting on `gemini-2.5-flash-lite` (model name in an env var; `gemini-4-hydrogen` is tested later in the eval); embeddings `gemini-embedding-001` at 768 dimensions. Crossref and OpenAlex for reference lookup. Host: Vercel Hobby under consideration, not final. No Python backend.

Neon credentials live in the git-ignored `.env.local`. Never print them.

## Hard rules

1. A verdict that cites a quote must pass quote verification (the quote appears in a retrieved passage) before it is saved. If it fails, the verdict is Can't tell.
2. Call Gemini only through the single LLM adapter, so the product and the eval baseline use the same path. No second client and no hardcoded model name.
3. Do not build AI-writing detection, a text humanizer, or plagiarism checking. Positioning is a self-check.
4. Delete original PDFs after ingestion. Delete drafts, page text and chunks 30 days after upload.
5. Zero-card infrastructure: nothing may require a payment method.
6. No long-running jobs. Each claim check is one short request the browser triggers. Aim for under 10 seconds per request.
7. No accounts in v1. A session token identifies the user, and all reads and deletes are scoped to it. No shared API key in the browser bundle.
8. The pipeline is a fixed sequence of typed stages. No agent framework.
9. Never commit secrets. `.env.example` lists names only.
10. Never edit eval labels without asking Steven.
11. Analytics events carry ids, counts and buckets, never draft text, quotes or reference text.

## Commands

Run on 17 Nov 2026 with Node 24 (the scripts rely on `node --env-file-if-exists` and built-in TypeScript type stripping, so older Node versions may not work). Each of these was run and worked:

```bash
npm run dev          # Next.js dev server on http://localhost:3000 (GET / returned 200)
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm test             # vitest run: unit tests, plus database tests on the Neon dev branch
npm run test:live    # opt-in (LIVE=1): real Crossref, OpenAlex and Gemini calls with synthetic text; skipped by npm test
npm run smoke:api    # needs `npm run dev` running: a full check over real HTTP with a real PDF, timing every request; refuses unless NEON_BRANCH=dev and cleans up after itself
npm run db:migrate   # apply db/migrations/*.sql in order; refuses the main branch unless --allow-main
```

Env files, both git-ignored: `.env.local` holds the Neon `main` branch strings and the Gemini key and model names; `.env.development.local` holds the Neon `dev` branch strings and `NEON_BRANCH=dev`, and wins in dev and in tests. `.env.example` lists names only.

- Database tests (`tests/db/`) run only when `NEON_BRANCH=dev` and are skipped otherwise, so they never touch `main`. Each runs in a rolled-back transaction.
- The Neon `dev` branch expires on 24 Nov 2026 (the 7-day policy in `neon.ts`). Re-create it with `neon checkout dev --create --no-env-pull`, rewrite `.env.development.local` from `neon connection-string dev`, then run `npm run db:migrate`. `--no-env-pull` matters: without it the CLI pulls variables into a local `.env`.
- Not run, so unconfirmed: `npm start`, any lint command (none is set up), and any eval command (there is no eval harness yet).
- Plain `node` cannot import the `src/` files directly, because the imports have no `.js` or `.ts` extension; use vitest for ad-hoc checks.

## Conventions

- TypeScript strict mode. One pipeline stage per file, each a typed function with a unit test.
- Every stage records an exit reason, so every claim ends with a verdict row.
- One quote-normalization function, used for both stored chunk text and the quote check.
- Ingest is all-or-nothing per PDF.
- Prefer small changes and say what you checked. Ask before adding a dependency.
- Report plainly: what changed, what you ran, what you did not run. Mark anything read from code but not observed.
