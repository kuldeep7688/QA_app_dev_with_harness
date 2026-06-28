# SQLite Migration Complete

All application data is now stored in SQLite instead of JSON files.

## What Changed

**Before (JSON files):**
- `documents-meta.json` - Document metadata
- `chunks/*.json` - Individual chunk files
- `qa-history.json` - Q&A conversation history
- `feedback.json` - User feedback

**After (SQLite database):**
- `index.db` - Single SQLite database with 4 tables:
  - `documents` - Document metadata
  - `chunks` - Text chunks for retrieval
  - `qa_history` - Q&A conversation history
  - `feedback` - User feedback

## How It Works

### When you use the app:

1. **Import a document** → Saved to `documents` table
   ```sql
   INSERT INTO documents (id, title, filename, size, word_count, ...)
   ```

2. **Index the document** → Chunks saved to `chunks` table
   ```sql
   INSERT INTO chunks (id, document_id, idx, content, word_count, ...)
   ```

3. **Ask a question** → Answer saved to `qa_history` table
   ```sql
   INSERT INTO qa_history (question, answer, confidence, citations_json, ts)
   ```

4. **Submit feedback** → Saved to `feedback` table
   ```sql
   INSERT INTO feedback (question_ts, question, rating, submitted_at)
   ```

## Database Location

The database is stored in the **project directory** for easier development:

```
<project-root>/knowledge-base-data/index.db
```

This folder is already in `.gitignore`, so the database won't be committed to version control.

**Note for production:** You may want to change this to use `app.getPath('userData')` for a standard user data location.

## How to Inspect the Database

### Option 1: Use the helper script

```bash
bash scripts/inspect-db.sh
```

Shows a summary of all data in the database.

### Option 2: Use sqlite3 command-line tool

```bash
# Open the database (from project root)
sqlite3 knowledge-base-data/index.db

# List all tables
.tables

# Show documents
SELECT * FROM documents;

# Show chunks (first 5)
SELECT * FROM chunks LIMIT 5;

# Show Q&A history
SELECT question, confidence, ts FROM qa_history ORDER BY ts DESC;

# Show feedback
SELECT rating, COUNT(*) FROM feedback GROUP BY rating;

# Count everything
SELECT 
  (SELECT COUNT(*) FROM documents) as docs,
  (SELECT COUNT(*) FROM chunks) as chunks,
  (SELECT COUNT(*) FROM qa_history) as questions,
  (SELECT COUNT(*) FROM feedback) as feedback;

# Exit
.quit
```

### Option 3: Use a GUI tool

**DB Browser for SQLite** (free, cross-platform):
```bash
# Install
sudo dnf install sqlitebrowser  # Fedora/RHEL
sudo apt install sqlitebrowser  # Ubuntu/Debian
brew install --cask db-browser-for-sqlite  # macOS

# Open (from project root)
sqlitebrowser knowledge-base-data/index.db
```

## Demo

Run the workflow demo to see it in action:

```bash
npx tsx test/sqlite-workflow-demo.test.ts
```

This demonstrates:
1. Importing a document
2. Indexing it (creating chunks)
3. Asking a question
4. Submitting feedback
5. How to inspect the resulting database

## Legacy Data Migration

If you had existing JSON data files, they were automatically migrated on first launch:

1. App detects `index.db` doesn't exist but JSON files do
2. Runs one-time import from JSON → SQLite
3. Moves JSON files to `legacy/` directory as backup
4. Future launches use SQLite exclusively

Check the logs for:
```
"Legacy import completed successfully"
```

## Key Benefits

1. **Performance**: Single database connection, no file I/O overhead
2. **ACID**: Transactions guarantee data consistency
3. **Foreign keys**: Deleting a document auto-deletes its chunks
4. **Queries**: Fast lookups with indexes
5. **Scalability**: Handles thousands of documents efficiently
6. **Tools**: Standard SQL tools for inspection and debugging

## Schema

### documents table
```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  word_count INTEGER DEFAULT 0,
  line_count INTEGER DEFAULT 0,
  file_type TEXT
);
```

### chunks table
```sql
CREATE TABLE chunks (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  line_start INTEGER,
  line_end INTEGER
);
CREATE INDEX idx_chunks_doc ON chunks(document_id);
```

### qa_history table
```sql
CREATE TABLE qa_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  confidence REAL NOT NULL,
  citations_json TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX idx_qa_ts ON qa_history(ts DESC);
```

### feedback table
```sql
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_ts TEXT NOT NULL,
  question TEXT NOT NULL,
  rating TEXT NOT NULL CHECK(rating IN ('positive', 'negative')),
  comment TEXT,
  submitted_at TEXT NOT NULL
);
CREATE INDEX idx_feedback_ts ON feedback(submitted_at DESC);
```

## Files Modified

- `src/services/db.ts` - Database initialization and singleton
- `src/services/migrations/runner.ts` - Schema migration runner
- `src/services/migrations/001_init.sql` - Initial schema
- `src/services/legacy-importer.ts` - One-time JSON → SQLite import
- `src/services/document-service.ts` - Now uses SQLite
- `src/services/indexing-service.ts` - Now uses SQLite
- `src/services/qa-service.ts` - Now uses SQLite
- `src/main/main.ts` - Initializes database and runs migrations

## Testing

All tests pass:
```bash
npm rebuild better-sqlite3
npx tsx test/database.test.ts
npx tsx test/migrations.test.ts
npx tsx test/legacy-import.test.ts
npx tsx test/sqlite-workflow-demo.test.ts
```

## Troubleshooting

### "Module did not self-register"

Run `npm rebuild better-sqlite3` - this recompiles the native SQLite module for your platform.

### "no such table"

The schema migrations haven't run. Check logs for migration errors, or delete `index.db` to recreate it.

### "SQLITE_CANTOPEN"

The app doesn't have permission to create/write the database file. Check directory permissions.

### "database is locked"

Another process has the database open. Close other connections or wait for write operations to complete.
