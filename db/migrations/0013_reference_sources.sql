-- 0013_reference_sources: where each reference's source FILE stands, apart from any claim verdict.
-- A reference-list entry is looked up once (Crossref/OpenAlex, already cached in `resolution`); this adds what that
-- means for getting its PDF:
--   pending          not looked at yet
--   matched          a high-confidence bibliographic match with an open-access PDF link; retrieval is next
--   retrieved        the PDF was fetched and attached (document_id is set)
--   matched_no_file  a high-confidence match, but no free PDF could be had: the student uploads it
--   possible         a similar work, not enough to attach on its own: the student confirms or rejects it
--   not_retrieved    nothing reliable was found. This says nothing about whether the reference exists
--   uploaded         the student uploaded the PDF and linked it to this entry (document_id is set)
-- `candidate` holds the matched or possible work: title, year, doi, venue and the PDF link. Metadata only, no text.
-- `ref_type` is the kind of work the entry describes (journal, thesis, proceedings, book, regulation, standard,
-- institution, unknown), kept so the screen can word "could not be retrieved" for what it is.
-- Rows go with their run (on delete cascade), so the 30-day deletion removes them too.

alter table reference_entries
  add column ref_type     text,
  add column source_state text not null default 'pending'
    check (source_state in ('pending', 'matched', 'retrieved', 'matched_no_file', 'possible', 'not_retrieved', 'uploaded')),
  add column candidate    jsonb;
