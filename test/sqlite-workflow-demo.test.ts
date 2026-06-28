/**
 * Quick demo: Import → Index → Query workflow using SQLite
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { PersistenceService } from '../src/services/persistence-service';
import { DocumentService } from '../src/services/document-service';
import { IndexingService } from '../src/services/indexing-service';
import { QaService } from '../src/services/qa-service';

async function demo() {
  console.log('=== SQLite Workflow Demo ===\n');

  // Create test directory
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sqlite-demo-'));
  console.log(`Test directory: ${testDir}\n`);

  // Create a sample document
  const sampleDoc = path.join(testDir, 'sample.txt');
  fs.writeFileSync(sampleDoc, 'This is a test document about architecture and design patterns. The system uses a layered approach.');

  // Initialize services
  const db = initDatabase(testDir);
  runMigrations(db);

  const persistence = new PersistenceService(testDir);
  const docService = new DocumentService(persistence, db);
  const indexService = new IndexingService(persistence, db);
  const qaService = new QaService(persistence, db);

  console.log('--- Step 1: Import Document ---');
  const doc = docService.importDocument(sampleDoc);
  console.log(`✓ Imported: ${doc.title} (ID: ${doc.id})`);
  console.log(`  Status: ${doc.status}`);
  console.log(`  Word count: ${doc.wordCount}\n`);

  // Check database
  const docsInDb = db.prepare('SELECT * FROM documents').all();
  console.log(`✓ Documents in DB: ${docsInDb.length}\n`);

  console.log('--- Step 2: Index Document ---');
  await indexService.startIndexing(doc.id);

  const chunksInDb = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
  console.log(`✓ Chunks created: ${chunksInDb.count}`);

  // Show chunk details
  const chunks = db.prepare('SELECT id, idx, word_count, substr(content, 1, 50) as preview FROM chunks').all();
  console.log('\nChunk details:');
  for (const chunk of chunks as any[]) {
    console.log(`  Chunk ${chunk.idx}: ${chunk.word_count} words - "${chunk.preview}..."`);
  }
  console.log();

  console.log('--- Step 3: Ask Question ---');
  const answer = await qaService.ask('What is the architecture about?');
  console.log(`✓ Question answered`);
  console.log(`  Confidence: ${answer.confidence}`);
  console.log(`  Citations: ${answer.citations.length}`);
  console.log(`  Answer: ${answer.answer.substring(0, 100)}...\n`);

  const qaInDb = db.prepare('SELECT COUNT(*) as count FROM qa_history').get() as { count: number };
  console.log(`✓ Q&A history entries in DB: ${qaInDb.count}\n`);

  console.log('--- Step 4: Submit Feedback ---');
  qaService.submitFeedback(answer.timestamp, 'What is the architecture about?', 'positive');

  const feedbackInDb = db.prepare('SELECT COUNT(*) as count FROM feedback').get() as { count: number };
  console.log(`✓ Feedback entries in DB: ${feedbackInDb.count}\n`);

  console.log('--- Database Contents ---');
  console.log(`Documents: ${docsInDb.length}`);
  console.log(`Chunks: ${chunksInDb.count}`);
  console.log(`Q&A History: ${qaInDb.count}`);
  console.log(`Feedback: ${feedbackInDb.count}\n`);

  console.log('--- Database Path ---');
  console.log(`${testDir}/index.db\n`);

  console.log('You can inspect it with:');
  console.log(`  sqlite3 ${testDir}/index.db`);
  console.log(`  SELECT * FROM documents;`);
  console.log(`  SELECT * FROM chunks;`);
  console.log(`  SELECT * FROM qa_history;`);
  console.log(`  SELECT * FROM feedback;\n`);

  closeDatabase();
  console.log('=== Demo Complete ===');
}

demo().catch(console.error);
