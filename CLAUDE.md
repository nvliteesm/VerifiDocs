# VerifiDocs

Check-before-you-send verifier for final-year students who write with AI-supplied references. Portfolio case study (PRD v0.3, 16 Nov 2026), not a business bet yet. Indonesian skripsi is the test market.

## Status

Rebuild in progress as of 17 Nov 2026. The legacy Python/FastAPI and Vite app has been removed from the working tree; it is preserved at the git tag `legacy-rag-chat` (commit `847d49c`) and is the reference for the RAG design only. Built so far: the Next.js scaffold, the Neon schema, the single Gemini adapter, quote normalization, the chunker, embedding helpers, hybrid retrieval, and pipeline stages 1 to 9 as tested library code (the judge, the quote gate, "Fix this claim", verdict saving with strict events, and `checkClaim`, which chains stages 2 to 9 for one claim); the earlier stages (draft parsing including .docx, claim extraction, citation matching and Crossref/OpenAlex lookup, source finding, PDF text extraction with batched all-or-nothing ingest, per-run caching of resolved references, and the `runPrelude` router that chains stages 2 to 4 for one claim). Also built: the API routes (runs, sources, claims, events), the httpOnly session cookie, the origin check, safe error mapping and the ranked fix list, all verified over real HTTP. Also built: the UI (plain React and CSS; fonts through `next/font/google`, self-hosted at build time), rebuilt on 25 Nov 2026 as a three-pane workspace and then restyled to `DESIGN.md` (see the 25 Nov rows in `docs/decisions.md`): a start screen (sources, draft, "Ready to check") and, once a check exists, sources and verdict filters, the draft with verdict underlines, and a review column (claims grouped by verdict above the selected claim). The theme follows the device, with a toggle. Since Amendment A (25 Nov) the check follows the scan by itself when a source is ready, the first issue opens when it ends, Apply fix moves to the next issue, and a done state offers the fixed draft. It keeps the privacy notice, source upload with per-file progress, draft and references input, evidence quotes with file and page, "Apply fix" on an in-memory copy of the draft and "Copy fixed draft", "This verdict is wrong", copy report, the "warming up" banner, and reopening the last check on reload (the draft is then rebuilt from the checked sentences). Checked in a real browser (Chrome via Playwright) with real Gemini: a full check, reload, dark mode, keyboard, 375px width, English and Bahasa Indonesia. Also built by 24 Nov: the two-model judge (the review model re-checks Supported and decides Contradicted vs Partly supported), the number guard, a machine translation under English quotes for Indonesian claims, the eval harness (`evals/`: 51 public claims, all labels approved by Steven, of which E41 to E51 were fresh held-out claims, run once on 25 Nov; `npm run eval`), one more ask when the judge's quote is in no passage, and `reviewSkipped` and `quoteRetried` reports for the eval. Latest full eval (25 Nov, 51 claims x 3 runs, judge `gemini-3.8-flash`): strict 94.8%, lenient 100%, 0 of 63 unsupported checks called Supported, so the 90% bar is met; check time p50 6.0 s, p95 10.2 s. The strict misses (E06, E27, E44) are multi-point claims the judge calls Contradicted where the label is Partly supported. E41 to E51 have now been run once, so they are no longer clean; more tuning needs fresh held-out claims (see the 24 and 25 Nov rows in `docs/decisions.md`). Built on 26 Nov (see the 26 Nov rows in `docs/decisions.md`): coverage-first results (supported, findings, citation, awaiting, general, checking); source discovery from the reference list (states Matched, Possible, Not retrieved; never attaches a low-confidence match silently; Crossref/OpenAlex, open-access PDFs, session-only cache); reference classification, so a thesis, book, law, standard or institution not found online is Can't check ("could not be retrieved automatically") and only a journal-style entry can be Reference not found; identifier mismatch and did-you-mean for citations; own analysis told from external claims by context; a Start here list (top 5) with grouped findings and severity and section filters; real progress stages and the real document title; and "Check my numbers", a separate tool for the student's own paper: figures that disagree between places, findings that "may contradict" (never says which is right), tables read as rows with column headings, results saved with the run (migration 0014) so a reload shows them. The source cap is 60 for everyone for now (was 10). The auto-check waits until all references are processed (progressive checking was decided against). Checked in a real browser on the real paper, including the 1,893 against 1,839 slip and a draft with opposite conclusions. Latest unit run: 1,184 passed, 17 skipped. Not built: a Can't-tell eval case, a whole-draft extraction-recall set, the baselines in `docs/eval.md`, deployment (host not chosen). Deploy prep so far: the Neon `main` branch has migrations 0001 to 0014 applied (0012 to 0014 on 26 Nov; it is empty of user data), and a daily purge endpoint (`GET /api/cron/purge`, needs `CRON_SECRET`, scheduled in `vercel.json`) closes the gap where the 30-day deletion ran only on a visit. Migrate `main` with `node --env-file=.env.local scripts/migrate.ts --allow-main`: `npm run db:migrate` would hit the dev branch. Follow `docs/rebuild-brief.md` for the order of work. If that file conflicts with another doc, the brief wins for the rebuild; tell Steven which doc needs updating.

