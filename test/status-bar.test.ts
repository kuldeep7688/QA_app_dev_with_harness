import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { PersistenceService } from '../src/services/persistence-service';
import { DocumentService } from '../src/services/document-service';
import { IndexingService } from '../src/services/indexing-service';

describe('Status Bar Indexing Status', () => {
  const tempRoot = path.join(os.tmpdir(), 'kb-statusbar-test-' + Date.now());
  let db: ReturnType<typeof initDatabase>;
  let persistence: PersistenceService;
  let documents: DocumentService;
  let indexing: IndexingService;
  let docIds: string[];

  beforeAll(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    db = initDatabase(tempRoot);
    runMigrations(db);
    persistence = new PersistenceService(tempRoot);
    documents = new DocumentService(persistence, db);
    indexing = new IndexingService(persistence, db);

    // Create sample documents
    const doc1Path = path.join(tempRoot, 'doc1.md');
    const doc2Path = path.join(tempRoot, 'doc2.txt');
    const doc3Path = path.join(tempRoot, 'doc3.md');
    fs.writeFileSync(doc1Path, '# Document 1\n\nFirst sample document for status bar testing.\n\nThis has multiple paragraphs so indexing can create chunks.', 'utf-8');
    fs.writeFileSync(doc2Path, 'Document 2\n\nSecond sample document with text format.\n\nAlso has multiple paragraphs for chunk generation.', 'utf-8');
    fs.writeFileSync(doc3Path, '# Document 3\n\nThird sample document.\n\nMore content for testing status transitions.', 'utf-8');

    const d1 = documents.importDocument(doc1Path);
    const d2 = documents.importDocument(doc2Path);
    const d3 = documents.importDocument(doc3Path);
    docIds = [d1.id, d2.id, d3.id];
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* already closed */ }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('Stage 1: 3 documents imported, none indexed', () => {
    const status = indexing.getStatus();
    expect(status.documentsLoaded).toBe(3);
    expect(status.indexStatus).toBe('idle');
    expect(status.indexedCount).toBe(0);
    expect(typeof status.lastActivity).toBe('string');
    expect(status.lastActivity.length).toBeGreaterThan(0);
  });

  it('Stage 2: 1 of 3 indexed shows indexing status', async () => {
    await indexing.startIndexing(docIds[0]);

    const status = indexing.getStatus();
    expect(status.documentsLoaded).toBe(3);
    expect(status.indexStatus).toBe('indexing');
    expect(status.indexedCount).toBe(1);
  });

  it('Stage 3: 2 of 3 indexed shows indexing status', async () => {
    await indexing.startIndexing(docIds[1]);

    const status = indexing.getStatus();
    expect(status.documentsLoaded).toBe(3);
    expect(status.indexStatus).toBe('indexing');
    expect(status.indexedCount).toBe(2);
  });

  it('Stage 4: all 3 indexed shows ready status', async () => {
    await indexing.startIndexing(docIds[2]);

    const status = indexing.getStatus();
    expect(status.documentsLoaded).toBe(3);
    expect(status.indexStatus).toBe('ready');
    expect(status.indexedCount).toBe(3);
  });

  it('Stage 5: lastActivity timestamp is recent', () => {
    const status = indexing.getStatus();
    const lastActivity = new Date(status.lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - lastActivity.getTime();
    expect(diffMs).toBeLessThan(1000);
  });
});
