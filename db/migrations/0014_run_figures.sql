-- 0014_run_figures: what "Check my numbers" read, kept so it is still there after a reload.
-- One row per part of the draft (unit): the figures it reports and the findings it states, as the model read them
-- and this code checked them. `run_consistency` holds the places that may contradict, found across parts.
-- Nothing here is draft text beyond sentences already in the run's draft, and both tables go with their run
-- (on delete cascade), so the 30-day deletion removes them too.
create table run_figures (
  run_id     uuid        not null references runs(id) on delete cascade,
  unit       integer     not null check (unit >= 0),
  figures    jsonb       not null default '[]',
  statements jsonb       not null default '[]',
  dropped    integer     not null default 0,
  partial    boolean     not null default false,
  created_at timestamptz not null default now(),
  primary key (run_id, unit)
);

create table run_consistency (
  run_id     uuid        primary key references runs(id) on delete cascade,
  pairs      jsonb       not null default '[]',
  created_at timestamptz not null default now()
);
