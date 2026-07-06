import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, closeDatabase, resetDatabaseInstance } from '../src/services/db.js';
import { runMigrations } from '../src/services/migrations/runner.js';

describe('Schema Migrations', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), 'kb-migration-test-'));
  });

  afterAll(() => {
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create schema_meta table and set version to 1 after first run', () => {
    const db = initDatabase(testDir);
    runMigrations(db);

    const versionRow = db.prepare("SELECT value FROM schema_meta WHERE key = ?").get('version') as { value: string } | undefined;
    expect(versionRow).toBeDefined();
    expect(parseInt(versionRow.value, 10)).toBeGreaterThanOrEqual(4);

    closeDatabase();
    resetDatabaseInstance();
  });

  it('should create all required tables with correct columns', () => {
    const db = initDatabase(testDir);
    runMigrations(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('schema_meta');
    expect(tableNames).toContain('documents');
    expect(tableNames).toContain('chunks');
    expect(tableNames).toContain('qa_history');
    expect(tableNames).toContain('feedback');

    // Check documents columns
    const documentsInfo = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string; type: string }>;
    const docColumns = documentsInfo.map(c => c.name);
    expect(docColumns).toContain('id');
    expect(docColumns).toContain('title');
    expect(docColumns).toContain('filename');
    expect(docColumns).toContain('status');
    expect(docColumns).toContain('imported_at');

    // Check chunks columns
    const chunksInfo = db.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string; type: string }>;
    const chunkColumns = chunksInfo.map(c => c.name);
    expect(chunkColumns).toContain('id');
    expect(chunkColumns).toContain('document_id');
    expect(chunkColumns).toContain('idx');
    expect(chunkColumns).toContain('content');

    // Check index exists
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='chunks_doc_idx'").all() as Array<{ name: string }>;
    expect(indexes.length).toBe(1);

    // Check qa_history columns
    const qaInfo = db.prepare("PRAGMA table_info(qa_history)").all() as Array<{ name: string; type: string }>;
    const qaColumns = qaInfo.map(c => c.name);
    expect(qaColumns).toContain('id');
    expect(qaColumns).toContain('question');
    expect(qaColumns).toContain('answer');

    // Check feedback columns
    const feedbackInfo = db.prepare("PRAGMA table_info(feedback)").all() as Array<{ name: string; type: string }>;
    const feedbackColumns = feedbackInfo.map(c => c.name);
    expect(feedbackColumns).toContain('id');
    expect(feedbackColumns).toContain('rating');

    closeDatabase();
    resetDatabaseInstance();
  });

  it('should be idempotent (second run does not change version)', () => {
    const db = initDatabase(testDir);
    runMigrations(db);

    const versionRow2 = db.prepare("SELECT value FROM schema_meta WHERE key = ?").get('version') as { value: string };
    expect(versionRow2.value).toBe('6');

    const tables2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    expect(tables2.length).toBeGreaterThanOrEqual(5);

    closeDatabase();
    resetDatabaseInstance();
  });

  it('should enforce foreign key constraint with CASCADE delete', () => {
    const db = initDatabase(testDir);
    runMigrations(db);

    db.prepare("INSERT INTO documents (id, title, filename, size, imported_at, status) VALUES (?, ?, ?, ?, ?, ?)").run(
      'test-doc-1', 'Test Document', 'test.txt', 100, new Date().toISOString(), 'indexed'
    );

    db.prepare("INSERT INTO chunks (id, document_id, idx, content) VALUES (?, ?, ?, ?)").run(
      'test-chunk-1', 'test-doc-1', 0, 'Test chunk content'
    );

    const chunksBefore = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    expect(chunksBefore.count).toBe(1);

    db.prepare('DELETE FROM documents WHERE id = ?').run('test-doc-1');

    const chunksAfter = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    expect(chunksAfter.count).toBe(0);

    closeDatabase();
    resetDatabaseInstance();
  });
});
