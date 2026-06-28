import { initDatabase } from "../src/services/db.js";
import { runMigrations } from "../src/services/migrations/runner.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "debug-update-"));
const db = initDatabase(testDir);
runMigrations(db);

// Insert document and chunk
db.prepare("INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("doc-001", "Test Doc", "test.txt", 100, new Date().toISOString(), "ready", 10, 1, "txt");
db.prepare("INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(1, "doc-001", 0, "Original content", 16, 2);

console.log("Before UPDATE:");
console.log("chunks:", db.prepare("SELECT id, content FROM chunks WHERE id = 1").get());
console.log("chunks_fts:", db.prepare("SELECT rowid, content FROM chunks_fts WHERE rowid = 1").get());

// Try UPDATE with result
const updateResult = db.prepare("UPDATE chunks SET content = ? WHERE id = 1").run("New updated content");
console.log("\nUPDATE result:", updateResult);

console.log("\nAfter UPDATE:");
console.log("chunks:", db.prepare("SELECT id, content FROM chunks WHERE id = 1").get());
console.log("chunks_fts:", db.prepare("SELECT rowid, content FROM chunks_fts WHERE rowid = 1").get());

// Clean up
db.close();
fs.rmSync(testDir, { recursive: true, force: true });
