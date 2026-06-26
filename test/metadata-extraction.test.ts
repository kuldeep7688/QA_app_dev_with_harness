import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DocumentService } from '../src/services/document-service';
import { PersistenceService } from '../src/services/persistence-service';

/**
 * Integration test for metadata extraction feature.
 * Verifies that word count, line count, and file type are extracted on import.
 */

// Create a temporary test environment
const tempDir = path.join(os.tmpdir(), 'kb-metadata-test-' + Date.now());
fs.mkdirSync(tempDir, { recursive: true });

// Create a test document
const testContent = `This is a test document.
It has multiple lines.
And several words to count.

This paragraph has more content.
Each line should be counted.`;

const testFilePath = path.join(tempDir, 'test-document.txt');
fs.writeFileSync(testFilePath, testContent, 'utf-8');

// Initialize services
const persistence = new PersistenceService(path.join(tempDir, 'data'));
const documentService = new DocumentService(persistence);

// Import the document
console.log('Importing test document...');
const doc = documentService.importDocument(testFilePath);

// Verify metadata extraction
console.log('\n=== Metadata Extraction Test Results ===');
console.log(`Document ID: ${doc.id}`);
console.log(`Title: ${doc.title}`);
console.log(`Filename: ${doc.filename}`);
console.log(`File Type: ${doc.fileType}`);
console.log(`Size: ${doc.size} bytes`);
console.log(`Word Count: ${doc.wordCount}`);
console.log(`Line Count: ${doc.lineCount}`);
console.log(`Status: ${doc.status}`);

// Assertions
const expectedWordCount = testContent.trim().split(/\s+/).filter(w => w.length > 0).length;
const expectedLineCount = testContent.split('\n').length;
const expectedFileType = 'txt';

let passed = true;

if (doc.wordCount !== expectedWordCount) {
  console.error(`\n❌ FAIL: Word count mismatch. Expected ${expectedWordCount}, got ${doc.wordCount}`);
  passed = false;
} else {
  console.log(`\n✅ PASS: Word count matches (${doc.wordCount})`);
}

if (doc.lineCount !== expectedLineCount) {
  console.error(`❌ FAIL: Line count mismatch. Expected ${expectedLineCount}, got ${doc.lineCount}`);
  passed = false;
} else {
  console.log(`✅ PASS: Line count matches (${doc.lineCount})`);
}

if (doc.fileType !== expectedFileType) {
  console.error(`❌ FAIL: File type mismatch. Expected ${expectedFileType}, got ${doc.fileType}`);
  passed = false;
} else {
  console.log(`✅ PASS: File type matches (${doc.fileType})`);
}

// Test with .md file
const mdContent = `# Markdown Test

This is a **markdown** document.
- Item 1
- Item 2`;

const mdFilePath = path.join(tempDir, 'test-markdown.md');
fs.writeFileSync(mdFilePath, mdContent, 'utf-8');

const mdDoc = documentService.importDocument(mdFilePath);

if (mdDoc.fileType !== 'md') {
  console.error(`\n❌ FAIL: Markdown file type mismatch. Expected 'md', got ${mdDoc.fileType}`);
  passed = false;
} else {
  console.log(`✅ PASS: Markdown file type matches (${mdDoc.fileType})`);
}

// Cleanup
fs.rmSync(tempDir, { recursive: true, force: true });

if (passed) {
  console.log('\n🎉 All metadata extraction tests passed!\n');
  process.exit(0);
} else {
  console.error('\n❌ Some tests failed.\n');
  process.exit(1);
}
