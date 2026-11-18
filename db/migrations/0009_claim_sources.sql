-- 0009_claim_sources: papers found for an uncited claim by "Find a source" (docs/source-discovery.md, phase 1).
-- Each row is a real work returned by OpenAlex, with one sentence verified to be in its abstract. A found paper is
-- "not read yet": it never counts as support (PRD guard rule 1). Rows go with the claim (on delete cascade), so the
-- 30-day deletion of runs removes them too.
-- claims.sources_searched_at: when the search last ran for the claim, so "no paper found" survives a reload and a
-- second press makes no new model call.

create table claim_sources (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null references claims(id) on delete cascade,
  session_id      uuid not null references sessions(id) on delete cascade,
  rank            smallint not null check (rank between 1 and 3),
  openalex_id     text not null,
  doi             text,
  title           text not null,
  year            smallint,
  authors         text[] not null default '{}',
  venue           text,
  open_access_pdf text,
  sentence        text not null,
  relevance       text not null check (relevance in ('direct', 'related')),
  found_at        timestamptz not null default now(),
  unique (claim_id, rank)
);
create index claim_sources_session_idx on claim_sources (session_id);

alter table claims add column sources_searched_at timestamptz;
