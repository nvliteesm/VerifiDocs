# VerifiDocs

A check-before-you-send verifier for final-year students who write with AI-supplied references. For each claim in a draft it returns a verdict with the exact quote and page from the source, a ranked fix list, and a suggested corrected sentence that uses only what the source says.

Portfolio case study (PRD v0.3). Indonesian skripsi is the test market. It is a self-check, not an AI-writing detector or a grader.

**Status: rebuild in progress.** The verifier pipeline is not built yet. The previous app (a general PDF chat tool in Python and React) is preserved at the git tag `legacy-rag-chat`.

## Stack

TypeScript, Next.js, Neon Postgres with pgvector, Gemini (through one adapter), Crossref and OpenAlex.

## Docs

Start with `CLAUDE.md`, then `docs/rebuild-brief.md`. Design lives in `docs/architecture.md`, `docs/verdicts.md`, `docs/decisions.md`, `docs/eval.md` and `docs/events.md`. `docs/current-state.md` audits the legacy app.

## Demo documents

`demo-documents/` holds two fictional text files for trying the app. They contain no real or confidential information.

## Commands

See the Commands section of `CLAUDE.md`.
