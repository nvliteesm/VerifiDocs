# Find a source: plan

A claim that needs a source gets **Find a source**: up to 3 real papers, each with the sentence from its abstract that relates, and a way to check the claim against one of them. Decided by Steven on 18 Nov 2026: search first, the label "Possible sources (not read yet: open one and check it before you cite it)", and phases 1 and 2 built together. Nothing is built yet.

## Rules (from the PRD's Source discovery section, plus this plan)

1. A found paper is "not read yet" and never counts as support until its full text has been checked by the verifier (PRD guard rule 1).
2. A claim checked against a paper the student found here is marked "Source added after writing", on screen and in the copied report (PRD guard rule 2, the audit trail).
3. Open-access academic search first (OpenAlex); no open-web search in this build (PRD guard rule 3).
4. The model never writes a title, author or DOI. It writes search words and copies one sentence from an abstract; code checks that sentence appears in the abstract. A reference that does not exist cannot reach the screen.
5. Nothing is written into the student's draft. Events carry counts only (hard rule 11). Each request stays short (hard rule 6).

The PRD says "Gemini suggests candidate sources from a topic prompt". This plan changes that to search first; the PRD's Source discovery section needs that wording updated.

## Phase 1: find

| Step | What happens | By |
|---|---|---|
| 1 | Claim to 1 or 2 search queries in the claim's language, plus an English one for an Indonesian claim | Gemini, through the adapter |
| 2 | OpenAlex works search per query, works with an abstract only, about 5 each | OpenAlex |
| 3 | From up to 8 abstracts, pick up to 3 and copy the one sentence that relates to the claim | Gemini |
| 4 | Keep a pick only if its sentence is in the abstract (the shared quote check) | Code |

- Stage: `src/lib/pipeline/discover-sources.ts`, one typed function with an exit reason, unit-tested with a fake model and fetch. Reuses the deadline fetch and generic `User-Agent` from `resolve-reference.ts`.
- API: `POST /api/claims/:id/sources`. Session-scoped, counted against the model limits, only for claims with no citation. Target under 8 s (about 2 s + 1.5 s + 2.5 s).
- Storage: migration 0009, table `claim_sources` (claim id, DOI, title, year, authors, venue, open-access PDF URL, abstract sentence, rank, found at). It cascades with the claim, so the 30-day deletion holds, and it survives a reload.
- Card: Open (the DOI), Copy reference (APA 7, built from the stored fields), Copy in-text ("(Lee & Tan, 2021)"). Empty state: "No paper found. A product or company fact is best cited from its official page."
- Events: `sources_suggested` (count, latency_ms), `source_copied` (kind: reference or in_text), `source_attached` (how: open_access or upload).

## Phase 2: check the claim against a found paper

1. **Get the full text.** If OpenAlex lists an open-access PDF, the server fetches it under these rules:
   - https only, with no address on a private or local network (checked after DNS)
   - redirects followed by hand (at most 3), each one checked again
   - `application/pdf` and the `%PDF-` header required
   - 10 MB cap, 8 s timeout
   - the PDF itself is never stored (hard rule 4)

   Otherwise, or when the fetch fails, the card asks the student to upload the PDF. Both paths create a document through `createDocumentFromPdf` and ingest in the existing 10-page batches the browser drives.
2. **Attach.** In one transaction:
   - add the paper to the run's reference list as an entry linked to that document
   - set the claim's citation to the in-text marker with `citation_source = 'found'` (migration 0009)
   - delete the claim's early "No citation" verdict, since `saveVerdict` keeps the first verdict and would otherwise refuse the new one
   - reopen the run for the check
3. **Check.** The existing check (`checkClaim`) runs for that claim: retrieval, judge, quote gate. The verdict shows with its quote and page, plus the "Source added after writing" tag.

## Order of work

