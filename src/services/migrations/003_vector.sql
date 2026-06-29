-- Migration 003: Vector search support via sqlite-vec extension
-- Creates chunks_vec virtual table for 384-dimensional embeddings
-- This migration is graceful: if sqlite-vec is not loaded, table creation will fail
-- but the app continues in BM25-only mode

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
  embedding float[384]
);
