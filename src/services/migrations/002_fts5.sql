-- Migration 002: FTS5 Full-Text Search Index
-- Creates chunks_fts virtual table with BM25 ranking and automatic sync triggers

-- Create FTS5 virtual table for full-text search
-- Regular FTS5 table (stores its own copy of the content)
-- tokenize='porter unicode61': Porter stemming + Unicode word boundaries
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  tokenize='porter unicode61'
);

-- Populate FTS index with existing chunks
-- Use chunks.rowid as the FTS rowid for easy JOIN
INSERT INTO chunks_fts(rowid, content)
SELECT rowid, content FROM chunks;

-- Trigger: Keep FTS in sync on INSERT
CREATE TRIGGER chunks_fts_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content)
  VALUES (NEW.rowid, NEW.content);
END;

-- Trigger: Keep FTS in sync on UPDATE
CREATE TRIGGER chunks_fts_update AFTER UPDATE ON chunks BEGIN
  DELETE FROM chunks_fts WHERE rowid = OLD.rowid;
  INSERT INTO chunks_fts(rowid, content) VALUES(NEW.rowid, NEW.content);
END;

-- Trigger: Keep FTS in sync on DELETE
CREATE TRIGGER chunks_fts_delete AFTER DELETE ON chunks BEGIN
  DELETE FROM chunks_fts WHERE rowid = OLD.rowid;
END;
