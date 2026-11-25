# Web sources: plan

"Search the web" for a claim that Find a source (docs/source-discovery.md) answered with "No paper found". Decided by Steven on 25 Nov 2026: build open-web search with verified quotes, on Tavily, as a second button.

## Why

Find a source searches OpenAlex, which holds research papers. On 25 Nov 2026 all 7 recorded runs on Steven's own draft (a workforce-scheduling app) ended with nothing: 4 were descriptions of products (Deputy, When I Work), 2 were market or work-trend statements, 1 was a technical benefit claim. Academic search cannot hold product pages or industry reports, so on an applied or business draft it finds nothing most of the time. On 16 invented thesis-style claims it found a paper for 14. This plan changes the third rule of the Find a source plan ("no open-web search in this build"); the PRD's guard rule 3 needs matching wording, for Steven to accept.

## Rules

1. Academic search first. "Search the web" is offered only on a card that already says "No paper found", and it is its own request, so each request stays under 10 s (hard rule 6). Doing both in one request would take 12 s or more.
2. The model never writes a URL, a title or a quote. It writes search words and copies one sentence; code checks the sentence is in the text the search service returned (the shared quote check, as for abstracts). A page that does not exist cannot reach the screen.
3. A found page is "not read yet" and counts as nothing until its full text has been checked by the verifier. The verdict quote is verified against the extracted page text (hard rule 1).
4. A web source is labelled as a web page that is not peer reviewed, with its site and the date it was retrieved. The in-text and reference formats are the APA 7 web-page forms.
5. Search words built from the student's sentence go to Tavily. The privacy note says so (as it already does for OpenAlex). Events carry counts only (hard rule 11).
6. One adapter, `src/lib/web/adapter.ts`, is the only path to the service. The key (`TAVILY_API_KEY`) is server-side, sent in a header, never logged or in the browser (hard rules 5, 7). Without a key the feature is off and the button is not shown.
7. A claim checked against a found web page carries the same "Found here: not in your draft yet" tag as a found paper.

## Provider

Tavily: free plan of 1,000 credits a month, no card (its docs). A basic search is 1 credit; extraction is billed per 5 successful pages. Each Find costs 2 searches, so about 500 web searches a month on the free plan. Brave needs a card now and Google's search API is closed to new customers; Exa is possible (no card, about $10 a month in credits, 2 concurrent requests).

Not stated in Tavily's API docs: terms about storing, caching or displaying results. Check its terms before page text is stored (30-day retention) or snippets are shown.

## Phases

0. **Spike, needs the key, no product code.** About 12 claims: product facts, market statements, technical claims, and a few Indonesian ones. Measure how often a usable page comes back, relevance by hand (official page, industry report, or noise), whether the copied sentence passes the quote check, latency, and credits used. Stop and rethink if fewer than half the product and market claims get a relevant page.
1. `src/lib/pipeline/discover-web.ts`: queries, Tavily search, pick and verify against the snippet; tests with fakes. Prompts prefer official and primary pages.
2. Endpoint `POST /api/claims/:id/web-sources`, session scoped and counted against the limits, only for a claim already searched with nothing. Storage: a migration for web sources (kind, url, site, retrieved date; the DOI is not needed).
3. Card: "Search the web" button in the No-paper-found state; results with site, retrieved date and the "Web page, not peer reviewed" tag; copy reference and in-text (APA 7).
4. Attach and check: `extract` the page text, create a document from text, run `checkClaim`; the verdict card says "web page" where it would show a page number.
5. Docs: decisions row, architecture, privacy note, `docs/events.md`, PRD guard rule 3 wording.
6. A small find-a-source eval (research, product and market claims, English and Indonesian), so the strict "direct" rule can be judged by a number.

## Spike result (25 Nov 2026, phase 0)

13 invented claims through Gemini (2 queries), Tavily (2 searches), Gemini (pick, copy one sentence), and the shared quote check against the snippet. 26 searches used.

