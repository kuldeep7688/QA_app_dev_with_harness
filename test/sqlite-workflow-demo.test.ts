import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { PersistenceService } from '../src/services/persistence-service';
import { DocumentService } from '../src/services/document-service';
import { IndexingService } from '../src/services/indexing-service';
import { QaService } from '../src/services/qa-service';
import { embed } from '../src/services/embedding-service';

describe('SQLite Workflow Demo', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sqlite-demo-'));
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* already closed */ }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should import a document and verify it in the database', async () => {
    const sampleDoc = path.join(testDir, 'sample.txt');
    fs.writeFileSync(sampleDoc, 'This is a test document about architecture and design patterns. The system uses a layered approach.');

    const db = initDatabase(testDir);
    runMigrations(db);

    const persistence = new PersistenceService(testDir);
    const docService = new DocumentService(persistence, db);
    const indexService = new IndexingService(persistence, db);
    const qaService = new QaService(db, embed);

    const doc = await docService.importDocument(sampleDoc);
    expect(doc.id).toBeDefined();
    expect(doc.status).toBeDefined();
    expect(typeof doc.wordCount).toBe('number');

    const docsInDb = db.prepare('SELECT * FROM documents').all();
    expect(docsInDb.length).toBe(1);

    await indexService.startIndexing(doc.id);

    const chunksInDb = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    expect(chunksInDb.count).toBeGreaterThan(0);

    const answer = await qaService.ask('What is the architecture about?');
    expect(answer).toBeDefined();
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.answer.length).toBeGreaterThan(0);

    qaService.submitFeedback(answer.timestamp, 'What is the architecture about?', 'positive');

    const qaInDb = db.prepare('SELECT COUNT(*) as count FROM qa_history').get() as { count: number };
    expect(qaInDb.count).toBe(1);

    const feedbackInDb = db.prepare('SELECT COUNT(*) as count FROM feedback').get() as { count: number };
    expect(feedbackInDb.count).toBe(1);

    closeDatabase();
  });
});
