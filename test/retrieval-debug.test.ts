import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDatabase, closeDatabase, resetDatabaseInstance, isVectorExtensionLoaded } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { debugSearch, DebugSearchResult } from '../src/services/retriever';
import { embed, embedBatch } from '../src/services/embedding-service';

const FIXTURE_CHUNKS = [
  {
    id: 'chunk-001', documentId: 'doc-001', idx: 0,
    content: 'The system uses a layered architecture with clear boundaries between the main process, preload scripts, and renderer. Each layer communicates through typed IPC channels.',
    charCount: 166, wordCount: 24,
  },
  {
    id: 'chunk-002', documentId: 'doc-001', idx: 1,
    content: 'SQLite is a lightweight embedded database engine with WAL mode and foreign keys. It supports full-text search via FTS5 and vector search via sqlite-vec.',
    charCount: 142, wordCount: 22,
  },
  {
    id: 'chunk-003', documentId: 'doc-002', idx: 0,
    content: 'Machine learning models learn patterns from training data. Neural networks with multiple layers can capture complex relationships in large datasets.',
    charCount: 142, wordCount: 20,
  },
  {
    id: 'chunk-004', documentId: 'doc-002', idx: 1,
    content: 'Python is a popular language for data science and machine learning development. It provides libraries like NumPy, TensorFlow, and scikit-learn.',
    charCount: 134, wordCount: 20,
  },
  {
    id: 'chunk-005', documentId: 'doc-003', idx: 0,
    content: 'TypeScript adds static type checking to JavaScript. It helps catch bugs at compile time and improves code maintainability for large projects.',
    charCount: 135, wordCount: 19,
  },
  {
    id: 'chunk-006', documentId: 'doc-003', idx: 1,
    content: 'The import pipeline validates file size and type before copying documents to the data directory. Supported formats include txt and markdown files.',
    charCount: 145, wordCount: 22,
  },
  {
    id: 'chunk-007', documentId: 'doc-004', idx: 0,
    content: 'Feedback collection allows users to rate Q&A responses as positive or negative. Ratings are persisted in the feedback table and displayed in conversation history.',
    charCount: 165, wordCount: 24,
  },
  {
    id: 'chunk-008', documentId: 'doc-004', idx: 1,
    content: 'The indexing pipeline splits documents at paragraph boundaries into chunks of approximately 500 characters. Each chunk is stored in the chunks table and embedded for vector search.',
    charCount: 191, wordCount: 28,
  },
  {
    id: 'chunk-009', documentId: 'doc-005', idx: 0,
    content: 'Document metadata includes word count, line count, and file type. This information is extracted during import and stored in the documents table.',
    charCount: 149, wordCount: 24,
  },
  {
    id: 'chunk-010', documentId: 'doc-005', idx: 1,
    content: 'Clean state reset removes all documents, chunks, Q&A history, and feedback data. The data directory is recreated fresh for testing and benchmarking.',
    charCount: 149, wordCount: 22,
  },
];

