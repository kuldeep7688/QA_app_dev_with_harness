import { initDatabase } from "../src/services/db.js";
import { runMigrations } from "../src/services/migrations/runner.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-test-"));
const db = initDatabase(testDir);
runMigrations(db);

// Check if triggers exist
const triggers = db.prepare(`
  SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='chunks'
`).all();

console.log("\n=== Triggers on chunks table ===\n");
for (const trigger of triggers as any[]) {
  console.log(`Trigger: ${trigger.name}`);
  console.log(`SQL: ${trigger.sql}\n`);
}

// Clean up
db.close();
fs.rmSync(testDir, { recursive: true, force: true });
