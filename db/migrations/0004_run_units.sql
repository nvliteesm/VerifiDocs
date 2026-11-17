-- 0004_run_units: track claim extraction per unit of the draft.
-- A long draft is extracted one unit per request (docs/architecture.md). A run moves from 'extracting' to
-- 'checking' only after every unit has been extracted, so the run needs to know how many units there are and
-- which have been done. A unit is recorded exactly once, which also stops a repeated request from creating
-- duplicate claims.

alter table runs add column unit_count integer not null default 0;

create table run_units (
  run_id      uuid not null references runs(id) on delete cascade,
  unit_index  integer not null check (unit_index >= 0),
  claim_count integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (run_id, unit_index)
);
