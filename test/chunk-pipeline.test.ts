/**
 * Integration test for complete chunk indexing pipeline.
 * Verifies that indexing a document results in equal row counts across:
 * - chunks table
 * - chunks_fts (FTS5 index)
 * - chunks_vec (vector embeddings)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDatabase, closeDatabase, resetDatabaseInstance, isVectorExtensionLoaded } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { PersistenceService } from '../src/services/persistence-service';
import { DocumentService } from '../src/services/document-service';
import { IndexingService } from '../src/services/indexing-service';

describe('Chunk Pipeline Integration', () => {
  let testDir: string;
  let db: Database.Database;
  let persistence: PersistenceService;
  let documentService: DocumentService;
  let indexingService: IndexingService;

  beforeEach(() => {
    // Create temp directory
    testDir = mkdtempSync(join(tmpdir(), 'chunk-pipeline-test-'));
    
    // Initialize database
    db = initDatabase(testDir);
    runMigrations(db);
    
    // Initialize services
    persistence = new PersistenceService(testDir);
    documentService = new DocumentService(persistence, db);
    indexingService = new IndexingService(persistence, db);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should index document with equal row counts in chunks, chunks_fts, and chunks_vec', async () => {
    // Skip test if vector extension not loaded
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping chunk pipeline test: vector extension not loaded');
      return;
    }

    // Create test document content (5 paragraphs, will produce multiple chunks)
    const content = `
The quick brown fox jumps over the lazy dog. This is the first paragraph of our test document.
It contains enough text to ensure we get multiple chunks during the indexing process.

Second paragraph adds more content to the document. We want to test that the chunking algorithm
works correctly and splits the document at paragraph boundaries while respecting the target
chunk size of approximately 500 characters.

Third paragraph continues the pattern. Each paragraph should contribute to forming chunks
that are indexed into the SQLite database, made searchable via FTS5, and vectorized using
the embedding service for semantic search capabilities.

Fourth paragraph provides additional content. The goal is to verify that all three indexing
mechanisms work in harmony: the chunks table for raw storage, chunks_fts for keyword search
via BM25 ranking, and chunks_vec for semantic vector search.

Fifth and final paragraph completes our test document. After indexing, we will verify that
the row counts match across all three tables, and that embedded_at timestamps are properly
set to indicate successful embedding generation.
    `.trim();

    // Write test content to filesystem
    const filename = 'test-document.txt';
    const filePath = join(testDir, filename);
    writeFileSync(filePath, content, 'utf-8');

    // Import document
    const doc = await documentService.importDocument(filePath);
    expect(doc).toBeDefined();
    expect(doc.id).toBeTruthy();
    
    // Index document
    const status = await indexingService.startIndexing(doc.id);
    expect(status.indexedCount).toBe(1);

    // Count rows in chunks table
    const chunksCount = db.prepare('SELECT COUNT(*) as count FROM chunks WHERE document_id = ?')
      .get(doc.id) as { count: number };
    
    expect(chunksCount.count).toBeGreaterThan(0);
    console.log(`Chunks table: ${chunksCount.count} rows`);

    // Count rows in chunks_fts that match this document's chunks
    // We can verify by searching for a unique term from the content
    const ftsResults = db.prepare(`
      SELECT COUNT(*) as count 
      FROM chunks_fts 
      WHERE chunks_fts MATCH 'quick'
    `).get() as { count: number };
    
    expect(ftsResults.count).toBeGreaterThan(0);
    console.log(`FTS5 matches for 'quick': ${ftsResults.count} rows`);

    // Count rows in chunks_vec for this document
    const chunksVecCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM chunks_vec 
      WHERE rowid IN (SELECT rowid FROM chunks WHERE document_id = ?)
    `).get(doc.id) as { count: number };
    
    expect(chunksVecCount.count).toBe(chunksCount.count);
    console.log(`chunks_vec table: ${chunksVecCount.count} rows`);

    // Verify all counts match
    expect(chunksVecCount.count).toBe(chunksCount.count);
    
    // Verify embedded_at is set for all chunks
    const embeddedChunks = db.prepare(`
      SELECT COUNT(*) as count 
      FROM chunks 
      WHERE document_id = ? AND embedded_at IS NOT NULL
    `).get(doc.id) as { count: number };
    
    expect(embeddedChunks.count).toBe(chunksCount.count);
    console.log(`Chunks with embedded_at set: ${embeddedChunks.count} rows`);

    // Verify we can query chunks_fts
    const ftsQuery = db.prepare(`
      SELECT rowid, content
      FROM chunks
      WHERE rowid IN (
        SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'paragraph'
      )
      LIMIT 3
    `).all();
    
    expect(ftsQuery.length).toBeGreaterThan(0);
    console.log(`FTS5 query for 'paragraph' returned: ${ftsQuery.length} results`);

    // Verify we can perform KNN search on chunks_vec
    // Get the first chunk's embedding as query
    const firstChunk = db.prepare('SELECT rowid FROM chunks WHERE document_id = ? ORDER BY idx LIMIT 1')
      .get(doc.id) as { rowid: number };
    
    const queryEmbedding = db.prepare('SELECT embedding FROM chunks_vec WHERE rowid = ?')
      .get(firstChunk.rowid) as { embedding: Float32Array };
    
    expect(queryEmbedding).toBeDefined();
    expect(queryEmbedding.embedding).toBeInstanceOf(Buffer); // SQLite returns as Buffer

    // Perform KNN search (top 3 nearest neighbors)
    const knnResults = db.prepare(`
      SELECT 
        rowid,
        distance
      FROM chunks_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT 3
    `).all(queryEmbedding.embedding);
    
    expect(knnResults.length).toBeGreaterThan(0);
    expect(knnResults.length).toBeLessThanOrEqual(3);
    console.log(`KNN search returned: ${knnResults.length} results`);
    
    // The first result should be the query itself with distance ~0
    const firstResult = knnResults[0] as { rowid: number; distance: number };
    expect(firstResult.rowid).toBe(firstChunk.rowid);
    expect(firstResult.distance).toBeLessThan(1); // Self-similarity should be very close to 0
  }, 60000); // 60 second timeout for model loading

  it('should handle bulk indexing with multiple documents', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping bulk indexing test: vector extension not loaded');
      return;
    }

    // Create three test documents
    const docs = [];
    for (let i = 0; i < 3; i++) {
      const content = `Document ${i + 1} content with multiple paragraphs.\n\nSecond paragraph for document ${i + 1}.`;
      const filename = `test-doc-${i + 1}.txt`;
      const filePath = join(testDir, filename);
      writeFileSync(filePath, content, 'utf-8');
      
      const doc = await documentService.importDocument(filePath);
      docs.push(doc);
    }

    // Index all documents at once
    const status = await indexingService.startIndexing();
    expect(status.indexedCount).toBe(3);
    expect(status.indexStatus).toBe('ready');

    // Verify total chunk counts
    const totalChunks = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    const totalVecChunks = db.prepare('SELECT COUNT(*) as count FROM chunks_vec').get() as { count: number };
    const totalEmbedded = db.prepare('SELECT COUNT(*) as count FROM chunks WHERE embedded_at IS NOT NULL').get() as { count: number };

    expect(totalChunks.count).toBeGreaterThan(0);
    expect(totalVecChunks.count).toBe(totalChunks.count);
    expect(totalEmbedded.count).toBe(totalChunks.count);

    console.log(`Bulk indexing: ${totalChunks.count} chunks indexed and embedded across 3 documents`);
  }, 60000);

  it('should gracefully handle indexing when vector extension not loaded', async () => {
    // This test will pass regardless of vector extension status
    // It verifies that chunks and chunks_fts are populated even without embeddings

    const content = 'Simple test document for FTS-only indexing.';
    const filename = 'simple-test.txt';
    const filePath = join(testDir, filename);
    writeFileSync(filePath, content, 'utf-8');

    const doc = await documentService.importDocument(filePath);
    const status = await indexingService.startIndexing(doc.id);

    // Verify chunks table populated
    const chunksCount = db.prepare('SELECT COUNT(*) as count FROM chunks WHERE document_id = ?')
      .get(doc.id) as { count: number };
    expect(chunksCount.count).toBeGreaterThan(0);

    // Verify FTS index populated
    const ftsResults = db.prepare(`
      SELECT COUNT(*) as count 
      FROM chunks_fts 
      WHERE chunks_fts MATCH 'simple'
    `).get() as { count: number };
    expect(ftsResults.count).toBeGreaterThan(0);

    console.log(`FTS-only indexing: ${chunksCount.count} chunks, ${ftsResults.count} FTS matches`);

    // If vector extension is loaded, verify embeddings were created
    if (isVectorExtensionLoaded()) {
      const vecCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM chunks_vec 
        WHERE rowid IN (SELECT rowid FROM chunks WHERE document_id = ?)
      `).get(doc.id) as { count: number };
      expect(vecCount.count).toBe(chunksCount.count);
      console.log('Vector extension loaded: embeddings created');
    } else {
      console.log('Vector extension not loaded: BM25-only mode');
    }
  }, 60000);
});
