-- pgvector extension must exist before 20260605000000_add_memory_chunk_rag creates
-- the vector(384) column. Image pgvector/pgvector:pg16 ships the extension;
-- IF NOT EXISTS makes this a no-op on databases where it was created manually.
CREATE EXTENSION IF NOT EXISTS vector;
