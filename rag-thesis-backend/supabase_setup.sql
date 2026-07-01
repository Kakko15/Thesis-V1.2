-- ============================================
-- THESIS ARCHIVE — SUPABASE DATABASE SETUP
-- Run this in your Supabase SQL Editor
-- ============================================

-- Step 1: Enable pgvector extension
create extension if not exists vector;

-- Step 2: Papers metadata table
create table if not exists papers (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  authors text,
  year integer,
  abstract text,
  content text,
  filename text,
  created_at timestamptz default now()
);

-- Step 3: Chunks with vector embeddings (768 dimensions for text-embedding-004)
create table if not exists chunks (
  id bigserial primary key,
  paper_id uuid references papers(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(768)
);

-- Step 4: Create HNSW index for fast vector search
create index if not exists chunks_embedding_idx on chunks 
  using hnsw (embedding vector_cosine_ops);

-- Step 5: RPC function for vector similarity search
create or replace function match_chunks(
  query_embedding vector(768),
  match_count int default 5,
  match_threshold float default 0.3
)
returns table (
  id bigint,
  paper_id uuid,
  chunk_index integer,
  content text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.paper_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  where 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;
