import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { DocumentService } from '../src/services/document-service';
import { PersistenceService } from '../src/services/persistence-service';

describe('Metadata Extraction', () => {
  const tempDir = path.join(os.tmpdir(), 'kb-metadata-test-' + Date.now());

  const dataDir1 = path.join(tempDir, 'data1');
  const dataDir2 = path.join(tempDir, 'data2');

  beforeAll(() => {
    fs.mkdirSync(dataDir1, { recursive: true });
    fs.mkdirSync(dataDir2, { recursive: true });
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* already closed */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should extract metadata from a .txt document on import', () => {
    const testContent = `This is a test document.
It has multiple lines.
And several words to count.

This paragraph has more content.
Each line should be counted.`;

    const testFilePath = path.join(tempDir, 'test-document.txt');
    fs.writeFileSync(testFilePath, testContent, 'utf-8');

    const db = initDatabase(dataDir1);
    runMigrations(db);
    const persistence = new PersistenceService(dataDir1);
    const documentService = new DocumentService(persistence, db);
    const doc = documentService.importDocument(testFilePath);

    const expectedWordCount = testContent.trim().split(/\s+/).filter(w => w.length > 0).length;
    const expectedLineCount = testContent.split('\n').length;

    expect(doc.wordCount).toBe(expectedWordCount);
    expect(doc.lineCount).toBe(expectedLineCount);
    expect(doc.fileType).toBe('txt');
    expect(doc.id).toBeDefined();
    expect(doc.title).toBeDefined();
    expect(doc.filename).toBe('test-document.txt');

    closeDatabase();
  });

  it('should extract file type from a .md document on import', () => {
    const mdContent = `# Markdown Test

This is a **markdown** document.
- Item 1
- Item 2`;

    const db = initDatabase(dataDir2);
    runMigrations(db);
    const persistence = new PersistenceService(dataDir2);
    const documentService = new DocumentService(persistence, db);

    const mdFilePath = path.join(tempDir, 'test-markdown.md');
    fs.writeFileSync(mdFilePath, mdContent, 'utf-8');

    const mdDoc = documentService.importDocument(mdFilePath);
    expect(mdDoc.fileType).toBe('md');

    closeDatabase();
  });
});
