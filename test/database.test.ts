import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase, resetDatabaseInstance } from '../src/services/db';

const tempRoot = path.join(os.tmpdir(), 'kb-db-test-' + Date.now());

describe('Database Initialization', () => {
  beforeAll(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* already closed */ }
    resetDatabaseInstance();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('should initialize database', () => {
    const db = initDatabase(tempRoot);
    expect(db).toBeDefined();
    expect(db.open).toBe(true);
  });

  it('should create index.db file', () => {
    const dbPath = path.join(tempRoot, 'index.db');
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('should enable WAL mode', () => {
    const db = initDatabase(tempRoot);
    const walResult = db.pragma('journal_mode', { simple: true });
    expect(walResult).toBe('wal');
  });

  it('should enable foreign keys', () => {
    const db = initDatabase(tempRoot);
    const fkResult = db.pragma('foreign_keys', { simple: true });
    expect(fkResult).toBe(1);
  });

  it('should retrieve SQLite version', () => {
    const db = initDatabase(tempRoot);
    const version = db.prepare('SELECT sqlite_version()').pluck().get() as string;
    expect(version.length).toBeGreaterThan(0);
  });

  it('should pass integrity check', () => {
    const db = initDatabase(tempRoot);
    const integrityCheck = db.pragma('integrity_check', { simple: true });
    expect(integrityCheck).toBe('ok');
  });

  it('should write and read from test table', () => {
    const db = initDatabase(tempRoot);
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_table (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    const insertStmt = db.prepare('INSERT INTO test_table (value) VALUES (?)');
    insertStmt.run('test-value');
    const selectStmt = db.prepare('SELECT value FROM test_table WHERE id = 1');
    const result = selectStmt.get() as { value: string } | undefined;
    expect(result?.value).toBe('test-value');
  });

  it('should return singleton instance on repeated calls', () => {
    const db1 = initDatabase(tempRoot);
    const db2 = initDatabase(tempRoot);
    expect(db2).toBe(db1);
  });

  it('should close database cleanly', () => {
    const db = initDatabase(tempRoot);
    closeDatabase();
    expect(db.open).toBe(false);
    resetDatabaseInstance();
  });

  it('should re-initialize database after close and persist data', () => {
    resetDatabaseInstance();
    const db = initDatabase(tempRoot);

    const selectStmt2 = db.prepare('SELECT value FROM test_table WHERE id = 1');
    const result2 = selectStmt2.get() as { value: string } | undefined;
    expect(result2?.value).toBe('test-value');
  });
});
