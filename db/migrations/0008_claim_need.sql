-- 0008_claim_need: how much a claim needs a source.
-- 'must': a number, a finding, a claim about a named organisation, product, person, law or event, a quotation, or a
-- cause-and-effect claim. 'should': a general statement a source would strengthen. A 'should' claim with no citation
-- is shown as "Could use a source" and is not in the fix list. (Common knowledge and definitions are not saved.)

alter table claims add column need text not null default 'must' check (need in ('must', 'should'));
