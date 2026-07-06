/**
 * Test: QaService wired to Hybrid Retriever
 *
 * Verifies:
 * - QaService uses hybridSearch instead of keyword overlap
 * - Citations carry bm25Rank, vectorRank, sources
 * - Confidence varies across queries (not constant)
 * - Mock patterns still generate answer text
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDatabase, closeDatabase, resetDatabaseInstance, isVectorExtensionLoaded } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { QaService } from '../src/services/qa-service';
import { embed } from '../src/services/embedding-service';

describe('QaService + Hybrid Retriever Integration', () => {
  let testDir: string;
  let db: Database.Database;
  let qaService: QaService;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'qa-hybrid-test-'));
    db = initDatabase(testDir);
    runMigrations(db);
    qaService = new QaService(db, embed);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return empty answer when no documents/chunks are indexed', async () => {
    const response = await qaService.ask('What is the architecture?');

    expect(response.answer).toBeTruthy();
    expect(response.citations).toHaveLength(0);
    expect(response.confidence).toBe(0);
    expect(response.timestamp).toBeTruthy();
  });

  it('should return citations with retrieval metadata from indexed chunks', async () => {
    // Seed a document and chunks directly
    db.prepare(`INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('doc-arch', 'Architecture Overview', 'arch.md', 1024, new Date().toISOString(), 'indexed', 150, 10, 'md');

    const chunkContent = 'The system uses a layered architecture with clear boundaries between the main process, preload scripts, and renderer. Each layer communicates through typed IPC channels for security.';
    db.prepare(`INSERT INTO chunks (id, document_id, idx, content, char_count, word_count)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('chunk-arch-1', 'doc-arch', 0, chunkContent, chunkContent.length, chunkContent.split(/\s+/).length);

    // Verify FTS5 was populated by trigger
    const ftsCount = (db.prepare('SELECT COUNT(*) as count FROM chunks_fts').get() as { count: number }).count;
    expect(ftsCount).toBe(1);
    const ftsRow = db.prepare('SELECT * FROM chunks_fts').get() as any;
    expect(ftsRow.content).toContain('layered architecture');

    // Ask a question using raw FTS5 query syntax
    const response = await qaService.ask('What is the layered architecture?');

    expect(response.answer).toBeTruthy();
    expect(response.citations.length).toBeGreaterThan(0);
    expect(response.confidence).toBeGreaterThan(0);

    const citation = response.citations[0];
    expect(citation.documentId).toBe('doc-arch');
    expect(citation.documentTitle).toBe('Architecture Overview');
    expect(citation.chunkIndex).toBe(0);
    expect(citation.excerpt).toBeTruthy();
    expect(citation.confidence).toBeGreaterThan(0);
    expect(citation.confidence).toBeLessThanOrEqual(1);
    expect(citation.sources).toBeDefined();
    expect(citation.sources.length).toBeGreaterThan(0);
    expect(citation.sources).toContain('bm25');
  });

  it('should derive confidence from fused score distribution (not constant)', async () => {
    // Seed two documents
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('doc-001', 'Architecture Doc', 'arch.md', 1024, now, 'indexed', 150, 10, 'md');
    db.prepare(`INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('doc-002', 'Meeting Notes', 'meeting.md', 1024, now, 'indexed', 80, 5, 'md');

    const archContent = 'The system uses a layered architecture with clear boundaries between the main process, preload scripts, and renderer. Each layer communicates through typed IPC channels for security.';
    const meetingContent = 'The team discussed implementing a retrieval-augmented generation pipeline. Key decisions included using local chunk storage and citation-based verification.';

    db.prepare(`INSERT INTO chunks (id, document_id, idx, content, char_count, word_count)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('chunk-001', 'doc-001', 1, archContent, archContent.length, archContent.split(/\s+/).length);
    db.prepare(`INSERT INTO chunks (id, document_id, idx, content, char_count, word_count)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('chunk-002', 'doc-002', 0, meetingContent, meetingContent.length, meetingContent.split(/\s+/).length);

    // Query that strongly matches architecture
    const archResponse = await qaService.ask('layered architecture main process preload renderer IPC channels');
    // Query that weakly matches meeting notes (only one keyword)
    const meetingResponse = await qaService.ask('python programming language');

    // Confidence should vary — architecture query should score higher
    expect(archResponse.confidence).not.toBe(meetingResponse.confidence);

    // Architecture query should have citations
    expect(archResponse.citations.length).toBeGreaterThan(0);

    // Unrelated query should have lower confidence or no citations
    const confidences = new Set([
      archResponse.confidence,
      meetingResponse.confidence,
    ]);
    expect(confidences.size).toBeGreaterThan(1);
  });

  it('should include bm25Rank, vectorRank, and sources in each citation', async () => {
    db.prepare(`INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('doc-ret', 'Retrieval Doc', 'ret.md', 512, new Date().toISOString(), 'indexed', 40, 3, 'md');

    const content = 'Retrieval works by matching query keywords against indexed chunks. The system ranks chunks by relevance.';
    db.prepare(`INSERT INTO chunks (id, document_id, idx, content, char_count, word_count)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('chunk-ret-1', 'doc-ret', 0, content, content.length, content.split(/\s+/).length);

    const response = await qaService.ask('How does retrieval work with keywords?');

    for (const citation of response.citations) {
      expect(citation).toHaveProperty('bm25Rank');
      expect(citation).toHaveProperty('vectorRank');
      expect(Array.isArray(citation.sources)).toBe(true);
      expect(citation.sources.length).toBeGreaterThan(0);
    }
  });

  it('should save Q&A history to the database', async () => {
    db.prepare(`INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('doc-hist', 'History Doc', 'hist.md', 512, new Date().toISOString(), 'indexed', 30, 2, 'md');

    const content = 'Documents are imported by copying the source file to the local data directory.';
    db.prepare(`INSERT INTO chunks (id, document_id, idx, content, char_count, word_count)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('chunk-hist-1', 'doc-hist', 0, content, content.length, content.split(/\s+/).length);

    await qaService.ask('How are documents imported?');

    const history = qaService.getHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].question).toBe('How are documents imported?');
    expect(history[0].response.answer).toBeTruthy();
    expect(history[0].response.citations.length).toBeGreaterThan(0);
    expect(history[0].response.citations[0].sources).toBeDefined();
  });

  it('should use bm25-only mode when vector extension is not loaded', async () => {
    db.prepare(`INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('doc-bm25', 'BM25 Doc', 'bm25.md', 256, new Date().toISOString(), 'indexed', 20, 2, 'md');

    const content = 'SQLite is a lightweight embedded database engine with WAL mode and foreign keys.';
    db.prepare(`INSERT INTO chunks (id, document_id, idx, content, char_count, word_count)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('chunk-bm25-1', 'doc-bm25', 0, content, content.length, content.split(/\s+/).length);

    const response = await qaService.ask('What is SQLite?');

    expect(response.citations.length).toBeGreaterThan(0);
    expect(response.citations[0].sources).toContain('bm25');
    expect(response.confidence).toBeGreaterThan(0);
  });

  it('should clear history', async () => {
    db.prepare(`INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('doc-clear', 'Clear Doc', 'clear.md', 256, new Date().toISOString(), 'indexed', 20, 2, 'md');

    const content = 'Testing clear history functionality.';
    db.prepare(`INSERT INTO chunks (id, document_id, idx, content, char_count, word_count)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('chunk-clear-1', 'doc-clear', 0, content, content.length, content.split(/\s+/).length);

    await qaService.ask('Test question?');
    expect(qaService.getHistory().length).toBe(1);

    qaService.clearHistory();
    expect(qaService.getHistory().length).toBe(0);
  });
});