- **Found a direct page for 11 of 13:** product 4 of 4, technical 3 of 3, Indonesian 2 of 2, market 2 of 3. The own-work sentence found nothing direct (one "related" page, never shown alone): correct. The stop rule (fewer than half of the product and market claims) was not near.
- **Quote check:** 36 sentences checked, 1 was not in its snippet and was dropped by code (97% verified).
- **Time:** 6.6 to 8.9 s per claim for the whole request (two model calls and two searches), under 10 s with little room.
- **Quality, to design for:** many "direct" hits were third-party pages (a compliance blog for a Slack claim, YouTube, Scribd, Medium) while the vendor's own pages were rated "related" because marketing snippets are vague. So rank official and primary domains first, exclude low-quality domains (`exclude_domains`), and show the site name so the student can judge. The e-commerce growth claim got three "related" pages and nothing direct (Bank Indonesia figures through a news site): the "direct" rule is strict here too.
- Not yet tested: checking a claim against full page text (phase 4).

## Tavily terms (read by a subagent on 25 Nov 2026, not by Steven or me; terms updated 4 May 2026, acceptable-use policy 21 Oct 2026)

- **Storing or caching results or extracted text:** not stated. Output is outside the "Services" definition, the licence is for "internal business purposes", and the acceptable-use policy bars automated scraping or indexing except as expressly permitted. A 30-day copy of page text is therefore unclear, not clearly allowed or forbidden.
- **Displaying to students, attribution:** no attribution or branding requirement found. Customers must verify Outputs before relying on them (our quote check fits) and bind end users to terms at least as restrictive as the acceptable-use policy.
- **Training:** Tavily and its AI providers may train on the customer's queries and Output. Search words built from a student's sentence therefore may be used for training; the privacy note must say so.
- **Free plan:** use of the Services "requires purchase of a subscription" in one clause, and a free tier is mentioned; free use can be limited or withdrawn at any time. Limits are on the pricing page, which was not read. Tavily may change the terms at any time.

## Built so far (25 Nov 2026)

- **Phase 1 (done):** `src/lib/pipeline/discover-web.ts` and 12 tests: queries, search, blocked-site filter (video, slide, social and homework sites, sent to the service and checked again), at most two pages per site, pick and verify against the snippet, "related" never alone, a failing search thrown as a failure and never shown as "nothing found". The adapter takes an `excludeDomains` option.
- **Phase 2 (done):** migration 0012 (`claim_web_sources`, `claims.web_searched_at`; applied on the dev branch only, not on `main`), `POST /api/claims/:id/web-sources` (`src/lib/api/web-sources.ts`): only for an uncited claim whose paper search found nothing, once per claim, counted against the model limits, saved result returned on a repeat, 404 when no key is set. Failures: `web_busy` (retried), `web_quota` and `web_unavailable` (not). Event `web_sources_suggested` (counts only). `GET /api/runs/:id` returns `webSearch` (feature on), and per claim `webSearched` and `webSources`. 4 database tests, plus tests for the error codes and the event.
- **Adapter (done):** `src/lib/web/adapter.ts` and 13 tests: search and extract, header-only key, quota/auth/busy/failed reasons, results filtered to http(s) with a title and text, texts capped.
- **Phase 3 (done, 25 Nov):** the "Search the web" button under "No paper found" (shown only when the server has a key), the web card (site and retrieved date, "not read yet, not peer reviewed" note, link out, copy reference and in-text in APA 7 web-page form), English and Indonesian messages including the three error codes, the reducer event, the hook and the run data. Tests: cite, reducer, six card tests. Run for real in headless Chrome (production build, dev database, real Gemini, OpenAlex and Tavily): the answer took 7.3 to 7.6 s, the card survives a reload, keyboard copy works, no overflow at 375 px, contrast 5.9:1 or better in both themes, no console errors. The antislop audit of it is `anti-slop/audit-001-2026-11-25.md`: findings 1 to 4 are fixed and re-checked in the browser (the privacy notice now names Tavily, markdown is stripped from snippets before the model and the quote check, the link arrow stays with the last word, the block titles are headings); finding 5, a native-speaker read of the Indonesian strings, is open.
- **Not done:** phase 4 (extract and check, stores page text, waits for the page-text decision), the PRD wording, the find-a-source eval. The app now has 13 API routes, and Vercel Hobby's possible 12-function cap is still unverified. Migration 0012 is on the dev branch only.

## Open

- Storing extracted page text for the check (phase 4): the terms do not say, see above. Phases 1 to 3 store only the title, address, site and the verified sentence.
- The privacy note must say that Tavily may train on the search words.
- Whether marketing pages are good enough sources for a student to cite; the label says what they are, and the student decides.
- A hard cap on web searches per session beyond the model limits (about 500 a month on the free plan).
