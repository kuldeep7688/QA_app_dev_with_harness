import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase, resetDatabaseInstance } from '../src/services/db';

/**
 * Unit test: verify SQLite database initialization with WAL mode,
 * foreign keys enabled, and clean shutdown without leaks.
 */

const tempRoot = path.join(os.tmpdir(), 'kb-db-test-' + Date.now());
fs.mkdirSync(tempRoot, { recursive: true });

let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}${detail ? ' -- ' + detail : ''}`);
    failed++;
  }
}

async function run() {
  console.log('=== Database Initialization Test ===');

  // Test 1: Initialize database
  const db = initDatabase(tempRoot);
  check('Database initialized', !!db, 'db instance exists');

  // Test 2: Verify index.db file created
  const dbPath = path.join(tempRoot, 'index.db');
  check('index.db file created', fs.existsSync(dbPath));

  // Test 3: Check WAL mode
  const walResult = db.pragma('journal_mode', { simple: true });
  check('WAL mode enabled', walResult === 'wal', `got ${walResult}`);

  // Test 4: Check foreign keys enabled
  const fkResult = db.pragma('foreign_keys', { simple: true });
  check('Foreign keys enabled', fkResult === 1, `got ${fkResult}`);

  // Test 5: Get SQLite version
  const version = db.prepare('SELECT sqlite_version()').pluck().get() as string;
  check('SQLite version retrieved', version.length > 0, `version: ${version}`);

  // Test 6: Run integrity check
  const integrityCheck = db.pragma('integrity_check', { simple: true });
  check('Database integrity check', integrityCheck === 'ok', `got ${integrityCheck}`);

  // Test 7: Create a test table and insert data
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
  check('Test table write/read', result?.value === 'test-value', `got ${result?.value}`);

  // Test 8: Verify singleton behavior (calling initDatabase again returns same instance)
  const db2 = initDatabase(tempRoot);
  check('Singleton behavior', db === db2, 'same instance returned');

  // Test 9: Close database cleanly
  closeDatabase();
  check('Database closed', !db.open, 'db.open is false after close');

  // Test 10: Re-initialize database (should reopen)
  resetDatabaseInstance(); // Clear singleton for clean test
  const db3 = initDatabase(tempRoot);
  check('Database re-initialized', !!db3 && db3.open, 'db reopened successfully');
  
  // Verify data persists
  const selectStmt2 = db3.prepare('SELECT value FROM test_table WHERE id = 1');
  const result2 = selectStmt2.get() as { value: string } | undefined;
  check('Data persisted across close/reopen', result2?.value === 'test-value', `got ${result2?.value}`);

  // Clean up
  closeDatabase();
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log(`=== Test complete: ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