describe('Retrieval Debug', () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'retrieval-debug-test-'));
    db = initDatabase(testDir);
    runMigrations(db);

    const insertDoc = db.prepare(
      'INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertDoc.run('doc-001', 'Architecture Overview', 'arch.md', 2048, new Date().toISOString(), 'ready', 200, 15, 'md');
    insertDoc.run('doc-002', 'ML Guide', 'ml-guide.txt', 1536, new Date().toISOString(), 'ready', 180, 12, 'txt');
    insertDoc.run('doc-003', 'TypeScript Guide', 'ts-guide.md', 1024, new Date().toISOString(), 'ready', 150, 10, 'md');
    insertDoc.run('doc-004', 'Feature Notes', 'features.txt', 2048, new Date().toISOString(), 'ready', 220, 18, 'txt');
    insertDoc.run('doc-005', 'Operations Manual', 'ops.md', 1024, new Date().toISOString(), 'ready', 160, 12, 'md');

    const insertChunk = db.prepare(
      'INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
    );
    for (const chunk of FIXTURE_CHUNKS) {
      insertChunk.run(chunk.id, chunk.documentId, chunk.idx, chunk.content, chunk.charCount, chunk.wordCount);
    }

    const chunksCount = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    if (chunksCount.count > 0 && isVectorExtensionLoaded()) {
      const allChunks = db.prepare('SELECT rowid, content FROM chunks ORDER BY rowid').all() as Array<{ rowid: number; content: string }>;
      const texts = allChunks.map(c => c.content);
      const embeddings = await embedBatch(texts);
      const insertVec = db.prepare('INSERT INTO chunks_vec (embedding) VALUES (?)');
      const updateVecRowid = db.prepare('UPDATE chunks SET vec_rowid = ?, embedded_at = ? WHERE rowid = ?');
      const now = new Date().toISOString();
      const vecRowids: number[] = [];
      for (const embedding of embeddings) {
        const info = insertVec.run(embedding);
        vecRowids.push(Number(info.lastInsertRowid));
      }
      const updateAll = db.transaction(() => {
        for (let i = 0; i < allChunks.length; i++) {
          updateVecRowid.run(vecRowids[i], now, allChunks[i].rowid);
        }
      });
      updateAll();
    }
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns empty arrays for empty query', async () => {
    const result = await debugSearch(db, '', embed);
    expect(result.bm25Results).toEqual([]);
    expect(result.vectorResults).toEqual([]);
    expect(result.fusedResults).toEqual([]);
  });

  it('returns bm25Results with correct shape in bm25 mode', async () => {
    const result = await debugSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });

    expect(result.bm25Results.length).toBeGreaterThan(0);
    for (const r of result.bm25Results) {
      expect(r).toHaveProperty('rowid');
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('rank');
      expect(typeof r.rowid).toBe('number');
      expect(typeof r.score).toBe('number');
      expect(typeof r.rank).toBe('number');
      expect(r.rank).toBeGreaterThanOrEqual(1);
    }

    expect(result.vectorResults).toEqual([]);
  });

  it('returns vectorResults with correct shape in vector mode', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping vector mode test: vector extension not loaded');
      return;
    }

    const result = await debugSearch(db, 'database', embed, { mode: 'vector', topK: 10 });

    expect(result.vectorResults.length).toBeGreaterThan(0);
    for (const r of result.vectorResults) {
      expect(r).toHaveProperty('rowid');
      expect(r).toHaveProperty('distance');
      expect(r).toHaveProperty('rank');
      expect(typeof r.rowid).toBe('number');
      expect(typeof r.distance).toBe('number');
      expect(typeof r.rank).toBe('number');
      expect(r.rank).toBeGreaterThanOrEqual(1);
    }

    expect(result.bm25Results).toEqual([]);
  });

  it('returns both bm25Results and vectorResults in hybrid mode', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping hybrid mode test: vector extension not loaded');
      return;
    }

    const result = await debugSearch(db, 'database', embed, { mode: 'hybrid', topK: 10 });

    expect(result.bm25Results.length).toBeGreaterThan(0);
    expect(result.vectorResults.length).toBeGreaterThan(0);
    expect(result.fusedResults.length).toBeGreaterThan(0);
  });

  it('fusedResults are sorted by fusedScore descending', async () => {
    const result = await debugSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });

    if (result.fusedResults.length > 1) {
      for (let i = 0; i < result.fusedResults.length - 1; i++) {
        expect(result.fusedResults[i].fusedScore).toBeGreaterThanOrEqual(result.fusedResults[i + 1].fusedScore);
      }
    }
  });

  it('bm25Results are ordered by rank (1, 2, 3...)', async () => {
    const result = await debugSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });

    for (let i = 0; i < result.bm25Results.length; i++) {
      expect(result.bm25Results[i].rank).toBe(i + 1);
    }
  });

  it('all scores in bm25Results are finite numbers', async () => {
    const result = await debugSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });

    for (const r of result.bm25Results) {
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });

  it('all distances in vectorResults are finite numbers', async () => {
    if (!isVectorExtensionLoaded()) {
      return;
    }

    const result = await debugSearch(db, 'database', embed, { mode: 'vector', topK: 10 });

    for (const r of result.vectorResults) {
      expect(Number.isFinite(r.distance)).toBe(true);
    }
  });

  it('all fusedScores in fusedResults are finite numbers', async () => {
    const result = await debugSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });

    for (const r of result.fusedResults) {
      expect(Number.isFinite(r.fusedScore)).toBe(true);
    }
  });

  it('fusedResults have chunk details', async () => {
    const result = await debugSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });

    for (const r of result.fusedResults) {
      expect(r.chunk).toBeDefined();
      expect(r.chunk.rowid).toBeGreaterThan(0);
      expect(r.chunk.id).toBeTruthy();
      expect(r.chunk.documentId).toBeTruthy();
      expect(r.chunk.content).toBeTruthy();
    }
  });

  it('bm25Results has no duplicate rowids', async () => {
    const result = await debugSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });

    const rowids = result.bm25Results.map(r => r.rowid);
    expect(new Set(rowids).size).toBe(rowids.length);
  });
});
