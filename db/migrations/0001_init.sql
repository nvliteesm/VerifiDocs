-- 0001_init: core schema for the VerifiDocs verifier.
-- Design: docs/architecture.md. Retention: drafts, page text and chunks expire 30 days after creation.

create extension if not exists vector;

-- A session identifies a user. There are no accounts. Only a hash of the token is stored.
create table sessions (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- One run = one check of one draft. A re-check after edits is a new run.
create table runs (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  draft_text   text not null,
  input_type   text not null check (input_type in ('paste', 'docx')),
  status       text not null default 'extracting'
               check (status in ('extracting', 'checking', 'completed', 'failed')),
  claim_count  integer not null default 0,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  expires_at   timestamptz not null default now() + interval '30 days'
);
create index runs_session_idx on runs (session_id);
create index runs_expires_idx on runs (expires_at);

-- Source PDFs. The PDF file itself is never stored; only page text and chunks are kept.
-- Ingest is all-or-nothing: a document is 'ingesting' until every batch has been saved, then one
-- update makes it 'ready'. On failure the row is deleted (cascading to pages and chunks).
-- Retrieval must only read documents whose status is 'ready'.
create table documents (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions(id) on delete cascade,
  filename       text not null,
  page_count     integer,
  pages_ingested integer not null default 0,
  status         text not null default 'ingesting'
                 check (status in ('ingesting', 'ready', 'no_text', 'failed')),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '30 days'
);
create index documents_session_idx on documents (session_id);
create index documents_expires_idx on documents (expires_at);

create table pages (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  text        text not null,
  unique (document_id, page_number)
);

-- Chunks never cross a page, so each has exactly one page number.
-- 768 dimensions matches gemini-embedding-001 at output_dimensionality 768.
-- No vector index yet: the corpus is small, so an exact scan is fine. Add one only if the eval needs it.
-- The full-text config is 'simple' (no stemming) because the text mixes English and Bahasa Indonesia.
create table chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  page_number integer not null check (page_number >= 1),
  content     text not null,
  embedding   vector(768) not null,
  fts         tsvector generated always as (to_tsvector('simple', content)) stored,
  unique (document_id, chunk_index)
);
create index chunks_document_idx on chunks (document_id);
create index chunks_fts_idx on chunks using gin (fts);

-- Entries of the student's reference list. ("references" is a reserved word in SQL.)
create table reference_entries (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references runs(id) on delete cascade,
  session_id     uuid not null references sessions(id) on delete cascade,
  raw_text       text not null,
  resolution     text not null default 'pending' check (resolution in ('pending', 'found', 'not_found')),
  resolver       text check (resolver in ('crossref', 'openalex')),
  resolved_doi   text,
  resolved_title text,
  document_id    uuid references documents(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index reference_entries_run_idx on reference_entries (run_id);

create table claims (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references runs(id) on delete cascade,
  session_id    uuid not null references sessions(id) on delete cascade,
  position      integer not null,
  text          text not null,
  citation_text text,
  reference_id  uuid references reference_entries(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'checking', 'done')),
  attempts      integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (run_id, position)
);
create index claims_session_idx on claims (session_id);

-- Exactly one verdict per claim, so a claim check can be retried safely (upsert).
-- Evidence rules from docs/verdicts.md are enforced here, not only in code:
--   * Supported needs a quote and a page.
--   * Only a verified verdict (supported, partial, contradicted) may carry a quote. A quote that
--     failed verification is never stored; the verdict becomes cant_tell instead.
--   * A fix suggestion exists only for partial and contradicted.
-- chunk_id is a plain uuid with no foreign key, because the quote and page are stored here and
-- must survive even if the chunk is removed.
create table verdicts (
  id             uuid primary key default gen_random_uuid(),
  claim_id       uuid not null unique references claims(id) on delete cascade,
  session_id     uuid not null references sessions(id) on delete cascade,
  verdict        text not null check (verdict in (
                   'supported', 'partial', 'contradicted', 'not_in_sources', 'cant_tell',
                   'reference_not_found', 'cant_check', 'no_citation_given')),
  quote          text,
  page           integer check (page is null or page >= 1),
  chunk_id       uuid,
  reason         text not null default '',
  exit_stage     smallint not null check (exit_stage between 2 and 9),
  fix_suggestion text,
  latency_ms     integer,
  retries        integer not null default 0,
  created_at     timestamptz not null default now(),
  constraint supported_needs_evidence
    check (verdict <> 'supported' or (quote is not null and page is not null)),
  constraint only_verified_verdicts_carry_quote
    check (quote is null or verdict in ('supported', 'partial', 'contradicted')),
  constraint fix_only_for_partial_or_contradicted
    check (fix_suggestion is null or verdict in ('partial', 'contradicted'))
);
create index verdicts_session_idx on verdicts (session_id);

-- Analytics events (docs/events.md): ids, counts and buckets only. Never draft text, quotes or
-- reference text. session_id has no foreign key so events outlive a purged session, because the
-- beta metrics need them. This differs from "every row expires in 30 days" in architecture.md
-- and is flagged for Steven.
create table events (
  id         bigint generated always as identity primary key,
  session_id uuid,
  name       text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_name_created_idx on events (name, created_at);

-- Retention: deleting a run or document cascades to claims, verdicts, reference entries, pages and
-- chunks. Call this lazily (for example at the start of a request) or from a scheduler.
create function purge_expired()
returns table (runs_deleted integer, documents_deleted integer, sessions_deleted integer)
language plpgsql
as $$
declare
  r integer;
  d integer;
  s integer;
begin
  delete from runs where expires_at < now();
  get diagnostics r = row_count;

  delete from documents where expires_at < now();
  get diagnostics d = row_count;

  delete from sessions se
  where se.last_seen_at < now() - interval '30 days'
    and not exists (select 1 from runs ru where ru.session_id = se.id)
    and not exists (select 1 from documents dc where dc.session_id = se.id);
  get diagnostics s = row_count;

  return query select r, d, s;
end;
$$;