## What it does

The user adds a draft (paste or .docx), the reference list, and source PDFs. For each claim VerifiDocs returns a verdict with the exact quote and page from the source, a fix list ranked by severity, and a suggested corrected sentence ("Fix this claim") that uses only what the source says.

## Read first

- `docs/rebuild-brief.md`: decisions, order of work, traps, when to stop and ask
- `docs/current-state.md`: audit of the legacy repo and gap list
- `docs/architecture.md`: components, request model, pipeline stages, contracts
- `docs/verdicts.md`: the eight verdicts and what each means
- `docs/eval.md`: eval set, quality bar, how to run it
- `DESIGN.md`: the approved UI spec (tokens, layout, components, banned patterns); follow it for any UI work
- `docs/decisions.md`: settled decisions; do not reopen without asking
- `docs/events.md`: analytics events
- PRD: "VerifiDocs Reboot - PRD" (Claude Docs, v0.3). If the PRD and these docs disagree, ask Steven.

## Stack

TypeScript and Next.js. Neon free Postgres (project `VerifiDocs`, Singapore) with pgvector and Postgres full-text search. Gemini API through one adapter: `gemini-3.8-flash` judges (`GEMINI_MODEL`, with `GEMINI_THINKING_BUDGET=0`, which it needs to stay near 10 s per check; see `docs/decisions.md`, 25 Nov) and `gemini-4-hydrogen` takes a second look at Supported and Partly supported verdicts only (`GEMINI_REVIEW_MODEL`, optional; see `docs/decisions.md`, 24 Nov); embeddings `gemini-embedding-001` at 768 dimensions. Crossref and OpenAlex for reference lookup. Host: Vercel Hobby under consideration, not final. No Python backend.

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
npm run typecheck    # tsc --noEmit (TypeScript 7)
npm run lint         # ESLint with eslint-config-next and jsx-a11y; TypeScript 6 is installed beside 7 for it (see docs/decisions.md)
npm test             # vitest run: unit tests, plus database tests on the Neon dev branch (it loads .env.local, so it always has your keys)
npm run test:ci      # the same, without the env files: what GitHub's CI sees. Run it before pushing
npm run test:live    # opt-in (LIVE=1): real Crossref, OpenAlex and Gemini calls with synthetic text; skipped by npm test
npm run smoke:api    # needs `npm run dev` running: a full check over real HTTP with a real PDF, timing every request; refuses unless NEON_BRANCH=dev and cleans up after itself
npm run db:migrate   # apply db/migrations/*.sql in order; refuses the main branch unless --allow-main
npm run eval         # the eval (docs/eval.md): approved claims in evals/claims.json through the real pipeline, dev branch only
```

Env files, both git-ignored: `.env.local` holds the Neon `main` branch strings and the Gemini key and model names; `.env.development.local` holds the Neon `dev` branch strings and `NEON_BRANCH=dev`, and wins in dev and in tests. `.env.example` lists names only.

- Database tests (`tests/db/`) run only when `NEON_BRANCH=dev` and are skipped otherwise, so they never touch `main`. Each runs in a rolled-back transaction.
- The Neon `dev` branch expires on 1 Dec 2026 (the 7-day policy in `neon.ts`; re-created 24 Nov). Re-create it with `neon checkout dev --create --no-env-pull`, rewrite `.env.development.local` from `neon connection-string dev`, then run `npm run db:migrate`. `--no-env-pull` matters: without it the CLI pulls variables into a local `.env`.
- CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build on every push to main and every pull request. It needs no secrets; the database and live tests skip themselves. The recipe was run from a clean copy with no env files; the workflow itself failed on GitHub from commit 04a86dc until 24 Nov 2026: a live test built the Gemini client while vitest was collecting tests, which throws without keys, and plain `npm test` never showed it because it loads `.env.local`. Fixed, and `npm run test:ci` now reproduces CI's environment (checked on a fresh clone, all four steps pass).
- Component tests (`src/components/*.test.tsx`) run in jsdom with Testing Library. A new `.test.tsx` file needs `// @vitest-environment jsdom` on its first line.
- Not run, so unconfirmed: `npm start` and the CI workflow on GitHub. `npm run eval` was run on 24 Nov (see Status).
- Plain `node` cannot import the `src/` files directly, because the imports have no `.js` or `.ts` extension; use vitest for ad-hoc checks.

## Conventions

- TypeScript strict mode. One pipeline stage per file, each a typed function with a unit test.
- Every stage records an exit reason, so every claim ends with a verdict row.
- One quote-normalization function, used for both stored chunk text and the quote check.
- Ingest is all-or-nothing per PDF.
- Prefer small changes and say what you checked. Ask before adding a dependency.
- Report plainly: what changed, what you ran, what you did not run. Mark anything read from code but not observed.
