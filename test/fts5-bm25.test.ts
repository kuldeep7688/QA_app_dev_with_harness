import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase } from '../src/services/db.js';
import { runMigrations } from '../src/services/migrations/runner.js';
import { RetrieverService } from '../src/services/retriever-service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const FIXTURE_CORPUS = [
  {
    id: "chunk-001",
    documentId: "doc-001",
    idx: 0,
    content: "The quick brown fox jumps over the lazy dog. This is a classic pangram used in typography.",
    charCount: 89,
    wordCount: 16
  },
  {
    id: "chunk-002",
    documentId: "doc-001",
    idx: 1,
    content: "SQLite is a lightweight embedded database engine. It uses SQL for queries and supports full-text search via FTS5.",
    charCount: 114,
    wordCount: 18
  },
  {
    id: "chunk-003",
    documentId: "doc-002",
    idx: 0,
    content: "Machine learning models require large datasets for training. Neural networks learn patterns from data.",
    charCount: 103,
    wordCount: 15
  },
  {
    id: "chunk-004",
    documentId: "doc-002",
    idx: 1,
    content: "Python is a popular programming language for data science and machine learning. It has excellent libraries like NumPy and TensorFlow.",
    charCount: 134,
    wordCount: 20
  },
  {
    id: "chunk-005",
    documentId: "doc-003",
    idx: 0,
    content: "TypeScript adds static typing to JavaScript. It helps catch bugs early and improves code maintainability.",
    charCount: 106,
    wordCount: 15
  }
];

