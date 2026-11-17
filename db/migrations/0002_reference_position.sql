-- 0002_reference_position: reference-list entries need a position.
-- A numeric citation such as [3] means "the third entry of the reference list" (stage 3).
-- The table is empty at this point (no code has written to it yet), so a placeholder default is safe.

alter table reference_entries add column position integer not null default 0;
alter table reference_entries alter column position drop default;
alter table reference_entries add constraint reference_entries_position_positive check (position >= 1);
alter table reference_entries add constraint reference_entries_run_position_key unique (run_id, position);
