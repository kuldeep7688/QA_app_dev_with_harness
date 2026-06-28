import { initDatabase } from "../src/services/db.js";
import { runMigrations } from "../src/services/migrations/runner.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "debug-fts-"));
const db = initDatabase(testDir);
runMigrations(db);

// Insert document
db.prepare("INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("doc-001", "Test Doc", "test.txt", 100, new Date().toISOString(), "ready", 10, 1, "txt");

// Insert chunk
db.prepare("INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(1, "doc-001", 0, "Hello world from TypeScript", 27, 4);

console.log("\n1. After INSERT:");
console.log("chunks:", db.prepare("SELECT id, content FROM chunks").all());
console.log("chunks_fts:", db.prepare("SELECT rowid, content FROM chunks_fts").all());

// UPDATE chunk
db.prepare("UPDATE chunks SET content = ? WHERE id = 1").run("Updated content with new words");

console.log("\n2. After UPDATE:");
console.log("chunks:", db.prepare("SELECT id, content FROM chunks").all());
console.log("chunks_fts:", db.prepare("SELECT rowid, content FROM chunks_fts").all());

// Test search for new content
const searchResult = db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'Updated'").all();
console.log("Search for 'Updated':", searchResult);

// DELETE chunk
db.prepare("DELETE FROM chunks WHERE id = 1").run();

console.log("\n3. After DELETE:");
console.log("chunks:", db.prepare("SELECT id, content FROM chunks").all());
console.log("chunks_fts:", db.prepare("SELECT rowid, content FROM chunks_fts").all());

// Clean up
db.close();
fs.rmSync(testDir, { recursive: true, force: true });
