import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { PersistenceService } from '../src/services/persistence-service';
import { DocumentService } from '../src/services/document-service';
import { IndexingService } from '../src/services/indexing-service';

const TEST_DIR = path.join(os.tmpdir(), 'kb-indexing-status-test-' + Date.now());

describe('Indexing Status UI', () => {
  let documentService: DocumentService;
  let indexingService: IndexingService;

  beforeAll(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const db = initDatabase(TEST_DIR);
    runMigrations(db);
    const persistence = new PersistenceService(TEST_DIR);
    documentService = new DocumentService(persistence, db);
    indexingService = new IndexingService(persistence, db);
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* already closed */ }
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('initial state has zero documents and idle status', () => {
    const status = indexingService.getStatus();
    expect(status.documentsLoaded).toBe(0);
    expect(status.indexedCount).toBe(0);
    expect(status.indexStatus).toBe('idle');
  });

  it('imports 3 documents without indexing', async () => {
    const testDoc1 = path.join(TEST_DIR, 'test-doc-1.txt');
    const testDoc2 = path.join(TEST_DIR, 'test-doc-2.txt');
    const testDoc3 = path.join(TEST_DIR, 'test-doc-3.txt');

    fs.writeFileSync(testDoc1, 'This is test document 1. It has some content.\n\nParagraph 2.');
    fs.writeFileSync(testDoc2, 'This is test document 2. Different content here.\n\nMore text.');
    fs.writeFileSync(testDoc3, 'This is test document 3. Yet another document.\n\nFinal paragraph.');

    await documentService.importDocument(testDoc1);
    await documentService.importDocument(testDoc2);
    await documentService.importDocument(testDoc3);

    const status = indexingService.getStatus();
    expect(status.documentsLoaded).toBe(3);
    expect(status.indexedCount).toBe(0);
    expect(status.indexStatus).toBe('idle');
  });

  it('indexing one document shows 1 of 3 indexed', async () => {
    const docs = documentService.listDocuments();
    await indexingService.startIndexing(docs[0].id);

    const status = indexingService.getStatus();
    expect(status.documentsLoaded).toBe(3);
    expect(status.indexedCount).toBe(1);
    expect(status.indexStatus).toBe('indexing');
  });

  it('indexing second document shows 2 of 3 indexed', async () => {
    const docs = documentService.listDocuments();
    await indexingService.startIndexing(docs[1].id);

    const status = indexingService.getStatus();
    expect(status.documentsLoaded).toBe(3);
    expect(status.indexedCount).toBe(2);
    expect(status.indexStatus).toBe('indexing');
  });

  it('indexing all documents shows ready status', async () => {
    const docs = documentService.listDocuments();
    await indexingService.startIndexing(docs[2].id);

    const status = indexingService.getStatus();
    expect(status.documentsLoaded).toBe(3);
    expect(status.indexedCount).toBe(3);
    expect(status.indexStatus).toBe('ready');
  });

  it('deleting an indexed document updates document count', () => {
    const docs = documentService.listDocuments();
    documentService.deleteDocument(docs[0].id);

    const status = indexingService.getStatus();
    expect(status.documentsLoaded).toBe(2);
  });
});
