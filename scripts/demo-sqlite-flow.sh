#!/usr/bin/env bash
#
# demo-sqlite-flow.sh - Demonstrates the full SQLite workflow
# Shows: import → index → query → inspect database
#

set -euo pipefail

echo "=== Knowledge Base SQLite Demo ==="
echo ""
echo "This script demonstrates:"
echo "  1. How data flows through the app (import → index → Q&A)"
echo "  2. How all data is stored in SQLite"
echo "  3. How to inspect the database yourself"
echo ""

# Check if sqlite3 is installed
if ! command -v sqlite3 &> /dev/null; then
  echo "❌ sqlite3 command not found."
  echo ""
  echo "Install it with:"
  echo "  sudo dnf install sqlite  (Fedora/RHEL)"
  echo "  sudo apt install sqlite3 (Ubuntu/Debian)"
  exit 1
fi

# Run the workflow demo
echo "--- Running workflow demo ---"
echo ""
npm rebuild better-sqlite3 >/dev/null 2>&1
npx tsx test/sqlite-workflow-demo.test.ts 2>&1 | grep -v "^{\"timestamp"

# Extract the test directory path
DB_PATH=$(npx tsx test/sqlite-workflow-demo.test.ts 2>&1 | grep "Database Path" -A 1 | tail -1 | xargs)

echo ""
echo "=== Inspecting the SQLite Database ==="
echo ""
echo "Database location: $DB_PATH"
echo ""

# Show database contents
echo "--- Schema Version ---"
sqlite3 "$DB_PATH" "SELECT key, value FROM schema_meta;" | column -t -s '|'
echo ""

echo "--- Documents Table ---"
sqlite3 "$DB_PATH" <<SQL
.mode column
.headers on
SELECT id, title, status, word_count, imported_at FROM documents;
SQL
echo ""

echo "--- Chunks Table ---"
sqlite3 "$DB_PATH" <<SQL
.mode column
.headers on
SELECT id, document_id, idx, word_count, substr(content, 1, 60) || '...' as preview 
FROM chunks;
SQL
echo ""

echo "--- Q&A History Table ---"
sqlite3 "$DB_PATH" <<SQL
.mode column
.headers on
SELECT 
  substr(question, 1, 50) as question,
  confidence,
  length(citations_json) as citations_size,
  ts
FROM qa_history;
SQL
echo ""

echo "--- Feedback Table ---"
sqlite3 "$DB_PATH" <<SQL
.mode column
.headers on
SELECT 
  id,
  rating,
  substr(question, 1, 50) as question,
  submitted_at
FROM feedback;
SQL
echo ""

echo "=== Key Takeaways ==="
echo ""
echo "✓ All documents stored in 'documents' table (not JSON files)"
echo "✓ All chunks stored in 'chunks' table (not chunks/*.json files)"  
echo "✓ All Q&A history in 'qa_history' table (not qa-history.json)"
echo "✓ All feedback in 'feedback' table (not feedback.json)"
echo ""
echo "When you use the app:"
echo "  - Import document → INSERT INTO documents"
echo "  - Index document → INSERT INTO chunks"
echo "  - Ask question → INSERT INTO qa_history"
echo "  - Submit feedback → INSERT INTO feedback"
echo ""
echo "To inspect your app's database:"
echo "  sqlite3 ~/.config/knowledge-base/knowledge-base-data/index.db"
echo ""
echo "Or use the helper script:"
echo "  bash scripts/inspect-db.sh"
echo ""
