import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Migration Loading', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-migration-test-'));
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* already closed */ }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should run migrations and set schema version', () => {
    const db = initDatabase(testDir);
    runMigrations(db);

    const versionRow = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version') as { value: string };
    expect(versionRow).toBeDefined();
    expect(versionRow.value).toBeDefined();
    expect(parseInt(versionRow.value, 10)).toBeGreaterThanOrEqual(1);

    closeDatabase();
  });

  it('should create expected tables', () => {
    const db = initDatabase(testDir);
    runMigrations(db);

    const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);

    expect(tableNames).toContain('schema_meta');
    expect(tableNames).toContain('documents');
    expect(tableNames).toContain('chunks');
    expect(tableNames).toContain('qa_history');
    expect(tableNames).toContain('feedback');

    closeDatabase();
  });
});