describe("FTS5 BM25 Keyword Index", () => {
  let testDir: string;
  let db: ReturnType<typeof initDatabase>;
  let retriever: RetrieverService;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "fts5-test-"));
    db = initDatabase(testDir);
    runMigrations(db);

    const insertDoc = db.prepare(`
      INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertDoc.run("doc-001", "Document 1", "doc1.txt", 1024, new Date().toISOString(), "ready", 100, 10, "txt");
    insertDoc.run("doc-002", "Document 2", "doc2.txt", 2048, new Date().toISOString(), "ready", 150, 15, "txt");
    insertDoc.run("doc-003", "Document 3", "doc3.txt", 512, new Date().toISOString(), "ready", 80, 8, "txt");

    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
    for (const chunk of FIXTURE_CORPUS) {
      insertChunk.run(chunk.id, chunk.documentId, chunk.idx, chunk.content, chunk.charCount, chunk.wordCount);
    }

    retriever = new RetrieverService(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("chunks_fts virtual table exists", () => {
    const stmt = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='chunks_fts'
    `);
    const result = stmt.get() as { name: string } | undefined;
    expect(result).toBeDefined();
    expect(result!.name).toBe('chunks_fts');
  });

  it("chunks_fts has BM25 ranking available", () => {
    const stmt = db.prepare(`
      SELECT bm25(chunks_fts) as score
      FROM chunks_fts
      WHERE chunks_fts MATCH 'database'
      LIMIT 1
    `);
    const result = stmt.get() as { score: number } | undefined;
    expect(result).toBeDefined();
    expect(typeof result!.score).toBe('number');
  });

  it("FTS index contains all inserted chunks", () => {
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM chunks_fts`);
    const result = stmt.get() as { count: number };
    expect(result.count).toBe(FIXTURE_CORPUS.length);
  });

  it("INSERT trigger keeps FTS in sync", () => {
    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
    const result = insertChunk.run("chunk-099", "doc-003", 1, "This is a new chunk for testing triggers.", 43, 8);
    const newRowid = result.lastInsertRowid as number;

    const stmt = db.prepare(`SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'triggers'`);
    const ftsResult = stmt.get() as { rowid: number } | undefined;
    expect(ftsResult).toBeDefined();
    expect(ftsResult!.rowid).toBe(newRowid);

    db.prepare("DELETE FROM chunks WHERE rowid = ?").run(newRowid);
  });

  it("UPDATE trigger keeps FTS in sync", () => {
    const newContent = "TypeScript with static typing is excellent for large codebases.";
    db.prepare(`UPDATE chunks SET content = ? WHERE rowid = 5`).run(newContent);

    const stmt = db.prepare(`SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'codebases'`);
    const result = stmt.get() as { rowid: number } | undefined;
    expect(result).toBeDefined();
    expect(result!.rowid).toBe(5);

    db.prepare(`UPDATE chunks SET content = ? WHERE rowid = 5`).run(FIXTURE_CORPUS[4].content);
  });

  it("DELETE trigger keeps FTS in sync", () => {
    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
    const result = insertChunk.run("chunk-098", "doc-003", 2, "Temporary chunk with unique word xyzabc.", 40, 6);
    const tempRowid = result.lastInsertRowid as number;

    let stmt = db.prepare(`SELECT COUNT(*) as count FROM chunks_fts WHERE chunks_fts MATCH 'xyzabc'`);
    let countResult = stmt.get() as { count: number };
    expect(countResult.count).toBe(1);

    db.prepare("DELETE FROM chunks WHERE rowid = ?").run(tempRowid);

    stmt = db.prepare(`SELECT COUNT(*) as count FROM chunks_fts WHERE chunks_fts MATCH 'xyzabc'`);
    countResult = stmt.get() as { count: number };
    expect(countResult.count).toBe(0);
  });

  it("bm25Search returns results for database query", () => {
    const results = retriever.bm25Search("database");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].rowid).toBe(2);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("bm25Search returns results for machine learning query", () => {
    const results = retriever.bm25Search("machine learning");
    expect(results.length).toBeGreaterThanOrEqual(2);

    const rowids = results.map(r => r.rowid);
    expect(rowids.includes(3) || rowids.includes(4)).toBe(true);

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("bm25Search respects limit parameter", () => {
    const results = retriever.bm25Search("the", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("bm25Search returns empty array for non-matching query", () => {
    const results = retriever.bm25Search("xyznonexistent123");
    expect(results.length).toBe(0);
  });

  it("bm25Search returns empty array for empty query", () => {
    const results = retriever.bm25Search("");
    expect(results.length).toBe(0);
  });

  it("bm25Search: 'fox' query returns pangram chunk in top-3", () => {
    const results = retriever.bm25Search("fox", 10);
    expect(results.length).toBeGreaterThan(0);

    const topThreeRowids = results.slice(0, 3).map(r => r.rowid);
    expect(topThreeRowids).toContain(1);
  });

  it("bm25Search: 'typescript static' query returns TypeScript chunk in top-3", () => {
    const results = retriever.bm25Search("typescript static", 10);
    expect(results.length).toBeGreaterThan(0);

    const topThreeRowids = results.slice(0, 3).map(r => r.rowid);
    expect(topThreeRowids).toContain(5);
  });

  it("bm25Search: 'python programming' query returns Python chunk in top-3", () => {
    const results = retriever.bm25Search("python programming", 10);
    expect(results.length).toBeGreaterThan(0);

    const topThreeRowids = results.slice(0, 3).map(r => r.rowid);
    expect(topThreeRowids).toContain(4);
  });

  it("getChunksByRowids returns full chunk details", () => {
    const results = retriever.bm25Search("database", 1);
    expect(results.length).toBeGreaterThan(0);

    const chunks = retriever.getChunksByRowids(results.map(r => r.rowid));
    expect(chunks.length).toBe(results.length);
    expect(chunks[0].content).toBeDefined();
    expect(chunks[0].documentId).toBeDefined();
    expect(typeof chunks[0].idx).toBe('number');
    expect(typeof chunks[0].charCount).toBe('number');
    expect(typeof chunks[0].wordCount).toBe('number');
  });

  it("getChunksByRowids preserves order", () => {
    const rowids = [5, 2, 4];
    const chunks = retriever.getChunksByRowids(rowids);
    expect(chunks.length).toBe(3);
    expect(chunks[0].rowid).toBe(5);
    expect(chunks[1].rowid).toBe(2);
    expect(chunks[2].rowid).toBe(4);
  });

  it("getChunksByRowids returns empty array for empty input", () => {
    const chunks = retriever.getChunksByRowids([]);
    expect(chunks.length).toBe(0);
  });
});
