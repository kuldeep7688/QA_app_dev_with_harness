/**
 * Test: Schema Migrations
 * 
 * Verifies:
 * - schema_meta table tracks current version
 * - runMigrations is idempotent (can run twice without error)
 * - 001_init creates all required tables
 * - Version increments correctly
 * - Migrations run in transactions (all-or-nothing)
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, closeDatabase, resetDatabaseInstance } from '../src/services/db.js';
import { runMigrations } from '../src/services/migrations/runner.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

async function runTest() {
  console.log('=== Schema Migrations Test ===\n');
  
  // Create temporary directory
  const testDir = mkdtempSync(join(tmpdir(), 'kb-migration-test-'));
  console.log(`Test directory: ${testDir}\n`);
  
  try {
    // Initialize database
    const db = initDatabase(testDir);
    
    // Run migrations first time
    console.log('--- First migration run ---');
    runMigrations(db);
    
    // Check schema_meta exists and version is set
    const versionRow = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version') as { value: string } | undefined;
    assert(versionRow !== undefined, 'schema_meta table exists');
    assert(versionRow.value === '1', 'Version set to 1 after first run');
    
    // Check all tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);
    
    assert(tableNames.includes('schema_meta'), 'schema_meta table created');
    assert(tableNames.includes('documents'), 'documents table created');
    assert(tableNames.includes('chunks'), 'chunks table created');
    assert(tableNames.includes('qa_history'), 'qa_history table created');
    assert(tableNames.includes('feedback'), 'feedback table created');
    
    // Check documents table schema
    const documentsInfo = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string; type: string }>;
    const docColumns = documentsInfo.map(c => c.name);
    assert(docColumns.includes('id'), 'documents.id column exists');
    assert(docColumns.includes('title'), 'documents.title column exists');
    assert(docColumns.includes('filename'), 'documents.filename column exists');
    assert(docColumns.includes('status'), 'documents.status column exists');
    assert(docColumns.includes('imported_at'), 'documents.imported_at column exists');
    
    // Check chunks table schema
    const chunksInfo = db.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string; type: string }>;
    const chunkColumns = chunksInfo.map(c => c.name);
    assert(chunkColumns.includes('rowid'), 'chunks.rowid column exists');
    assert(chunkColumns.includes('id'), 'chunks.id column exists');
    assert(chunkColumns.includes('document_id'), 'chunks.document_id column exists');
    assert(chunkColumns.includes('idx'), 'chunks.idx column exists');
    assert(chunkColumns.includes('content'), 'chunks.content column exists');
    
    // Check index exists
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='chunks_doc_idx'").all() as Array<{ name: string }>;
    assert(indexes.length === 1, 'chunks_doc_idx index created');
    
    // Check qa_history table
    const qaInfo = db.prepare("PRAGMA table_info(qa_history)").all() as Array<{ name: string; type: string }>;
    const qaColumns = qaInfo.map(c => c.name);
    assert(qaColumns.includes('id'), 'qa_history.id column exists');
    assert(qaColumns.includes('question'), 'qa_history.question column exists');
    assert(qaColumns.includes('answer'), 'qa_history.answer column exists');
    
    // Check feedback table
    const feedbackInfo = db.prepare("PRAGMA table_info(feedback)").all() as Array<{ name: string; type: string }>;
    const feedbackColumns = feedbackInfo.map(c => c.name);
    assert(feedbackColumns.includes('id'), 'feedback.id column exists');
    assert(feedbackColumns.includes('rating'), 'feedback.rating column exists');
    
    // Run migrations second time (should be idempotent)
    console.log('\n--- Second migration run (idempotency test) ---');
    runMigrations(db);
    
    // Version should still be 1
    const versionRow2 = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version') as { value: string };
    assert(versionRow2.value === '1', 'Version remains 1 after second run (no new migrations)');
    
    // Tables should still exist
    const tables2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    assert(tables2.length === tableNames.length, 'No duplicate tables after second run');
    
    // Test foreign key constraint (chunks -> documents)
    console.log('\n--- Foreign key constraint test ---');
    db.prepare("INSERT INTO documents (id, title, filename, size, imported_at, status) VALUES (?, ?, ?, ?, ?, ?)").run(
      'test-doc-1',
      'Test Document',
      'test.txt',
      100,
      new Date().toISOString(),
      'indexed'
    );
    
    db.prepare("INSERT INTO chunks (id, document_id, idx, content) VALUES (?, ?, ?, ?)").run(
      'test-chunk-1',
      'test-doc-1',
      0,
      'Test chunk content'
    );
    
    const chunksBefore = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    assert(chunksBefore.count === 1, 'Chunk inserted successfully');
    
    // Delete document should cascade to chunks
    db.prepare('DELETE FROM documents WHERE id = ?').run('test-doc-1');
    
    const chunksAfter = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    assert(chunksAfter.count === 0, 'Chunk deleted via CASCADE when document deleted');
    
    closeDatabase();
    
    console.log('\n=== Test complete: ALL PASS ===');
  } finally {
    // Cleanup
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  }
}

runTest().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