0. **Spike, about 2 hours, no product code.** On 10 real claims (5 from the FYP draft, 5 Indonesian skripsi claims), check:
   - whether OpenAlex needs a free API key now, and its rate limits
   - what share of results have an abstract
   - the top-3 hit rate
   - how well Indonesian journals are covered
   - what share of open-access PDF links really return a PDF

   Stop and rethink if fewer than half the claims get one relevant paper in the top 3.
1. Stage `discover-sources.ts` and its tests. **Done 18 Nov 2026.** Unit tests: 14. Live check (`tests/live/discover.live.test.ts`, `LIVE=1` with a key): 5 of 5, twice. Two rules came out of the live check:
   - A "related" paper is shown only next to a "direct" one, never on its own.
   - A claim about a named product, company or organisation is "direct" only if the abstract names it.

   Together they turned the pricing-plan and Deputy claims into an empty answer. Not solved here: the student's own feature ("Admins can create tasks…") finds task-management papers rated "direct". Keeping such sentences out is the extraction step's `own_work` label.
2. Migration 0009, the find endpoint, rate limit, events; database tests on the dev branch. **Done 18 Nov 2026.**
   - `claim_sources` (up to 3 papers per claim, deleted with the claim) and `claims.sources_searched_at` (migration 0009, applied on the dev branch only).
   - `POST /api/claims/:id/sources` (`src/lib/api/sources-found.ts`):
     - only for a No citation claim, scoped to the session, counted against the model rate limit
     - a repeat press returns the saved result with no search
     - a failed search answers 503 with a retry hint and saves nothing
   - `GET /api/runs/:id` returns each claim's `sourcesSearched` and `sources`. The new event is `sources_suggested` (`count`, `latency_ms`, `outcome`).
   - Tests: 4 database tests. One real-HTTP run on the dev server: 3 direct papers in 5.8 s, the repeat in 0.3 s.
   - The `citation_source` column planned for phase 2 moves to a later migration with step 5.
3. Card UI (load antislop first): loading, empty, error and result states, focus, 375 px, English and Indonesian. **Done 18 Nov 2026.**
   - A No citation card has **Find a source**. While it searches the button reads "Searching for papers…"; on an error the card shows the message and the button again.
   - Found papers sit under "Possible sources", with the note "Not read yet: open one and check it before you cite it." just above them.
   - Each paper shows its title linking to the DOI (new tab, announced to screen readers), authors · year · venue, the abstract sentence (cut at about 240 characters), a "Same topic, not your exact claim" tag for a related paper, Copy reference (APA 7) and Copy in-text.
   - Nothing found: "No paper found. A product or company fact is best cited from its official page."
   - Focus moves to the answer when the button leaves.
   - New client event `source_copied` (`kind` only). APA formatting is in `src/lib/client/cite.ts`, with tests.
   - Checked in a real browser with real Gemini and OpenAlex:
     - 3 papers in 3.9 to 5.4 s, and the copied in-text "(Maes, 2024)"
     - the papers come back after a reload
     - phone width with no overflow, dark mode (contrast about 14 to 1), and no console errors
   - Not seen in a browser: the "no paper found" line and the error state (component tests only), and the Indonesian wording (not read by a native speaker).
