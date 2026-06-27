import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PersistenceService } from '../src/services/persistence-service';
import { DocumentService } from '../src/services/document-service';
import { IndexingService } from '../src/services/indexing-service';

/**
 * Integration test: verify IndexingService.getStatus() returns all fields
 * required by the StatusBar component, with correct values at different
 * stages of the indexing workflow.
 */

const tempRoot = path.join(os.tmpdir(), 'kb-statusbar-test-' + Date.now());
const dataDir = path.join(tempRoot, 'data');
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
  const persistence = new PersistenceService(dataDir);
  const documents = new DocumentService(persistence);
  const indexing = new IndexingService(persistence);

  // Stage 1: No documents (idle state)
  console.log('=== Stage 1: No documents ===');
  {
    const status = indexing.getStatus();
    check('Stage 1: documentsLoaded=0', status.documentsLoaded === 0);
    check('Stage 1: indexStatus=idle', status.indexStatus === 'idle');
    check('Stage 1: indexedCount=0', status.indexedCount === 0);
    check('Stage 1: lastActivity is ISO string', typeof status.lastActivity === 'string' && status.lastActivity.length > 0);
  }

  // Create sample documents
  const doc1Path = path.join(tempRoot, 'doc1.md');
  const doc2Path = path.join(tempRoot, 'doc2.txt');
  const doc3Path = path.join(tempRoot, 'doc3.md');
  fs.writeFileSync(doc1Path, '# Document 1\n\nFirst sample document for status bar testing.\n\nThis has multiple paragraphs so indexing can create chunks.', 'utf-8');
  fs.writeFileSync(doc2Path, 'Document 2\n\nSecond sample document with text format.\n\nAlso has multiple paragraphs for chunk generation.', 'utf-8');
  fs.writeFileSync(doc3Path, '# Document 3\n\nThird sample document.\n\nMore content for testing status transitions.', 'utf-8');

  const doc1 = documents.importDocument(doc1Path);
  const doc2 = documents.importDocument(doc2Path);
  const doc3 = documents.importDocument(doc3Path);

  // Stage 2: 3 documents imported, none indexed
  console.log('\n=== Stage 2: 3 documents imported, none indexed ===');
  {
    const status = indexing.getStatus();
    check('Stage 2: documentsLoaded=3', status.documentsLoaded === 3, `got ${status.documentsLoaded}`);
    check('Stage 2: indexStatus=idle', status.indexStatus === 'idle', `got ${status.indexStatus}`);
    check('Stage 2: indexedCount=0', status.indexedCount === 0, `got ${status.indexedCount}`);
  }

  // Stage 3: 1 document indexed
  console.log('\n=== Stage 3: 1 of 3 indexed ===');
  await indexing.startIndexing(doc1.id);
  {
    const status = indexing.getStatus();
    check('Stage 3: documentsLoaded=3', status.documentsLoaded === 3);
    check('Stage 3: indexStatus=indexing', status.indexStatus === 'indexing', `got ${status.indexStatus}`);
    check('Stage 3: indexedCount=1', status.indexedCount === 1, `got ${status.indexedCount}`);
  }

  // Stage 4: 2 documents indexed
  console.log('\n=== Stage 4: 2 of 3 indexed ===');
  await indexing.startIndexing(doc2.id);
  {
    const status = indexing.getStatus();
    check('Stage 4: documentsLoaded=3', status.documentsLoaded === 3);
    check('Stage 4: indexStatus=indexing', status.indexStatus === 'indexing', `got ${status.indexStatus}`);
    check('Stage 4: indexedCount=2', status.indexedCount === 2, `got ${status.indexedCount}`);
  }

  // Stage 5: All documents indexed (ready)
  console.log('\n=== Stage 5: 3 of 3 indexed (ready) ===');
  await indexing.startIndexing(doc3.id);
  {
    const status = indexing.getStatus();
    check('Stage 5: documentsLoaded=3', status.documentsLoaded === 3);
    check('Stage 5: indexStatus=ready', status.indexStatus === 'ready', `got ${status.indexStatus}`);
    check('Stage 5: indexedCount=3', status.indexedCount === 3, `got ${status.indexedCount}`);
  }

  // Verify lastActivity timestamp is recent (within last second)
  console.log('\n=== Verify lastActivity timestamp ===');
  {
    const status = indexing.getStatus();
    const lastActivity = new Date(status.lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - lastActivity.getTime();
    check('lastActivity is recent (within 1 second)', diffMs < 1000, `diffMs=${diffMs}`);
  }

  // Cleanup
  fs.rmSync(tempRoot, { recursive: true, force: true });

  if (failed === 0) {
    console.log('\nAll status bar tests passed.');
    process.exit(0);
  } else {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test crashed:', err);
  process.exit(2);
});
