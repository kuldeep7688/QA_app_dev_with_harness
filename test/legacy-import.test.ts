import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { LegacyImporter } from '../src/services/legacy-importer';

describe('Legacy JSON → SQLite Import', () => {
  let testDir: string;
  let dbPath: string;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-legacy-test-'));
    dbPath = path.join(testDir, 'index.db');

    // Create legacy JSON fixtures
    const documentsData = [
      { id: 'doc-001', title: 'Architecture Guide', filename: 'architecture-guide.md', size: 2048, importedAt: '2026-06-27T10:00:00.000Z', status: 'indexed', wordCount: 450, lineCount: 85, fileType: 'md', chunks: 3 },
      { id: 'doc-002', title: 'Meeting Notes', filename: 'meeting-notes.txt', size: 1024, importedAt: '2026-06-27T11:00:00.000Z', status: 'indexed', wordCount: 220, lineCount: 42, fileType: 'txt', chunks: 2 },
    ];
    fs.writeFileSync(path.join(testDir, 'documents-meta.json'), JSON.stringify(documentsData, null, 2));

    const chunksDir = path.join(testDir, 'chunks');
    fs.mkdirSync(chunksDir);

    const chunksDoc001 = [
      { id: 'chunk-001-0', documentId: 'doc-001', content: 'This is the first chunk of the architecture guide. It covers the overview and key concepts.', index: 0, metadata: { charCount: '92', wordCount: '16' } },
      { id: 'chunk-001-1', documentId: 'doc-001', content: 'The second chunk explains the system architecture, including the main process and renderer layers.', index: 1, metadata: { charCount: '98', wordCount: '15' } },
      { id: 'chunk-001-2', documentId: 'doc-001', content: 'The final chunk discusses data storage patterns and SQLite integration strategies.', index: 2, metadata: { charCount: '83', wordCount: '12' } },
    ];
    fs.writeFileSync(path.join(chunksDir, 'doc-001.json'), JSON.stringify(chunksDoc001, null, 2));

    const chunksDoc002 = [
      { id: 'chunk-002-0', documentId: 'doc-002', content: 'Meeting started at 2pm. Attendees: Alice, Bob, Charlie. Topics: Q4 planning and feature roadmap.', index: 0, metadata: { charCount: '97', wordCount: '14' } },
      { id: 'chunk-002-1', documentId: 'doc-002', content: 'Action items: Alice to review designs, Bob to update timeline, Charlie to prepare demo.', index: 1, metadata: { charCount: '91', wordCount: '15' } },
    ];
    fs.writeFileSync(path.join(chunksDir, 'doc-002.json'), JSON.stringify(chunksDoc002, null, 2));

    const qaHistoryData = [
      { question: 'What is the system architecture?', response: { answer: 'The system uses an Electron-based architecture with separate main and renderer processes.', citations: [{ documentId: 'doc-001', documentTitle: 'Architecture Guide', chunkIndex: 1, excerpt: 'The second chunk explains the system architecture...', confidence: 0.92 }], confidence: 0.92, timestamp: '2026-06-27T12:00:00.000Z' } },
      { question: 'What were the action items from the meeting?', response: { answer: 'Action items include: Alice reviewing designs, Bob updating the timeline, and Charlie preparing a demo.', citations: [{ documentId: 'doc-002', documentTitle: 'Meeting Notes', chunkIndex: 1, excerpt: 'Action items: Alice to review designs, Bob to update timeline...', confidence: 0.88 }], confidence: 0.88, timestamp: '2026-06-27T13:00:00.000Z' } },
    ];
    fs.writeFileSync(path.join(testDir, 'qa-history.json'), JSON.stringify(qaHistoryData, null, 2));

    const feedbackData = [
      { id: 'fb-001', responseTimestamp: '2026-06-27T12:00:00.000Z', question: 'What is the system architecture?', rating: 'positive', submittedAt: '2026-06-27T12:05:00.000Z' },
      { id: 'fb-002', responseTimestamp: '2026-06-27T13:00:00.000Z', question: 'What were the action items from the meeting?', rating: 'positive', submittedAt: '2026-06-27T13:10:00.000Z' },
      { id: 'fb-003', responseTimestamp: '2026-06-27T14:00:00.000Z', question: 'What is the project timeline?', rating: 'negative', submittedAt: '2026-06-27T14:15:00.000Z' },
    ];
    fs.writeFileSync(path.join(testDir, 'feedback.json'), JSON.stringify(feedbackData, null, 2));
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* already closed */ }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('shouldImport returns true when no index.db and JSON exists', () => {
    expect(LegacyImporter.shouldImport(testDir, dbPath)).toBe(true);
  });

  it('shouldImport returns false when index.db exists', () => {
    fs.writeFileSync(dbPath, 'dummy');
    expect(LegacyImporter.shouldImport(testDir, dbPath)).toBe(false);
    fs.unlinkSync(dbPath);
  });

  it('runs schema migrations and imports legacy data', () => {
    const db = initDatabase(testDir);
    runMigrations(db);
    LegacyImporter.importLegacyData(db, testDir);

    // Verify row counts
    const documentsCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    expect(documentsCount.count).toBe(2);

    const chunksCount = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    expect(chunksCount.count).toBe(5);

    const qaCount = db.prepare('SELECT COUNT(*) as count FROM qa_history').get() as { count: number };
    expect(qaCount.count).toBe(2);

    const feedbackCount = db.prepare('SELECT COUNT(*) as count FROM feedback').get() as { count: number };
    expect(feedbackCount.count).toBe(3);

    // Verify document details
    const doc1 = db.prepare('SELECT * FROM documents WHERE id = ?').get('doc-001') as any;
    expect(doc1.title).toBe('Architecture Guide');
    expect(doc1.status).toBe('indexed');
    expect(doc1.word_count).toBe(450);

    // Verify chunk details
    const chunk0 = db.prepare('SELECT * FROM chunks WHERE id = ?').get('chunk-001-0') as any;
    expect(chunk0.document_id).toBe('doc-001');
    expect(chunk0.idx).toBe(0);
    expect(chunk0.char_count).toBe(92);
    expect(chunk0.word_count).toBe(16);

    // Verify Q&A history
    const qa1 = db.prepare('SELECT * FROM qa_history ORDER BY ts LIMIT 1').get() as any;
    expect(qa1.question).toBe('What is the system architecture?');
    expect(qa1.confidence).toBe(0.92);
    const citations1 = JSON.parse(qa1.citations_json);
    expect(citations1.length).toBe(1);
    expect(citations1[0].documentId).toBe('doc-001');

    // Verify feedback
    const fb1 = db.prepare('SELECT * FROM feedback WHERE id = ?').get('fb-001') as any;
    expect(fb1.rating).toBe('positive');
    expect(fb1.question).toBe('What is the system architecture?');

    // Verify legacy files moved to backup
    const legacyDir = path.join(testDir, 'legacy');
    expect(fs.existsSync(legacyDir)).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'documents-meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'qa-history.json'))).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'feedback.json'))).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'chunks'))).toBe(true);

    expect(fs.existsSync(path.join(testDir, 'documents-meta.json'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'qa-history.json'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'feedback.json'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'chunks'))).toBe(false);

    const legacyDocs = JSON.parse(fs.readFileSync(path.join(legacyDir, 'documents-meta.json'), 'utf-8'));
    expect(legacyDocs.length).toBe(2);

    closeDatabase();
  });

  it('shouldImport returns false after import (index.db exists)', () => {
    // index.db was created during previous test, so shouldImport should return false
    expect(LegacyImporter.shouldImport(testDir, dbPath)).toBe(false);
  });
});
