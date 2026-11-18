-- 0010_citation_source: where a claim's citation came from (the audit trail, PRD guard rule 2).
-- 'draft': written by the student. 'found': attached here from a paper "Find a source" found, after the claim was
-- written. A 'found' claim is checked like any other, and its verdict is always shown with "Found here: not in your
-- draft yet", on screen and in the copied report.

alter table claims add column citation_source text not null default 'draft' check (citation_source in ('draft', 'found'));