4. The safe PDF fetcher and its tests (private addresses, redirects, size, type).
5. Attach and re-check, the "Source added after writing" tag on screen and in the report; database tests.
6. Live test and a real-browser run on the FYP draft, timing every request.
7. `docs/decisions.md`, `docs/architecture.md`, the privacy note (search words built from the student's sentence go to OpenAlex), and the PRD wording.

## Spike results (18 Nov 2026, first pass)

10 claims: 5 "needs a source" claims from the FYP scan, 5 Indonesian skripsi-style claims. Gemini through the adapter; OpenAlex with no key.

- **OpenAlex without a key is not usable.** Searches cost credits: $0.001 each against a free $0.10 a day shared by everyone on the caller's IP address. Under load, keyless search is refused outright: 14 of 20 searches got HTTP 429, "Anonymous search is temporarily rate-limited… retry in 35s, or use a free API key". A free key ($1 a day, about 1,000 searches, no card) needs an email address to register, so Steven has to register it himself. The key would be a secret in `.env.local`, listed by name only in `.env.example`.
- **When the search ran, it worked.** 4 claims got results.
  - Stunting: the top pick quotes "The 2022 Indonesian Nutrition Status Survey reported that the prevalence of stunting in Indonesia reached 21.6%."
  - UMKM: picks say 59.74% (2012 to 2017) and "around 61%", which also shows that the claim's "more than 60 percent" is shaky.
  - Social media use: 3 relevant Indonesian-language papers.
  - The FYP's product-comparison claim: unrelated papers (school timetabling), as expected for a product fact.

  That's 3 of the 4 claims that were searched, and 6 claims could not be measured because of the 429s.
- **Every copied sentence was really in its abstract:** 12 of 12 picks passed the quote check.
- **Time:** 2.9 to 4.7 s per claim (queries about 0.75 s, search 1.2 to 2.9 s, picking about 1 s), well under the 10 s rule.
- **Open-access full text:** 6 of 12 picks had a link that returned a real PDF. The other 6 gave a web page, a 404, a 523, a timeout, or had no link. So phase 2 needs the upload path for about half the papers.
- **Indonesian coverage:** Indonesian journals are indexed (for example *Jurnal Riset Akuntansi*, *PREPOTIF*); the Indonesian query for the social-media claim returned 4 of 5 Indonesian-language papers.
- **Prompt fix needed:** for an English claim, one query came back in French. The real prompt must name the second language (English for an Indonesian claim) instead of "if it is not English".

Gate: not passed and not failed after the first pass.

### Second pass, with a free OpenAlex key (18 Nov 2026)

20 claims: the same 10 plus 5 more Indonesian skripsi-style claims and 5 English research claims. The second query's language is now named in the prompt (English for an Indonesian claim). Relevance was judged by hand from titles and the quoted sentences.

| Set | Relevant paper in top 3 |
|---|---|
| Indonesian skripsi claims (10) | 10 of 10 (one weak: the poverty-rate claim found a BPS 2023 profile paper without the 9.36% figure) |
| English research claims (5) | 5 of 5 |
| FYP claims (5: product facts and one own-work sentence) | 0 of 5, as expected |

- **The gate passes.** 15 of 15 research claims and 15 of 20 overall got a relevant paper in the top 3 (the bar was half).
- **All 40 searches answered 200** with the key. Each find costs 2 searches, about $0.002, so the free $1 a day allows about 500 finds.
- **Copied sentences:** 52 of 54 were in their abstracts. The quote check dropped the other 2, as designed.
- **Time:** median 3.1 s per claim, slowest 6.8 s.
- **Open-access PDF really downloadable:** 23 of 54 (43%). The upload path is needed for most papers.
- **Problem to fix before building: picks with nothing behind them.** Despite "pick none if none relate", the model always picked something. It matched an AI-agent benchmark to the FYP's pricing-plan sentence, and a bKash payroll paper to the Deputy claim. The pick step must also return a relevance level (`direct`, `related`, `none`), and code shows only `direct` and `related`, so a product fact ends in the honest empty state. This needs its own test cases (the 5 FYP claims, which should all come back empty).

The key is `OPENALEX_API_KEY` in `.env.local` (listed by name in `.env.example`). It is sent as the `api_key` query parameter, so it must never be logged with the URL.

## How we know it works

- Eval set: 20 claims (10 English, 10 Indonesian), each with a known supporting paper. Targets:
  - the right paper in the top 3 for at least 50% of claims
  - 0 non-existent references
  - 95% of find requests under 10 s
- In use: the share of searches that end in a copy or an attach, the share that find nothing, and how often an attached paper ends Supported.

## Known limits and open questions

- Claims about products and companies (much of the FYP draft's "needs a source") are not in academic databases.
- Many open-access PDF links lead to a web page, not a PDF; the spike measures how many, and the upload path covers the rest.
- Not decided: a cap on finds per draft beyond the model limits, and whether "Find sources for all" comes later.
