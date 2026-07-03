import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PersistenceService } from '../src/services/persistence-service';
import { DocumentService } from '../src/services/document-service';
import { IndexingService } from '../src/services/indexing-service';
import { QaService } from '../src/services/qa-service';
import { embed } from '../src/services/embedding-service';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';

describe('Data Persistence Across Service Restart', () => {
  const tempRoot = path.join(os.tmpdir(), 'kb-persistence-test-' + Date.now());
  const dataDir = path.join(tempRoot, 'data');

  beforeAll(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    const srcPath = path.join(tempRoot, 'persistence-sample.md');
    const srcContent = `# Persistence Sample\n\nThis document is used to verify that the knowledge base correctly persists imported documents, indexed chunks, Q&A history, and feedback across application restarts.\n\nIt contains multiple paragraphs so the indexing service can produce at least one chunk and the Q&A service can retrieve a citation when asked about persistence and design.\n\nThe second paragraph mentions architecture and design so the keyword retrieval path is exercised.`;
    fs.writeFileSync(srcPath, srcContent, 'utf-8');
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* already closed */ }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('Session 1: writes data (document, chunks, Q&A, feedback)', async () => {
    const persistence = new PersistenceService(dataDir);
    const db = initDatabase(dataDir);
    runMigrations(db);

    const documents = new DocumentService(persistence, db);
    const indexing = new IndexingService(persistence, db);
    const qa = new QaService(db, embed);

    const srcPath = path.join(tempRoot, 'persistence-sample.md');
    const doc = documents.importDocument(srcPath);
    expect(doc.id).toBeDefined();

    await indexing.startIndexing(doc.id);
    const chunks = indexing.getChunksForDocument(doc.id);
    expect(chunks.length).toBeGreaterThan(0);

    const resp = await qa.ask('What does the document say about architecture and design?');
    expect(resp.citations.length).toBeGreaterThan(0);

    qa.submitFeedback(resp.timestamp, 'What does the document say about architecture and design?', 'positive');
    const fb = qa.getFeedback();
    expect(fb.length).toBe(1);

    // Verify on-disk files
    expect(fs.existsSync(path.join(dataDir, 'index.db'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'content')) && fs.readdirSync(path.join(dataDir, 'content')).length > 0).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'documents')) && fs.readdirSync(path.join(dataDir, 'documents')).length > 0).toBe(true);

    // Save docId for next test
    (globalThis as any).__persistenceDocId = doc.id;
    (globalThis as any).__persistenceTimestamp = resp.timestamp;

    closeDatabase();
  });

  it('Session 2: re-instantiates services and verifies data persists', async () => {
    const persistence = new PersistenceService(dataDir);
    const db = initDatabase(dataDir);
    runMigrations(db);

    const documents = new DocumentService(persistence, db);
    const indexing = new IndexingService(persistence, db);
    const qa = new QaService(db, embed);

    const docId = (globalThis as any).__persistenceDocId;

    const docs = documents.listDocuments();
    expect(docs.length).toBe(1);
    expect(docs[0]?.id).toBe(docId);
    expect(docs[0]?.status).toBe('indexed');
    expect(typeof docs[0]?.wordCount).toBe('number');
    expect((docs[0]?.wordCount ?? 0)).toBeGreaterThan(0);

    const chunks = indexing.getAllChunks();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.documentId === docId)).toBe(true);

    const status = indexing.getStatus();
    expect(status.indexStatus).toBe('ready');
    expect(status.indexedCount).toBe(1);

    const history = qa.getHistory();
    expect(history.length).toBe(1);
    expect((history[0]?.response.citations.length ?? 0)).toBeGreaterThan(0);
    expect(history[0]?.question).toContain('architecture');

    const fb = qa.getFeedback();
    expect(fb.length).toBe(1);
    expect(fb[0]?.rating).toBe('positive');
    expect(fb[0]?.responseTimestamp).toBe((globalThis as any).__persistenceTimestamp);

    closeDatabase();
  });
});
