-- 0011_quote_gloss: a short machine translation of the evidence quote, for a claim written in Bahasa Indonesia
-- whose source is in English (24 Nov 2026). The quote stays the evidence; the gloss only helps the student read it,
-- is never checked against the source, and is shown labelled as a machine translation. Null when there is no quote,
-- or when the claim and the quote are in the same language.

alter table verdicts add column quote_gloss text;
alter table verdicts add constraint gloss_needs_quote check (quote_gloss is null or quote is not null);
