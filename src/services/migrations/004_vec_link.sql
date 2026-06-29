-- Migration 004: Link chunks_vec rowids to chunks table
-- Adds vec_rowid column so hybrid search can JOIN chunks_vec results to chunk data
-- This is a fragile-to-safe bridge: without it, chunks and chunks_vec have no queryable link

ALTER TABLE chunks ADD COLUMN vec_rowid INTEGER;
