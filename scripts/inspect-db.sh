#!/usr/bin/env bash
#
# inspect-db.sh - Quick database inspection script
# Shows summary of all data in the SQLite database
#

set -euo pipefail

# Get the project root directory (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default to project directory
DATA_DIR="$PROJECT_ROOT/knowledge-base-data"

# Allow override via argument (can be data dir or full db path)
if [ $# -gt 0 ]; then
  if [[ "$1" == *.db ]]; then
    DB_PATH="$1"
  else
    DATA_DIR="$1"
    DB_PATH="$DATA_DIR/index.db"
  fi
else
  DB_PATH="$DATA_DIR/index.db"
fi

echo "=== Knowledge Base SQLite Database Inspector ==="
echo ""
echo "Database location: $DB_PATH"
echo ""

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at $DB_PATH"
  echo ""
  echo "Make sure you've run the app at least once to create the database."
  exit 1
fi

# Check if sqlite3 is available
if ! command -v sqlite3 &> /dev/null; then
  echo "ERROR: sqlite3 command not found."
  echo ""
  echo "Install it with:"
  echo "  - Fedora/RHEL: sudo dnf install sqlite"
  echo "  - Ubuntu/Debian: sudo apt install sqlite3"
  echo "  - macOS: brew install sqlite"
  exit 1
fi

echo "--- Schema Version ---"
sqlite3 "$DB_PATH" "SELECT key, value FROM schema_meta;"
echo ""

echo "--- Documents ---"
sqlite3 "$DB_PATH" <<SQL
.mode column
.headers on
SELECT id, title, status, word_count, line_count, imported_at 
FROM documents 
ORDER BY imported_at DESC;
SQL
echo ""

echo "--- Documents Count ---"
sqlite3 "$DB_PATH" "SELECT COUNT(*) as total FROM documents;"
echo ""

echo "--- Chunks Count (per document) ---"
sqlite3 "$DB_PATH" <<SQL
.mode column
.headers on
SELECT 
  d.title as document_title,
  COUNT(c.id) as chunk_count,
  SUM(c.word_count) as total_words
FROM documents d
LEFT JOIN chunks c ON d.id = c.document_id
GROUP BY d.id, d.title
ORDER BY d.imported_at DESC;
SQL
echo ""

echo "--- Total Chunks ---"
sqlite3 "$DB_PATH" "SELECT COUNT(*) as total FROM chunks;"
echo ""

echo "--- Q&A History (last 5) ---"
sqlite3 "$DB_PATH" <<SQL
.mode column
.headers on
SELECT 
  substr(question, 1, 50) as question,
  confidence,
  substr(ts, 1, 19) as timestamp
FROM qa_history 
ORDER BY ts DESC 
LIMIT 5;
SQL
echo ""

echo "--- Q&A History Count ---"
sqlite3 "$DB_PATH" "SELECT COUNT(*) as total FROM qa_history;"
echo ""

echo "--- Feedback Summary ---"
sqlite3 "$DB_PATH" <<SQL
.mode column
.headers on
SELECT 
  rating,
  COUNT(*) as count
FROM feedback
GROUP BY rating;
SQL
echo ""

echo "--- Feedback Count ---"
sqlite3 "$DB_PATH" "SELECT COUNT(*) as total FROM feedback;"
echo ""

echo "=== Inspection Complete ==="
echo ""
echo "To open an interactive SQL shell, run:"
echo "  sqlite3 $DB_PATH"
