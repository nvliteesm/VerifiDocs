# Supabase Setup

This setup is inferred from the current FastAPI backend. The app expects four tables and one RPC:

- `documents`
- `document_chunks`
- `chat_messages`
- `evaluation_tests`
- `match_document_chunks`

The backend uses a Supabase service role key, so keep that key only in `backend/.env` and never expose it to the frontend.

## SQL Setup

Run this SQL in the Supabase SQL editor.

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  file_type text not null default 'pdf',
  total_pages integer,
  file_path text,
  created_at timestamptz not null default now()
);

create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  page_number integer,
  content text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);

create index if not exists document_chunks_document_id_idx
  on document_chunks(document_id);

create index if not exists document_chunks_embedding_idx
  on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  question text not null,
  answer text not null,
  confidence text not null,
  confidence_reason text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_document_id_created_at_idx
  on chat_messages(document_id, created_at desc);

create table if not exists evaluation_tests (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  question text not null,
  expected_answer text,
  notes text,
  generated_answer text,
  confidence text,
  confidence_reason text,
  source_count integer not null default 0,
  status text not null default 'not_run'
    check (status in ('not_run', 'passed', 'failed', 'needs_review')),
  created_at timestamptz not null default now()
);

create index if not exists evaluation_tests_document_id_created_at_idx
  on evaluation_tests(document_id, created_at desc);

create or replace function match_document_chunks(
  query_embedding vector(768),
  match_document_id uuid default null,
  match_count integer default 5
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index integer,
  page_number integer,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.page_number,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where match_document_id is null
    or dc.document_id = match_document_id
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
```

## Required Relationships

- `document_chunks.document_id` references `documents.id` with `on delete cascade`.
- `chat_messages.document_id` references `documents.id` with `on delete cascade`; this column is nullable for all-document chat history.
- `evaluation_tests.document_id` references `documents.id` with `on delete cascade`; this column is nullable for all-document evaluation tests.

## Backend Expectations

The current code inserts these fields:

- `documents`: `filename`, `file_type`, `total_pages`, `file_path`
- `document_chunks`: `document_id`, `chunk_index`, `page_number`, `content`, `embedding`
- `chat_messages`: `document_id`, `question`, `answer`, `confidence`, `confidence_reason`, `sources`
- `evaluation_tests`: `document_id`, `question`, `expected_answer`, `notes`, `status`, then later `generated_answer`, `confidence`, `confidence_reason`, `source_count`

The `match_document_chunks` RPC must accept:

- `query_embedding`
- `match_document_id`
- `match_count`

It must return enough fields for the backend to build source previews:

- `document_id`
- `chunk_index`
- `page_number`
- `content`
- `similarity`

## RLS Note

For a local portfolio demo, the backend uses the service role key and can access tables directly. If you enable Row Level Security for a deployed version, add policies that fit your auth model and keep all service-role operations on the backend only.
