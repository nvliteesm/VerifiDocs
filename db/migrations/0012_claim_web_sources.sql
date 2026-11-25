-- 0012_claim_web_sources: web pages found for an uncited claim by "Search the web" (docs/web-sources.md, phase 2),
-- after "Find a source" found no paper. Each row is a page the search service returned, with one sentence verified to
-- be in its snippet. A found page is "not read yet" and never counts as support. Only the title, address, site, the
-- sentence and the retrieved date are kept: no page text (the search service's terms do not say whether storing its
-- extracted text is allowed, so that stays undecided). Rows go with the claim (on delete cascade), so the 30-day
-- deletion of runs removes them too.
-- claims.web_searched_at: when the web search last ran for the claim, so "no page found" survives a reload and a
-- second press makes no new model or search call.

create table claim_web_sources (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references claims(id) on delete cascade,
  session_id   uuid not null references sessions(id) on delete cascade,
  rank         smallint not null check (rank between 1 and 3),
  url          text not null,
  site         text not null,
  title        text not null,
  sentence     text not null,
  relevance    text not null check (relevance in ('direct', 'related')),
  retrieved_at timestamptz not null default now(),
  unique (claim_id, rank)
);
create index claim_web_sources_session_idx on claim_web_sources (session_id);

alter table claims add column web_searched_at timestamptz;
