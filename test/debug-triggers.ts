import { initDatabase } from "../src/services/db.js";
import { runMigrations } from "../src/services/migrations/runner.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "debug-triggers-"));
const db = initDatabase(testDir);

// Check if recursive triggers are enabled
const rt = db.pragma("recursive_triggers", { simple: true });
console.log("recursive_triggers:", rt);

// Check foreign keys
const fk = db.pragma("foreign_keys", { simple: true });
console.log("foreign_keys:", fk);

runMigrations(db);

// Insert document
db.prepare("INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("doc-001", "Test Doc", "test.txt", 100, new Date().toISOString(), "ready", 10, 1, "txt");

// Insert chunk WITH EXPLICIT OUTPUT
const result = db.prepare("INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(1, "doc-001", 0, "Hello world", 11, 2);
console.log("\nINSERT result:", result);

console.log("\nAfter INSERT:");
console.log("chunks count:", db.prepare("SELECT COUNT(*) as c FROM chunks").get());
console.log("chunks_fts count:", db.prepare("SELECT COUNT(*) as c FROM chunks_fts").get());

// Clean up
db.close();
fs.rmSync(testDir, { recursive: true, force: true });
