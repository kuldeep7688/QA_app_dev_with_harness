/**
 * Test: Verify migrations are loaded from dist/
 */

import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

console.log('=== Migration Loading Test ===\n');

// Create test directory
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-migration-test-'));
console.log(`Test directory: ${testDir}\n`);

// Initialize database
const db = initDatabase(testDir);

console.log('Running migrations...');
runMigrations(db);

// Check schema version
const versionRow = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version') as { value: string };
console.log(`✓ Schema version: ${versionRow.value}\n`);

// Check tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
console.log('Tables created:');
for (const table of tables) {
  console.log(`  - ${table.name}`);
}
console.log();

closeDatabase();

// Cleanup
fs.rmSync(testDir, { recursive: true });

console.log('=== Test Complete ===');
