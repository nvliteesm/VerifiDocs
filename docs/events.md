# Analytics events

One row per event in the `events` table: `session_id`, `name`, `props` (JSON), `created_at`. Events carry ids, counts and buckets only. Never log draft text, quotes or reference text. This is enforced in code: `src/lib/events.ts` gives every event below a strict schema (unexpected keys are rejected; strings are only enumerated values or short lowercase tokens), and `logEvent` is the only way to write one. Events are not deleted after 30 days (see `docs/decisions.md`).

| Event | When | Props |
| --- | --- | --- |
| `session_started` | First request of a session | `source` (direct, referral) |
| `draft_submitted` | Draft accepted | `input_type` (paste, docx), `length_bucket` |
| `references_added` | Reference list accepted | `count` |
| `source_uploaded` | A PDF is ingested | `page_bucket`, `ingest_ms` |
| `run_started` | Claims extracted | `claim_count` |
| `claim_checked` | A claim reaches a verdict | `verdict`, `exit_stage`, `latency_ms`, `retries` |
| `run_completed` | All claims have verdicts | `duration_ms`, `verdict_counts` |
| `evidence_opened` | User opens a quote and page | `verdict` |
| `verdict_flagged_wrong` | "This verdict is wrong" pressed | `verdict` |
| `fix_suggested` | Fix this claim shown | `verdict` |
| `fix_accepted` | User applies the suggested sentence | none |
| `recheck_started` | User re-runs after editing | `claims_rechecked` |
| `report_exported` | Report downloaded or copied | `format` |
| `would_pay_answered` | Beta prompt answered | `answer` (yes, maybe, no), `price_bucket` |
| `feature_interest_answered` | Optional beta question about a feature not built | `feature`, `answer` |

## What each metric needs

- **Correct verdict rate (live):** `verdict_flagged_wrong` over `claim_checked`.
- **Fix loop:** `run_completed`, then `recheck_started`, then a lower count of open verdicts.
- **Reference-not-found rate:** `claim_checked` where `verdict` is `reference_not_found`.
- **Willingness to pay:** `would_pay_answered`.
