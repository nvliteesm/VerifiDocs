# Eval

Status: the eval harness does not exist yet (no `evals/` directory). Building it is not part of the first rebuild session (see `docs/rebuild-brief.md`).

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
- Do not edit labels without asking Steven. Three labels were changed in the Sheet during review: B04 to Partial, and B19 and C03 to Not in sources (see the Sheet's notes column).

## Models

The product starts on `gemini-2.5-flash-lite` (the model name is an env var). `gemini-4-hydrogen` is tested later in this eval as a comparison; this replaces the 15 Nov decision to pin Hydrogen for the product and the baseline (see `docs/decisions.md`). Embedding model choice for Bahasa Indonesia and English, and the full-context vs RAG comparison, are decided here later; the rebuild starts on `gemini-embedding-001`.

## Baselines

Run the same claims against:

1. The same Gemini model as the product, alone, with the whole source in context (no retrieval). Repeat on `gemini-4-hydrogen` when that comparison is run.
2. NotebookLM
3. The CekSitasi free tier (3 free checks per the earlier recon, unverified)

Record correct-verdict rate and missed-unsupported rate for each, next to VerifiDocs. A full-context vs retrieval comparison is also worth running: it shows whether retrieval earns its place.

## Running it

Fill in once the harness exists: command, output location, and where results are logged. The harness must call the same pipeline code as the app, through the same Gemini adapter.

## Rules

- Never tune prompts against a label you have seen the answer to without recording it. Keep a held-out slice of the claims for the final score.
- Report failures by verdict type, not only the overall percentage.
- With only 35 non-Supported claims, the 5% bar allows one miss. Treat early results as indicative.
