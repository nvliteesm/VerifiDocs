# Eval

Status (24 Nov 2026): the harness exists (`npm run eval`, `evals/run.eval.ts`) with a public set of 40 claims whose labels are **proposed, not yet approved**. Steven's Sheet set below joins once it is exported with its PDFs.

## Quality bar

The product is released to users only when, on the labelled eval set, it reaches:

- at least 90% correct verdicts
- at most 5% missed unsupported claims

Treat an unsupported claim as one labelled Partial, Contradicted or Not in sources, and a miss as the tool marking it Supported. Confirm this definition against the PRD before relying on it.

## Eval set

- Source of truth: the Google Sheet "VerifiDocs - Upgrade Research", tab Eval Claims (50 labelled claims).
- Steven exports it to `evals/claims.csv` so this repo has its own copy. Claude Code cannot read the Sheet.
- Suggested columns: `id`, `claim`, `source_file`, `language`, `expected_verdict`, `expected_quote`, `expected_page`, `notes`.
- Quote and page columns are still empty in the Sheet, because the source PDFs have not been matched to rows yet.
- To build: about 10 claims in Bahasa Indonesia, and Reference-not-found, Can't check and No citation given cases. The 50 existing claims do not cover those verdicts.
- To build: a small set of whole drafts (English and Bahasa Indonesia) in which every factual claim is labelled, to measure **extraction recall** (stage 2). The 50 claims are already extracted, so they cannot show a claim the extractor never surfaces. A live check on 17 Nov missed one plain uncited claim out of five. Report recall next to verdict accuracy, keep a held-out slice, and do not tune the extraction prompt on the held-out drafts.
- Do not edit labels without asking Steven. Three labels were changed in the Sheet during review: B04 to Partial, and B19 and C03 to Not in sources (see the Sheet's notes column).

## Models

The product starts on `gemini-2.5-flash-lite` (the model name is an env var). `gemini-4-hydrogen` is tested later in this eval as a comparison; this replaces the 15 Nov decision to pin Hydrogen for the product and the baseline (see `docs/decisions.md`). Embedding model choice for Bahasa Indonesia and English, and the full-context vs RAG comparison, are decided here later; the rebuild starts on `gemini-embedding-001`.

## Baselines

Run the same claims against:

1. The same Gemini model as the product, alone, with the whole source in context (no retrieval). Repeat on `gemini-4-hydrogen` when that comparison is run.
2. NotebookLM
3. The CekSitasi free tier (3 free checks per the earlier recon, unverified)

Record correct-verdict rate and missed-unsupported rate for each, next to VerifiDocs. A full-context vs retrieval comparison is also worth running: it shows whether retrieval earns its place.

## Public set (24 Nov 2026)

Built because the Sheet's rows have no matched PDFs yet, and to cover what the Sheet lacks: Bahasa Indonesia and every pre-judge verdict.

- `evals/claims.json`: 40 claims, 20 English and 20 Bahasa Indonesia. Expected: 18 Supported, 9 Contradicted, 3 Partial, 3 Not in sources, 3 Reference not found, 2 Can't check, 2 No citation given. No Can't tell case yet (a garbled or scanned source is still to be added).
- Each claim has the expected quote and page (checked against an independent text extraction, pypdf), `also_acceptable` where the definitions allow two verdicts, `split` (10 held out, 5 per language, none seen in tuning), `seen_in_tuning` (claims from the 23 Nov UAT that prompts were tuned against), and `status`.
- `evals/bibliography.json`: one reference list of 15 entries for every claim, as in a real draft: 11 uploaded papers, 2 real papers deliberately not uploaded (Can't check), 2 invented entries (Reference not found; both confirmed absent from Crossref and OpenAlex on 24 Nov).
- `evals/sources.json`: 11 open-access PDFs (10 arXiv papers pinned to a version, and one CC BY 4.0 paper in Scientific Reports) with SHA-256 checksums. The PDFs are not committed; the harness downloads them into the git-ignored `evals/.cache/`.

**Approval (hard rule 10).** Steven reviews every label on the review page (a private claude.ai artifact, https://claude.ai/artifact/KJ2WNXMoXzFm1CY4CTABbs) and marks it Agree or Change. Claude Code then reads his marks and sets `status: "approved"` (with his verdict and alternatives where he changed one) in `claims.json`. No label is approved any other way.

## Running it

```bash
npm run eval                                  # every approved claim, 3 runs, on the Neon dev branch
EVAL_ONLY=E01,E05 EVAL_RUNS=1 npm run eval    # a few claims, one run
EVAL_INCLUDE_PROPOSED=1 npm run eval          # also score unapproved labels: the report says PREVIEW
```

- It refuses to run unless `NEON_BRANCH=dev`, creates its own sessions, and deletes them (and their events) when it ends, even after a failure.
- Each claim goes through `checkClaim`, the same code and Gemini adapter as the app, with real Crossref and OpenAlex lookups; sources are read with the app's own ingest. Sources are split into sessions of at most 10 PDFs (the app's limit); each claim runs in the session that holds its cited PDF.
- Output: `evals/results/<date>-<model>.md` and `.json`: strict and lenient correctness against the bar, missed unsupported claims, results by expected verdict, split and language, retrieval hits (is the expected passage in the top 5), the claims whose verdict changed between runs, and check times.
- Scoring is `evals/score.ts`, unit tested in `npm test` (`evals/score.test.ts`). The run itself is never part of `npm test` or CI.
- A 6-claim smoke run on 24 Nov (preview, labels unapproved) worked end to end: every check finished, p95 8.4 s, 3 of 3 retrieval hits.

## Rules

- Never tune prompts against a label you have seen the answer to without recording it. Keep a held-out slice of the claims for the final score.
- Report failures by verdict type, not only the overall percentage.
- Measure retrieval, not only verdicts: for each labelled claim, is the passage with the expected quote in the top 5? A claim called Not in sources only because retrieval missed the evidence is the worst failure this tool can produce, and it looks like a correct "abstain" unless retrieval is measured separately. Add a "retrieval hit" column.
- Measure stability: run each claim several times (at least 3) and report how often the verdict changes. On 17 Nov one claim changed verdict across live runs (see `docs/architecture.md`).
- Include table and scanned-source cases. A judge said Supported for a wrong claim read from a garbled table, and only the quote check stopped it.
- With only 35 non-Supported claims, the 5% bar allows one miss. Treat early results as indicative.
