-- 0006_claim_section: where a claim sits in the draft, and where its citation came from.
-- section: the heading the claim sits under ("2.1 Background"), so results can be grouped by section. It is draft
--   text, so it lives on the claim row and goes with the run (on delete cascade, and the 30-day purge of runs).
-- citation_inherited: the sentence has no citation of its own and was given the next citation later in its
--   paragraph (one citation at the end of a paragraph covering several sentences).

alter table claims add column section text;
alter table claims add column citation_inherited boolean not null default false;
