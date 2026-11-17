-- 0003_reference_resolution_details: keep every field of a resolved reference so a cached result is
-- complete. A resolution is cached per run, so each reference-list entry is looked up once and not
-- once per claim. Only definite answers (found, not_found) are cached; a failed lookup is never saved.

alter table reference_entries add column resolved_year integer;
alter table reference_entries add column year_mismatch boolean not null default false;
