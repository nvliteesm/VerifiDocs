-- 0007_failed_units: a part of the draft the AI could not read.
-- The model sometimes fails on one slice of a long draft (it times out or returns broken JSON). Rather than block the
-- whole scan, the slice is recorded with failed = true (none or only half of its claims were read), the scan
-- finishes, and the screen names the section and offers to read that part again.

alter table run_units add column failed boolean not null default false;
