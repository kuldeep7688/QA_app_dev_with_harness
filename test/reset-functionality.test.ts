import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PersistenceService } from '../src/services/persistence-service';
import { initDatabase, closeDatabase, resetDatabaseInstance, clearAllData } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';

describe('Reset functionality', () => {
  let testDir: string;
  let persistence: PersistenceService;

  beforeEach(() => {
    // Create a unique test directory
    testDir = path.join(__dirname, `test-reset-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    persistence = new PersistenceService(testDir);
  });

  afterEach(() => {
    // Clean up
    try {
      closeDatabase();
      resetDatabaseInstance();
    } catch (e) {
      // Ignore errors during cleanup
    }
    
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should clear table data but keep schema intact', () => {
    // 1. Initialize database and create some data
    const db = initDatabase(testDir);
    runMigrations(db);
    
    // Insert test data into tables
    db.prepare(`
      INSERT INTO documents (id, title, filename, size, imported_at, status)
      VALUES ('doc1', 'Test Doc', 'test.txt', 100, datetime('now'), 'indexed')
    `).run();
    
    db.prepare(`
      INSERT INTO chunks (id, document_id, idx, content)
      VALUES ('chunk1', 'doc1', 0, 'Test content')
    `).run();
    
    db.prepare(`
      INSERT INTO qa_history (ts, question, answer)
      VALUES (datetime('now'), 'Test question', 'Test answer')
    `).run();
    
    // Verify data exists
    const docCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    const chunkCount = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    const qaCount = db.prepare('SELECT COUNT(*) as count FROM qa_history').get() as { count: number };
    
    expect(docCount.count).toBe(1);
    expect(chunkCount.count).toBe(1);
    expect(qaCount.count).toBe(1);
    
    // 2. Clear all data
    clearAllData();
    
    // 3. Verify data is cleared
    const docCountAfter = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    const chunkCountAfter = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    const qaCountAfter = db.prepare('SELECT COUNT(*) as count FROM qa_history').get() as { count: number };
    
    expect(docCountAfter.count).toBe(0);
    expect(chunkCountAfter.count).toBe(0);
    expect(qaCountAfter.count).toBe(0);
    
    // 4. Verify tables still exist (can insert new data)
    expect(() => {
      db.prepare(`
        INSERT INTO documents (id, title, filename, size, imported_at, status)
        VALUES ('doc2', 'New Doc', 'new.txt', 200, datetime('now'), 'pending')
      `).run();
    }).not.toThrow();
    
    const newDocCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    expect(newDocCount.count).toBe(1);
  });

  test('should clear filesystem data but keep database files', () => {
    // Initialize database
    const db = initDatabase(testDir);
    runMigrations(db);
    
    // Create test files in documents and index directories
    persistence.writeText('documents/test.txt', 'test content');
    persistence.writeJson('documents/test.json', { test: 'data' });
    persistence.writeText('index/some-index-file.txt', 'index content');
    
    // Verify files exist
    expect(persistence.exists('documents/test.txt')).toBe(true);
    expect(persistence.exists('documents/test.json')).toBe(true);
    expect(persistence.exists('index/some-index-file.txt')).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'index.db'))).toBe(true);
    
    // Reset filesystem
    persistence.resetAll();
    
    // Verify document files are deleted
    expect(persistence.exists('documents/test.txt')).toBe(false);
    expect(persistence.exists('documents/test.json')).toBe(false);
    expect(persistence.exists('index/some-index-file.txt')).toBe(false);
    
    // Verify database file still exists
    expect(fs.existsSync(path.join(testDir, 'index.db'))).toBe(true);
    
    // Verify database is still functional
    const result = db.prepare('SELECT sqlite_version()').pluck().get();
    expect(result).toBeTruthy();
    
    // Verify we can still insert data
    expect(() => {
      db.prepare(`
        INSERT INTO documents (id, title, filename, size, imported_at, status)
        VALUES ('doc1', 'Test', 'test.txt', 100, datetime('now'), 'pending')
      `).run();
    }).not.toThrow();
  });

  test('should handle complete reset flow (database + filesystem)', () => {
    // Initialize
    const db = initDatabase(testDir);
    runMigrations(db);
    
    // Create data in both database and filesystem
    db.prepare(`
      INSERT INTO documents (id, title, filename, size, imported_at, status)
      VALUES ('doc1', 'Test Doc', 'test.txt', 100, datetime('now'), 'indexed')
    `).run();
    
    persistence.writeText('documents/test.txt', 'test content');
    
    // Verify initial state
    const docCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    expect(docCount.count).toBe(1);
    expect(persistence.exists('documents/test.txt')).toBe(true);
    
    // Simulate the complete reset flow (as done in IPC handler)
    clearAllData();
    persistence.resetAll();
    
    // Verify all data is cleared
    const docCountAfter = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    expect(docCountAfter.count).toBe(0);
    expect(persistence.exists('documents/test.txt')).toBe(false);
    
    // Verify database is still functional and can accept new data
    db.prepare(`
      INSERT INTO documents (id, title, filename, size, imported_at, status)
      VALUES ('doc2', 'New Doc', 'new.txt', 200, datetime('now'), 'pending')
    `).run();
    
    persistence.writeText('documents/new.txt', 'new content');
    
    const newDocCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    expect(newDocCount.count).toBe(1);
    expect(persistence.exists('documents/new.txt')).toBe(true);
  });

  test('should handle .fuse_hidden files gracefully', () => {
    // Initialize database
    const db = initDatabase(testDir);
    runMigrations(db);
    
    // Create a mock .fuse_hidden file in documents directory
    const documentsDir = persistence.getDocumentsDir();
    const fuseFile = path.join(documentsDir, '.fuse_hidden001test');
    fs.writeFileSync(fuseFile, 'test content');
    
    // Reset should not fail due to .fuse_hidden file
    expect(() => persistence.resetAll()).not.toThrow();
    
    // Directory structure should still exist
    expect(fs.existsSync(testDir)).toBe(true);
    expect(fs.existsSync(persistence.getDocumentsDir())).toBe(true);
    expect(fs.existsSync(persistence.getIndexDir())).toBe(true);
    
    // Database should still be functional
    const result = db.prepare('SELECT sqlite_version()').pluck().get();
    expect(result).toBeTruthy();
  });
});
