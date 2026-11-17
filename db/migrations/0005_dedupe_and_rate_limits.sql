-- 0005_dedupe_and_rate_limits
--
-- 1. documents.content_hash: a SHA-256 of the uploaded PDF's bytes, so the same file cannot be added twice to
--    one session (it would use up a source slot and give two equal matches for one reference). Only a hash is
--    kept; the PDF itself is still never stored. Null for rows from before this migration.
-- 2. rate_limits: a fixed-window counter per key, so nobody can open unlimited sessions or burn the model
--    quota. Keys carry a hash of the caller's address or a session id, never text. Rows are deleted once their
--    window has passed (see src/lib/rate-limit.ts).

alter table documents add column content_hash text;
create unique index documents_session_hash_idx on documents (session_id, content_hash) where content_hash is not null;

create table rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);
create index rate_limits_window_idx on rate_limits (window_start);
