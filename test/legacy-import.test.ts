/**
 * Legacy JSON → SQLite Import Test
 * 
 * Validates:
 * 1. Detection logic (shouldImport returns true when index.db missing + JSON exists)
 * 2. Transaction-based import of all 4 data categories
 * 3. Row count verification (documents, chunks, qa_history, feedback)
 * 4. Legacy files moved to <dataDir>/legacy/ backup
 * 5. Idempotency (import doesn't run when index.db already exists)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { LegacyImporter } from '../src/services/legacy-importer';

// Test helper
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    throw new Error(`Assertion failed: ${label}`);
  }
}

console.log('=== Legacy JSON → SQLite Import Test ===\n');

// Create test directory with legacy JSON fixtures
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-legacy-test-'));
console.log(`Test directory: ${testDir}\n`);

const dbPath = path.join(testDir, 'index.db');

// --- Setup: Create legacy JSON fixtures ---
console.log('--- Setting up legacy JSON fixtures ---');

// 1. documents-meta.json (2 documents)
const documentsData = [
  {
    id: 'doc-001',
    title: 'Architecture Guide',
    filename: 'architecture-guide.md',
    size: 2048,
    importedAt: '2026-06-27T10:00:00.000Z',
    status: 'indexed',
    wordCount: 450,
    lineCount: 85,
    fileType: 'md',
    chunks: 3,
  },
  {
    id: 'doc-002',
    title: 'Meeting Notes',
    filename: 'meeting-notes.txt',
    size: 1024,
    importedAt: '2026-06-27T11:00:00.000Z',
    status: 'indexed',
    wordCount: 220,
    lineCount: 42,
    fileType: 'txt',
    chunks: 2,
  },
];
fs.writeFileSync(path.join(testDir, 'documents-meta.json'), JSON.stringify(documentsData, null, 2));
console.log('Created documents-meta.json with 2 documents');

// 2. chunks/*.json (3 chunks for doc-001, 2 chunks for doc-002)
const chunksDir = path.join(testDir, 'chunks');
fs.mkdirSync(chunksDir);

const chunksDoc001 = [
  {
    id: 'chunk-001-0',
    documentId: 'doc-001',
    content: 'This is the first chunk of the architecture guide. It covers the overview and key concepts.',
    index: 0,
    metadata: { charCount: '92', wordCount: '16' },
  },
  {
    id: 'chunk-001-1',
    documentId: 'doc-001',
    content: 'The second chunk explains the system architecture, including the main process and renderer layers.',
    index: 1,
    metadata: { charCount: '98', wordCount: '15' },
  },
  {
    id: 'chunk-001-2',
    documentId: 'doc-001',
    content: 'The final chunk discusses data storage patterns and SQLite integration strategies.',
    index: 2,
    metadata: { charCount: '83', wordCount: '12' },
  },
];
fs.writeFileSync(path.join(chunksDir, 'doc-001.json'), JSON.stringify(chunksDoc001, null, 2));

const chunksDoc002 = [
  {
    id: 'chunk-002-0',
    documentId: 'doc-002',
    content: 'Meeting started at 2pm. Attendees: Alice, Bob, Charlie. Topics: Q4 planning and feature roadmap.',
    index: 0,
    metadata: { charCount: '97', wordCount: '14' },
  },
  {
    id: 'chunk-002-1',
    documentId: 'doc-002',
    content: 'Action items: Alice to review designs, Bob to update timeline, Charlie to prepare demo.',
    index: 1,
    metadata: { charCount: '91', wordCount: '15' },
  },
];
fs.writeFileSync(path.join(chunksDir, 'doc-002.json'), JSON.stringify(chunksDoc002, null, 2));
console.log('Created chunks/ directory with 5 total chunks');

// 3. qa-history.json (2 Q&A entries)
const qaHistoryData = [
  {
    question: 'What is the system architecture?',
    response: {
      answer: 'The system uses an Electron-based architecture with separate main and renderer processes.',
      citations: [
        {
          documentId: 'doc-001',
          documentTitle: 'Architecture Guide',
          chunkIndex: 1,
          excerpt: 'The second chunk explains the system architecture...',
          confidence: 0.92,
        },
      ],
      confidence: 0.92,
      timestamp: '2026-06-27T12:00:00.000Z',
    },
  },
  {
    question: 'What were the action items from the meeting?',
    response: {
      answer: 'Action items include: Alice reviewing designs, Bob updating the timeline, and Charlie preparing a demo.',
      citations: [
        {
          documentId: 'doc-002',
          documentTitle: 'Meeting Notes',
          chunkIndex: 1,
          excerpt: 'Action items: Alice to review designs, Bob to update timeline...',
          confidence: 0.88,
        },
      ],
      confidence: 0.88,
      timestamp: '2026-06-27T13:00:00.000Z',
    },
  },
];
fs.writeFileSync(path.join(testDir, 'qa-history.json'), JSON.stringify(qaHistoryData, null, 2));
console.log('Created qa-history.json with 2 Q&A entries');

// 4. feedback.json (3 feedback entries)
const feedbackData = [
  {
    id: 'fb-001',
    responseTimestamp: '2026-06-27T12:00:00.000Z',
    question: 'What is the system architecture?',
    rating: 'positive',
    submittedAt: '2026-06-27T12:05:00.000Z',
  },
  {
    id: 'fb-002',
    responseTimestamp: '2026-06-27T13:00:00.000Z',
    question: 'What were the action items from the meeting?',
    rating: 'positive',
    submittedAt: '2026-06-27T13:10:00.000Z',
  },
  {
    id: 'fb-003',
    responseTimestamp: '2026-06-27T14:00:00.000Z',
    question: 'What is the project timeline?',
    rating: 'negative',
    submittedAt: '2026-06-27T14:15:00.000Z',
  },
];
fs.writeFileSync(path.join(testDir, 'feedback.json'), JSON.stringify(feedbackData, null, 2));
console.log('Created feedback.json with 3 feedback entries\n');

// --- Test 1: Detection logic ---
console.log('--- Test 1: Import detection logic ---');
check('shouldImport returns true (no index.db + JSON exists)', LegacyImporter.shouldImport(testDir, dbPath) === true);

// Create a dummy index.db to test negative case
fs.writeFileSync(dbPath, 'dummy');
check('shouldImport returns false (index.db exists)', LegacyImporter.shouldImport(testDir, dbPath) === false);
fs.unlinkSync(dbPath); // Remove dummy file
console.log();

// --- Test 2: Run schema migrations first (creates tables) ---
console.log('--- Test 2: Running schema migrations ---');
const db = initDatabase(testDir);
runMigrations(db);
console.log();

// --- Test 3: Import legacy data ---
console.log('--- Test 3: Importing legacy JSON data ---');
LegacyImporter.importLegacyData(db, testDir);
console.log();

// --- Test 4: Verify row counts ---
console.log('--- Test 4: Verifying imported data ---');

const documentsCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
check('2 documents imported', documentsCount.count === 2);

const chunksCount = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
check('5 chunks imported', chunksCount.count === 5);

const qaCount = db.prepare('SELECT COUNT(*) as count FROM qa_history').get() as { count: number };
check('2 Q&A entries imported', qaCount.count === 2);

const feedbackCount = db.prepare('SELECT COUNT(*) as count FROM feedback').get() as { count: number };
check('3 feedback entries imported', feedbackCount.count === 3);

// Verify document details
const doc1 = db.prepare('SELECT * FROM documents WHERE id = ?').get('doc-001') as any;
check('Document 1 title correct', doc1.title === 'Architecture Guide');
check('Document 1 status correct', doc1.status === 'indexed');
check('Document 1 word_count correct', doc1.word_count === 450);

// Verify chunk details
const chunk0 = db.prepare('SELECT * FROM chunks WHERE id = ?').get('chunk-001-0') as any;
check('Chunk 0 document_id correct', chunk0.document_id === 'doc-001');
check('Chunk 0 idx correct', chunk0.idx === 0);
check('Chunk 0 char_count correct', chunk0.char_count === 92);
check('Chunk 0 word_count correct', chunk0.word_count === 16);

// Verify Q&A history
const qa1 = db.prepare('SELECT * FROM qa_history ORDER BY ts LIMIT 1').get() as any;
check('Q&A 1 question correct', qa1.question === 'What is the system architecture?');
check('Q&A 1 confidence correct', qa1.confidence === 0.92);
const citations1 = JSON.parse(qa1.citations_json);
check('Q&A 1 has 1 citation', citations1.length === 1);
check('Q&A 1 citation documentId correct', citations1[0].documentId === 'doc-001');

// Verify feedback
const fb1 = db.prepare('SELECT * FROM feedback WHERE id = ?').get('fb-001') as any;
check('Feedback 1 rating correct', fb1.rating === 'positive');
check('Feedback 1 question correct', fb1.question === 'What is the system architecture?');

console.log();

// --- Test 5: Verify legacy files moved to backup ---
console.log('--- Test 5: Verifying legacy backup ---');

const legacyDir = path.join(testDir, 'legacy');
check('legacy/ directory created', fs.existsSync(legacyDir));
check('documents-meta.json moved to legacy/', fs.existsSync(path.join(legacyDir, 'documents-meta.json')));
check('qa-history.json moved to legacy/', fs.existsSync(path.join(legacyDir, 'qa-history.json')));
check('feedback.json moved to legacy/', fs.existsSync(path.join(legacyDir, 'feedback.json')));
check('chunks/ directory moved to legacy/', fs.existsSync(path.join(legacyDir, 'chunks')));

// Verify original files no longer exist in root
check('documents-meta.json removed from root', !fs.existsSync(path.join(testDir, 'documents-meta.json')));
check('qa-history.json removed from root', !fs.existsSync(path.join(testDir, 'qa-history.json')));
check('feedback.json removed from root', !fs.existsSync(path.join(testDir, 'feedback.json')));
check('chunks/ directory removed from root', !fs.existsSync(path.join(testDir, 'chunks')));

// Verify legacy backup files have correct content
const legacyDocs = JSON.parse(fs.readFileSync(path.join(legacyDir, 'documents-meta.json'), 'utf-8'));
check('Legacy backup has 2 documents', legacyDocs.length === 2);

console.log();

// --- Test 6: Idempotency - shouldImport now returns false ---
console.log('--- Test 6: Idempotency check ---');
check('shouldImport returns false after import (index.db exists)', LegacyImporter.shouldImport(testDir, dbPath) === false);
console.log();

// Cleanup
closeDatabase();
console.log('=== Test complete: ALL PASS ===');
