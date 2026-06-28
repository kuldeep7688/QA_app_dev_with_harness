/**
 * Test: FTS5 BM25 Keyword Index
 * 
 * Verifies:
 * - chunks_fts virtual table is created with BM25 ranking
 * - Triggers keep FTS in sync with chunks table on INSERT/UPDATE/DELETE
 * - RetrieverService.bm25Search returns ranked results with scores
 * - Seeded queries return expected chunks in top-3
 */

import { strict as assert } from "assert";
import { initDatabase } from "../src/services/db.js";
import { runMigrations } from "../src/services/migrations/runner.js";
import { RetrieverService } from "../src/services/retriever-service.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Test framework
let passCount = 0;
let failCount = 0;
const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
let beforeFn: (() => void | Promise<void>) | null = null;
let afterFn: (() => void | Promise<void>) | null = null;

function describe(_name: string, fn: () => void) {
  fn();
}

function before(fn: () => void | Promise<void>) {
  beforeFn = fn;
}

function after(fn: () => void | Promise<void>) {
  afterFn = fn;
}

function it(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

// Test fixture: Create a small corpus with known searchable content
const FIXTURE_CORPUS = [
  {
    id: "chunk-001",
    documentId: "doc-001",
    idx: 0,
    content: "The quick brown fox jumps over the lazy dog. This is a classic pangram used in typography.",
    charCount: 89,
    wordCount: 16
  },
  {
    id: "chunk-002",
    documentId: "doc-001",
    idx: 1,
    content: "SQLite is a lightweight embedded database engine. It uses SQL for queries and supports full-text search via FTS5.",
    charCount: 114,
    wordCount: 18
  },
  {
    id: "chunk-003",
    documentId: "doc-002",
    idx: 0,
    content: "Machine learning models require large datasets for training. Neural networks learn patterns from data.",
    charCount: 103,
    wordCount: 15
  },
  {
    id: "chunk-004",
    documentId: "doc-002",
    idx: 1,
    content: "Python is a popular programming language for data science and machine learning. It has excellent libraries like NumPy and TensorFlow.",
    charCount: 134,
    wordCount: 20
  },
  {
    id: "chunk-005",
    documentId: "doc-003",
    idx: 0,
    content: "TypeScript adds static typing to JavaScript. It helps catch bugs early and improves code maintainability.",
    charCount: 106,
    wordCount: 15
  }
];

describe("FTS5 BM25 Keyword Index", () => {
  let testDir: string;
  let dbPath: string;
  let db: ReturnType<typeof initDatabase>;
  let retriever: RetrieverService;

  before(() => {
    // Create temp directory for test database
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "fts5-test-"));
    dbPath = path.join(testDir, "test.db");

    // Initialize database and run migrations
    db = initDatabase(testDir);
    runMigrations(db);

    // Insert test documents (required for foreign key constraints)
    const insertDoc = db.prepare(`
      INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertDoc.run("doc-001", "Document 1", "doc1.txt", 1024, new Date().toISOString(), "ready", 100, 10, "txt");
    insertDoc.run("doc-002", "Document 2", "doc2.txt", 2048, new Date().toISOString(), "ready", 150, 15, "txt");
    insertDoc.run("doc-003", "Document 3", "doc3.txt", 512, new Date().toISOString(), "ready", 80, 8, "txt");

    // Insert fixture corpus into chunks table
    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);

    for (const chunk of FIXTURE_CORPUS) {
      insertChunk.run(chunk.id, chunk.documentId, chunk.idx, chunk.content, chunk.charCount, chunk.wordCount);
    }

    // Initialize RetrieverService
    retriever = new RetrieverService(db);
  });

  after(() => {
    db.close();
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("chunks_fts virtual table exists", () => {
    const stmt = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='chunks_fts'
    `);
    const result = stmt.get() as { name: string } | undefined;
    
    assert.ok(result, "chunks_fts table should exist");
    assert.equal(result.name, "chunks_fts");
  });

  it("chunks_fts has BM25 ranking available", () => {
    // Test that bm25() function works
    const stmt = db.prepare(`
      SELECT bm25(chunks_fts) as score
      FROM chunks_fts
      WHERE chunks_fts MATCH 'database'
      LIMIT 1
    `);
    const result = stmt.get() as { score: number } | undefined;
    
    // Should return a result (score will be negative per BM25 convention)
    assert.ok(result !== undefined, "BM25 function should work");
    assert.ok(typeof result.score === "number", "Score should be a number");
  });

  it("FTS index contains all inserted chunks", () => {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM chunks_fts
    `);
    const result = stmt.get() as { count: number };
    
    assert.equal(result.count, FIXTURE_CORPUS.length, `FTS should contain ${FIXTURE_CORPUS.length} chunks`);
  });

  it("INSERT trigger keeps FTS in sync", () => {
    // Insert a new chunk
    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
    const result = insertChunk.run("chunk-099", "doc-003", 1, "This is a new chunk for testing triggers.", 43, 8);
    const newRowid = result.lastInsertRowid as number;

    // Verify it appears in FTS
    const stmt = db.prepare(`
      SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'triggers'
    `);
    const ftsResult = stmt.get() as { rowid: number } | undefined;
    
    assert.ok(ftsResult, "New chunk should be searchable in FTS");
    assert.equal(ftsResult.rowid, newRowid);

    // Clean up
    db.prepare("DELETE FROM chunks WHERE rowid = ?").run(newRowid);
  });

  it("UPDATE trigger keeps FTS in sync", () => {
    // Update chunk content using rowid
    const updateChunk = db.prepare(`
      UPDATE chunks SET content = ? WHERE rowid = 5
    `);
    const newContent = "TypeScript with static typing is excellent for large codebases.";
    updateChunk.run(newContent);

    // Search for new content
    const stmt = db.prepare(`
      SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'codebases'
    `);
    const result = stmt.get() as { rowid: number } | undefined;
    
    assert.ok(result, "Updated content should be searchable");
    assert.equal(result.rowid, 5);

    // Restore original content
    updateChunk.run(FIXTURE_CORPUS[4].content);
  });

  it("DELETE trigger keeps FTS in sync", () => {
    // Insert a temporary chunk
    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
    const result = insertChunk.run("chunk-098", "doc-003", 2, "Temporary chunk with unique word xyzabc.", 40, 6);
    const tempRowid = result.lastInsertRowid as number;

    // Verify it's in FTS
    let stmt = db.prepare(`SELECT COUNT(*) as count FROM chunks_fts WHERE chunks_fts MATCH 'xyzabc'`);
    let countResult = stmt.get() as { count: number };
    assert.equal(countResult.count, 1, "Temporary chunk should be in FTS");

    // Delete the chunk
    db.prepare("DELETE FROM chunks WHERE rowid = ?").run(tempRowid);

    // Verify it's removed from FTS
    stmt = db.prepare(`SELECT COUNT(*) as count FROM chunks_fts WHERE chunks_fts MATCH 'xyzabc'`);
    countResult = stmt.get() as { count: number };
    assert.equal(countResult.count, 0, "Deleted chunk should be removed from FTS");
  });

  it("bm25Search returns results for database query", () => {
    const results = retriever.bm25Search("database");
    
    assert.ok(results.length > 0, "Should return results for 'database'");
    assert.ok(results[0].rowid === 2, "Chunk about SQLite database should rank highest");
    assert.ok(results[0].score > 0, "Score should be positive (negated BM25)");
  });

  it("bm25Search returns results for machine learning query", () => {
    const results = retriever.bm25Search("machine learning");
    
    assert.ok(results.length >= 2, "Should return at least 2 results for 'machine learning'");
    
    // Both chunks 3 and 4 contain "machine learning"
    const rowids = results.map(r => r.rowid);
    assert.ok(rowids.includes(3) || rowids.includes(4), "Should include chunks about machine learning");
    
    // Scores should be in descending order (highest first)
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(results[i].score >= results[i + 1].score, "Results should be sorted by score descending");
    }
  });

  it("bm25Search respects limit parameter", () => {
    const results = retriever.bm25Search("the", 2);
    
    assert.ok(results.length <= 2, "Should respect limit parameter");
  });

  it("bm25Search returns empty array for non-matching query", () => {
    const results = retriever.bm25Search("xyznonexistent123");
    
    assert.equal(results.length, 0, "Should return empty array for non-matching query");
  });

  it("bm25Search returns empty array for empty query", () => {
    const results = retriever.bm25Search("");
    
    assert.equal(results.length, 0, "Should return empty array for empty query");
  });

  it("bm25Search: 'fox' query returns pangram chunk in top-3", () => {
    const results = retriever.bm25Search("fox", 10);
    
    assert.ok(results.length > 0, "Should return results for 'fox'");
    
    const topThreeRowids = results.slice(0, 3).map(r => r.rowid);
    assert.ok(topThreeRowids.includes(1), "Pangram chunk (rowid 1) should be in top-3 for 'fox' query");
  });

  it("bm25Search: 'typescript static' query returns TypeScript chunk in top-3", () => {
    const results = retriever.bm25Search("typescript static", 10);
    
    assert.ok(results.length > 0, "Should return results for 'typescript static'");
    
    const topThreeRowids = results.slice(0, 3).map(r => r.rowid);
    assert.ok(topThreeRowids.includes(5), "TypeScript chunk (rowid 5) should be in top-3");
  });

  it("bm25Search: 'python programming' query returns Python chunk in top-3", () => {
    const results = retriever.bm25Search("python programming", 10);
    
    assert.ok(results.length > 0, "Should return results for 'python programming'");
    
    const topThreeRowids = results.slice(0, 3).map(r => r.rowid);
    assert.ok(topThreeRowids.includes(4), "Python chunk (rowid 4) should be in top-3");
  });

  it("getChunksByRowids returns full chunk details", () => {
    const results = retriever.bm25Search("database", 1);
    assert.ok(results.length > 0, "Should have search results");
    
    const chunks = retriever.getChunksByRowids(results.map(r => r.rowid));
    
    assert.equal(chunks.length, results.length, "Should return all requested chunks");
    assert.ok(chunks[0].content, "Should include content");
    assert.ok(chunks[0].documentId, "Should include documentId");
    assert.ok(typeof chunks[0].idx === "number", "Should include idx");
    assert.ok(typeof chunks[0].charCount === "number", "Should include charCount");
    assert.ok(typeof chunks[0].wordCount === "number", "Should include wordCount");
  });

  it("getChunksByRowids preserves order", () => {
    const rowids = [5, 2, 4];
    const chunks = retriever.getChunksByRowids(rowids);
    
    assert.equal(chunks.length, 3, "Should return 3 chunks");
    assert.equal(chunks[0].rowid, 5, "First chunk should have rowid 5");
    assert.equal(chunks[1].rowid, 2, "Second chunk should have rowid 2");
    assert.equal(chunks[2].rowid, 4, "Third chunk should have rowid 4");
  });

  it("getChunksByRowids returns empty array for empty input", () => {
    const chunks = retriever.getChunksByRowids([]);
    
    assert.equal(chunks.length, 0, "Should return empty array");
  });
});

// Run tests
console.log("\n=== Running FTS5 BM25 Tests ===\n");

async function runTests() {
  try {
    if (beforeFn) {
      console.log("Setting up test environment...");
      await beforeFn();
      console.log("Setup complete.\n");
    }

    for (const test of tests) {
      try {
        await test.fn();
        console.log(`✅ ${test.name}`);
        passCount++;
      } catch (error) {
        console.log(`❌ ${test.name}`);
        console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          console.error(`   ${error.stack.split("\n").slice(1, 3).join("\n   ")}`);
        }
        failCount++;
      }
    }

    if (afterFn) {
      console.log("\nCleaning up...");
      await afterFn();
    }

    console.log(`\n=== Test Summary ===`);
    console.log(`Total: ${passCount + failCount}`);
    console.log(`✅ Passed: ${passCount}`);
    console.log(`❌ Failed: ${failCount}`);

    if (failCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Test runner failed:", error);
    process.exit(1);
  }
}

runTests();
