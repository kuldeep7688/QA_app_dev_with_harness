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

describe('Rebuild Embeddings', () => {
  let testDir: string;
  let db: Database.Database;
  let persistence: PersistenceService;
  let documentService: DocumentService;
  let indexingService: IndexingService;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'rebuild-embeddings-test-'));
    db = initDatabase(testDir);
    runMigrations(db);
    persistence = new PersistenceService(testDir);
    documentService = new DocumentService(persistence, db);
    indexingService = new IndexingService(persistence, db);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should rebuild embeddings after deleting chunks_vec rows', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping: vector extension not loaded');
      return;
    }

    const content = 'Rebuild embeddings test document. Multiple paragraphs for chunking.\n\nSecond paragraph with more content.\n\nThird paragraph to ensure multiple chunks.';
    const filePath = join(testDir, 'test.txt');
    writeFileSync(filePath, content, 'utf-8');

    // Import and index
    const doc = await documentService.importDocument(filePath);
    await indexingService.startIndexing(doc.id);

    const chunksBefore = db.prepare('SELECT COUNT(*) as c FROM chunks').get() as { c: number };
    const vecBefore = db.prepare('SELECT COUNT(*) as c FROM chunks_vec').get() as { c: number };
    expect(chunksBefore.c).toBe(vecBefore.c);
    const chunkCount = chunksBefore.c;

    // Delete vector rows
    db.prepare('DELETE FROM chunks_vec').run();
    db.prepare('UPDATE chunks SET embedded_at = NULL').run();

    const vecAfterDelete = db.prepare('SELECT COUNT(*) as c FROM chunks_vec').get() as { c: number };
    expect(vecAfterDelete.c).toBe(0);

    // Rebuild
    const progressEvents: { processed: number; total: number }[] = [];
    const status = await indexingService.rebuildEmbeddings((p, t) => progressEvents.push({ processed: p, total: t }));

    // Verify embeddings restored
    const vecAfterRebuild = db.prepare('SELECT COUNT(*) as c FROM chunks_vec').get() as { c: number };
    expect(vecAfterRebuild.c).toBe(chunkCount);

    const embeddedCount = db.prepare('SELECT COUNT(*) as c FROM chunks WHERE embedded_at IS NOT NULL').get() as { c: number };
    expect(embeddedCount.c).toBe(chunkCount);

    // Verify progress events
    expect(progressEvents.length).toBeGreaterThan(0);
    const lastEvent = progressEvents[progressEvents.length - 1];
    expect(lastEvent.processed).toBe(chunkCount);
    expect(lastEvent.total).toBe(chunkCount);

    expect(status.vectorEnabled).toBe(true);
    console.log(`Rebuild complete: ${vecAfterRebuild.c} embeddings, ${progressEvents.length} progress events`);
  }, 60000);

  it('should be idempotent when run twice', async () => {
    if (!isVectorExtensionLoaded()) {
      console.warn('Skipping: vector extension not loaded');
      return;
    }

    const content = 'Idempotency test document.';
    const filePath = join(testDir, 'test.txt');
    writeFileSync(filePath, content, 'utf-8');

    const doc = await documentService.importDocument(filePath);
    await indexingService.startIndexing(doc.id);

    // Run rebuild twice
    const status1 = await indexingService.rebuildEmbeddings();
    const status2 = await indexingService.rebuildEmbeddings();

    // Both should produce same vector row count
    const vecRow = db.prepare('SELECT COUNT(*) as c FROM chunks_vec').get() as { c: number };
    const chkRow = db.prepare('SELECT COUNT(*) as c FROM chunks').get() as { c: number };
    expect(vecRow.c).toBe(chkRow.c);
    expect(status1.indexedCount).toBe(status2.indexedCount);

    console.log(`Idempotent: ${vecRow.c} vector rows after 2 runs`);
  }, 60000);

  it('should return status when no chunks exist', async () => {
    const status = await indexingService.rebuildEmbeddings();
    expect(status.documentsLoaded).toBe(0);
    expect(status.indexStatus).toBe('idle');
  });
});
