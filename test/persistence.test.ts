import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PersistenceService } from '../src/services/persistence-service';
import { DocumentService } from '../src/services/document-service';
import { IndexingService } from '../src/services/indexing-service';
import { QaService } from '../src/services/qa-service';

/**
 * Integration test: verify all data (documents, chunks, Q&A history, feedback)
 * persists across a simulated application restart (service re-instantiation
 * against the same data directory).
 */

const tempRoot = path.join(os.tmpdir(), 'kb-persistence-test-' + Date.now());
const dataDir = path.join(tempRoot, 'data');
fs.mkdirSync(tempRoot, { recursive: true });

// Create source document on disk
const srcPath = path.join(tempRoot, 'persistence-sample.md');
const srcContent = `# Persistence Sample\n\nThis document is used to verify that the knowledge base correctly persists imported documents, indexed chunks, Q&A history, and feedback across application restarts.\n\nIt contains multiple paragraphs so the indexing service can produce at least one chunk and the Q&A service can retrieve a citation when asked about persistence and design.\n\nThe second paragraph mentions architecture and design so the keyword retrieval path is exercised.`;
fs.writeFileSync(srcPath, srcContent, 'utf-8');

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
  // --- Session 1: write data ---
  console.log('=== Session 1: writing data ===');
  {
    const persistence = new PersistenceService(dataDir);
    const documents = new DocumentService(persistence);
    const indexing = new IndexingService(persistence);
    const qa = new QaService(persistence, indexing);

    const doc = documents.importDocument(srcPath);
    check('Session 1: document imported', !!doc.id);

    await indexing.startIndexing(doc.id);
    const chunks = indexing.getChunksForDocument(doc.id);
    check('Session 1: chunks created', chunks.length > 0, `got ${chunks.length}`);

    const resp = await qa.ask('What does the document say about architecture and design?');
    check('Session 1: Q&A returned citations', resp.citations.length > 0);

    qa.submitFeedback(resp.timestamp, 'What does the document say about architecture and design?', 'positive');
    const fb = qa.getFeedback();
    check('Session 1: feedback persisted', fb.length === 1);
  }

  // Verify on-disk files exist
  check('On-disk: documents-meta.json', fs.existsSync(path.join(dataDir, 'documents-meta.json')));
  check('On-disk: qa-history.json', fs.existsSync(path.join(dataDir, 'qa-history.json')));
  check('On-disk: feedback.json', fs.existsSync(path.join(dataDir, 'feedback.json')));
  check('On-disk: index-meta.json', fs.existsSync(path.join(dataDir, 'index-meta.json')));
  check('On-disk: chunks/ has files', fs.readdirSync(path.join(dataDir, 'chunks')).length > 0);
  check('On-disk: content/ has files', fs.readdirSync(path.join(dataDir, 'content')).length > 0);

  // --- Session 2: re-instantiate against same dataDir, verify everything loads ---
  console.log('\n=== Session 2: simulated restart ===');
  {
    const persistence = new PersistenceService(dataDir);
    const documents = new DocumentService(persistence);
    const indexing = new IndexingService(persistence);
    const qa = new QaService(persistence, indexing);

    const docs = documents.listDocuments();
    check('Session 2: documents loaded', docs.length === 1, `got ${docs.length}`);
    check('Session 2: document status preserved (indexed)', docs[0]?.status === 'indexed', `status=${docs[0]?.status}`);
    check('Session 2: document metadata preserved (wordCount)', typeof docs[0]?.wordCount === 'number' && (docs[0]?.wordCount ?? 0) > 0);

    const chunks = indexing.getAllChunks();
    check('Session 2: chunks loaded', chunks.length > 0, `got ${chunks.length}`);

    const status = indexing.getStatus();
    check('Session 2: index status ready', status.indexStatus === 'ready' && status.indexedCount === 1);

    const history = qa.getHistory();
    check('Session 2: Q&A history loaded', history.length === 1, `got ${history.length}`);
    check('Session 2: history entry has citations', (history[0]?.response.citations.length ?? 0) > 0);

    const fb = qa.getFeedback();
    check('Session 2: feedback loaded', fb.length === 1 && fb[0]?.rating === 'positive');
  }

  // Cleanup
  fs.rmSync(tempRoot, { recursive: true, force: true });

  if (failed === 0) {
    console.log('\nAll persistence tests passed.');
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
