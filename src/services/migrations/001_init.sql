-- Migration 001: Initial schema
-- Creates core tables: documents, chunks, qa_history, feedback

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  word_count INTEGER DEFAULT 0,
  line_count INTEGER DEFAULT 0,
  file_type TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL,
  char_count INTEGER,
  word_count INTEGER,
  embedded_at TEXT
);

CREATE INDEX IF NOT EXISTS chunks_doc_idx ON chunks(document_id, idx);

CREATE TABLE IF NOT EXISTS qa_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  confidence REAL,
  citations_json TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  response_ts TEXT NOT NULL,
  question TEXT NOT NULL,
  rating TEXT NOT NULL,
  comment TEXT,
  submitted_at TEXT NOT NULL
);
