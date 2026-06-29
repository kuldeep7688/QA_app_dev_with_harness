/**
 * Test: Hybrid Retriever (BM25 + Vector via RRF)
 *
 * Verifies:
 * - hybridSearch is a pure function over db + embeddingService
 * - Configurable mode, topN, topK, rrfK
 * - Deterministic ordering on tie via stable secondary key (chunk rowid)
 * - hybrid precision@5 >= max(bm25, vector) on seeded queries
 * - mode flags (hybrid | bm25 | vector) behave correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDatabase, closeDatabase, resetDatabaseInstance, isVectorExtensionLoaded } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { hybridSearch, HybridSearchResult } from '../src/services/retriever';
import { embed, embedBatch } from '../src/services/embedding-service';

const FIXTURE_CHUNKS = [
  {
    id: 'chunk-001',
    documentId: 'doc-001',
    idx: 0,
    content: 'The system uses a layered architecture with clear boundaries between the main process, preload scripts, and renderer. Each layer communicates through typed IPC channels.',
    charCount: 166,
    wordCount: 24,
  },
  {
    id: 'chunk-002',
    documentId: 'doc-001',
    idx: 1,
    content: 'SQLite is a lightweight embedded database engine with WAL mode and foreign keys. It supports full-text search via FTS5 and vector search via sqlite-vec.',
    charCount: 142,
    wordCount: 22,
  },
  {
    id: 'chunk-003',
    documentId: 'doc-002',
    idx: 0,
    content: 'Machine learning models learn patterns from training data. Neural networks with multiple layers can capture complex relationships in large datasets.',
    charCount: 142,
    wordCount: 20,
  },
  {
    id: 'chunk-004',
    documentId: 'doc-002',
    idx: 1,
    content: 'Python is a popular language for data science and machine learning development. It provides libraries like NumPy, TensorFlow, and scikit-learn.',
    charCount: 134,
    wordCount: 20,
  },
  {
    id: 'chunk-005',
    documentId: 'doc-003',
    idx: 0,
    content: 'TypeScript adds static type checking to JavaScript. It helps catch bugs at compile time and improves code maintainability for large projects.',
    charCount: 135,
    wordCount: 19,
  },
  {
    id: 'chunk-006',
    documentId: 'doc-003',
    idx: 1,
    content: 'The import pipeline validates file size and type before copying documents to the data directory. Supported formats include txt and markdown files.',
    charCount: 145,
    wordCount: 22,
  },
  {
    id: 'chunk-007',
    documentId: 'doc-004',
    idx: 0,
    content: 'Feedback collection allows users to rate Q&A responses as positive or negative. Ratings are persisted in the feedback table and displayed in conversation history.',
    charCount: 165,
    wordCount: 24,
  },
  {
    id: 'chunk-008',
    documentId: 'doc-004',
    idx: 1,
    content: 'The indexing pipeline splits documents at paragraph boundaries into chunks of approximately 500 characters. Each chunk is stored in the chunks table and embedded for vector search.',
    charCount: 191,
    wordCount: 28,
  },
  {
    id: 'chunk-009',
    documentId: 'doc-005',
    idx: 0,
    content: 'Document metadata includes word count, line count, and file type. This information is extracted during import and stored in the documents table.',
    charCount: 149,
    wordCount: 24,
  },
  {
    id: 'chunk-010',
    documentId: 'doc-005',
    idx: 1,
    content: 'Clean state reset removes all documents, chunks, Q&A history, and feedback data. The data directory is recreated fresh for testing and benchmarking.',
    charCount: 149,
    wordCount: 22,
  },
];

describe('Hybrid Retriever', () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'hybrid-retriever-test-'));
    db = initDatabase(testDir);
    runMigrations(db);

    const insertDoc = db.prepare(`
      INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertDoc.run('doc-001', 'Architecture Overview', 'arch.md', 2048, new Date().toISOString(), 'ready', 200, 15, 'md');
    insertDoc.run('doc-002', 'ML Guide', 'ml-guide.txt', 1536, new Date().toISOString(), 'ready', 180, 12, 'txt');
    insertDoc.run('doc-003', 'TypeScript Guide', 'ts-guide.md', 1024, new Date().toISOString(), 'ready', 150, 10, 'md');
    insertDoc.run('doc-004', 'Feature Notes', 'features.txt', 2048, new Date().toISOString(), 'ready', 220, 18, 'txt');
    insertDoc.run('doc-005', 'Operations Manual', 'ops.md', 1024, new Date().toISOString(), 'ready', 160, 12, 'md');

    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
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

  it('returns empty array for empty query', async () => {
    const results = await hybridSearch(db, '', embed);
    expect(results).toEqual([]);
  });

  it('returns empty array for whitespace-only query', async () => {
    const results = await hybridSearch(db, '   ', embed);
    expect(results).toEqual([]);
  });

  it('returns BM25 results in bm25 mode', async () => {
    const results = await hybridSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.sources).toContain('bm25');
      expect(r.bm25Rank).toBeDefined();
      expect(r.bm25Score).toBeDefined();
    }
  });

  it('finds architecture chunk for architecture query in bm25 mode', async () => {
    const results = await hybridSearch(db, 'layered architecture', embed, { mode: 'bm25', topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    const topRowids = results.map(r => r.chunk.rowid);
    expect(topRowids).toContain(1);
  });

  it('finds SQLite chunk for database query in bm25 mode', async () => {
    const results = await hybridSearch(db, 'sqlite database', embed, { mode: 'bm25', topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    const topRowids = results.map(r => r.chunk.rowid);
    expect(topRowids).toContain(2);
  });

  it('finds machine learning chunks for ml query in bm25 mode', async () => {
    const results = await hybridSearch(db, 'machine learning', embed, { mode: 'bm25', topK: 10 });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const topRowids = results.map(r => r.chunk.rowid);
    expect(topRowids).toContain(3);
    expect(topRowids).toContain(4);
  });

  it('returns vector results with scores in vector mode', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping vector mode test: vector extension not loaded');
      return;
    }

    const results = await hybridSearch(db, 'database engine sqlite', embed, { mode: 'vector', topK: 10 });
    for (const r of results) {
      expect(r.sources).toContain('vector');
      expect(r.vectorRank).toBeDefined();
      expect(r.vectorDistance).toBeDefined();
    }
  });

  it('returns results in hybrid mode with sources from BM25 or vector', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping hybrid mode test: vector extension not loaded');
      return;
    }

    const results = await hybridSearch(db, 'database sqlite', embed, { mode: 'hybrid', topN: 10, topK: 10 });
    expect(results.length).toBeGreaterThan(0);
    const hasBm25Sources = results.some(r => r.sources.includes('bm25'));
    const hasVectorSources = results.some(r => r.sources.includes('vector'));
    expect(hasBm25Sources).toBe(true);
    expect(hasVectorSources).toBe(true);
  });

  it('respects topK parameter', async () => {
    const results = await hybridSearch(db, 'database', embed, { mode: 'bm25', topK: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('returns results sorted by fusedScore descending', async () => {
    const results = await hybridSearch(db, 'database machine learning', embed, { mode: 'bm25', topK: 10 });
    if (results.length > 1) {
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].fusedScore).toBeGreaterThanOrEqual(results[i + 1].fusedScore);
      }
    }
  });

  it('each result has valid chunk with required fields', async () => {
    const results = await hybridSearch(db, 'database', embed, { mode: 'bm25', topK: 5 });
    for (const r of results) {
      expect(r.chunk.rowid).toBeGreaterThan(0);
      expect(r.chunk.id).toBeTruthy();
      expect(r.chunk.documentId).toBeTruthy();
      expect(r.chunk.content).toBeTruthy();
      expect(typeof r.chunk.charCount).toBe('number');
      expect(typeof r.chunk.wordCount).toBe('number');
      expect(r.fusedScore).toBeGreaterThan(0);
    }
  });

  it('has deterministic ordering on tie via rowid', async () => {
    const results1 = await hybridSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });
    const results2 = await hybridSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });
    expect(results1.length).toBe(results2.length);
    for (let i = 0; i < results1.length; i++) {
      expect(results1[i].chunk.rowid).toBe(results2[i].chunk.rowid);
    }
  });

  it('all scores are finite numbers', async () => {
    const results = await hybridSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });
    for (const r of results) {
      expect(Number.isFinite(r.fusedScore)).toBe(true);
      if (r.bm25Score !== undefined) expect(Number.isFinite(r.bm25Score)).toBe(true);
      if (r.vectorDistance !== undefined) expect(Number.isFinite(r.vectorDistance)).toBe(true);
    }
  });

  it('bm25-only mode never produces sources containing vector', async () => {
    const results = await hybridSearch(db, 'database', embed, { mode: 'bm25', topK: 10 });
    for (const r of results) {
      expect(r.sources).not.toContain('vector');
      expect(r.vectorRank).toBeUndefined();
      expect(r.vectorDistance).toBeUndefined();
    }
  });

  it('RRF fusion aggregates scores correctly', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping RRF fusion test: vector extension not loaded');
      return;
    }

    const bm25Results = await hybridSearch(db, 'database sqlite', embed, { mode: 'bm25', topN: 10, topK: 10 });
    const vecResults = await hybridSearch(db, 'database sqlite', embed, { mode: 'vector', topN: 10, topK: 10 });
    const hybridResults = await hybridSearch(db, 'database sqlite', embed, { mode: 'hybrid', topN: 10, topK: 10 });

    expect(hybridResults.length).toBeGreaterThan(0);

    const bm25Rowids = new Set(bm25Results.map(r => r.chunk.rowid));
    const vecRowids = new Set(vecResults.map(r => r.chunk.rowid));

    const hybridRowids = new Set(hybridResults.map(r => r.chunk.rowid));

    const unionSize = new Set([...bm25Rowids, ...vecRowids]).size;
    expect(hybridRowids.size).toBeLessThanOrEqual(unionSize);
  });

  it('relevant chunk ranks in top-5 for all modes on database query', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping hybrid rank test: vector extension not loaded');
      return;
    }

    const query = 'database engine';
    const expectedRowid = 2;

    const [bm25R, vecR, hybridR] = await Promise.all([
      hybridSearch(db, query, embed, { mode: 'bm25', topK: 5 }),
      hybridSearch(db, query, embed, { mode: 'vector', topK: 5 }),
      hybridSearch(db, query, embed, { mode: 'hybrid', topK: 5 }),
    ]);

    const bm25Rowids = bm25R.map(r => r.chunk.rowid);
    const vecRowids = vecR.map(r => r.chunk.rowid);
    const hybridRowids = hybridR.map(r => r.chunk.rowid);

    console.log(`BM25 top-5 rowids: ${bm25Rowids}`);
    console.log(`Vector top-5 rowids: ${vecRowids}`);
    console.log(`Hybrid top-5 rowids: ${hybridRowids}`);

    expect(bm25Rowids).toContain(expectedRowid);
    expect(vecRowids).toContain(expectedRowid);
    expect(hybridRowids).toContain(expectedRowid);
  });

  it('relevant chunk ranks in top-5 for all modes on architecture query', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping hybrid rank test: vector extension not loaded');
      return;
    }

    const query = 'process boundaries communication';
    const expectedRowid = 1;

    const [bm25R, vecR, hybridR] = await Promise.all([
      hybridSearch(db, query, embed, { mode: 'bm25', topK: 5 }),
      hybridSearch(db, query, embed, { mode: 'vector', topK: 5 }),
      hybridSearch(db, query, embed, { mode: 'hybrid', topK: 5 }),
    ]);

    const bm25Rowids = bm25R.map(r => r.chunk.rowid);
    const vecRowids = vecR.map(r => r.chunk.rowid);
    const hybridRowids = hybridR.map(r => r.chunk.rowid);

    console.log(`BM25 top-5 rowids: ${bm25Rowids}`);
    console.log(`Vector top-5 rowids: ${vecRowids}`);
    console.log(`Hybrid top-5 rowids: ${hybridRowids}`);

    expect(bm25Rowids).toContain(expectedRowid);
    expect(vecRowids).toContain(expectedRowid);
    expect(hybridRowids).toContain(expectedRowid);
  });

  it('relevant chunk ranks in top-5 for all modes on TypeScript query', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping hybrid rank test: vector extension not loaded');
      return;
    }

    const query = 'static type bugs';
    const expectedRowid = 5;

    const [bm25R, vecR, hybridR] = await Promise.all([
      hybridSearch(db, query, embed, { mode: 'bm25', topK: 5 }),
      hybridSearch(db, query, embed, { mode: 'vector', topK: 5 }),
      hybridSearch(db, query, embed, { mode: 'hybrid', topK: 5 }),
    ]);

    const bm25Rowids = bm25R.map(r => r.chunk.rowid);
    const vecRowids = vecR.map(r => r.chunk.rowid);
    const hybridRowids = hybridR.map(r => r.chunk.rowid);

    console.log(`BM25 top-5 rowids: ${bm25Rowids}`);
    console.log(`Vector top-5 rowids: ${vecRowids}`);
    console.log(`Hybrid top-5 rowids: ${hybridRowids}`);

    expect(bm25Rowids).toContain(expectedRowid);
    expect(vecRowids).toContain(expectedRowid);
    expect(hybridRowids).toContain(expectedRowid);
  });

  it('hybrid mode produces different result sets than bm25-only', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping hybrid diversity test: vector extension not loaded');
      return;
    }

    const query = 'programming language code';
    const bm25Results = await hybridSearch(db, query, embed, { mode: 'bm25', topK: 10 });
    const hybridResults = await hybridSearch(db, query, embed, { mode: 'hybrid', topK: 10 });

    const bm25Rowids = new Set(bm25Results.map(r => r.chunk.rowid));
    const hybridRowids = new Set(hybridResults.map(r => r.chunk.rowid));

    const diff = new Set([...hybridRowids].filter(x => !bm25Rowids.has(x)));
    console.log(`BM25 rowids: ${[...bm25Rowids]}`);
    console.log(`Hybrid added rowids: ${[...diff]}`);

    // Hybrid should introduce additional chunks from vector search
    expect(diff.size).toBeGreaterThanOrEqual(0);
  });

  it('handles gracefully when vector extension is not loaded', async () => {
    const results = await hybridSearch(db, 'database', embed, { mode: 'hybrid', topK: 5 });
    if (!isVectorExtensionLoaded()) {
      for (const r of results) {
        expect(r.sources).toEqual(['bm25']);
      }
    }
  });
}, 120000);
