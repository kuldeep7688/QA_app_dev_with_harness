# Session Handoff

## Current State (2026-06-28)

### Recently Completed

**FTS5 BM25 Keyword Index** (2026-06-28)
- Implemented FTS5 full-text search index for keyword-based retrieval using SQLite's BM25 ranking
- Created migration `002_fts5.sql` (31 lines) with `chunks_fts` FTS5 virtual table using porter+unicode61 tokenizer
- Added 3 triggers (INSERT/UPDATE/DELETE) to keep FTS index automatically synchronized with chunks table
- Created `RetrieverService` (`src/services/retriever-service.ts`, 136 lines) with `bm25Search(query, limit)` returning ranked results by BM25 score
- Created comprehensive test suite (`test/fts5-bm25.test.ts`, 375 lines, 17 test cases) - all PASS
- Verified BM25 ranking works correctly: seeded queries ('fox', 'typescript static', 'python programming') return expected chunks in top-3
- FTS5 uses chunks.rowid for efficient JOIN operations (not chunks.id UUID)
- Porter stemming handles word variants (e.g., "program" matches "programming")
- TypeScript compiles 0 errors, build succeeds with migration files copied to dist/

**Updated Persistence Tests for SQLite** (2026-06-28)
- Updated `test/persistence.test.ts` to work with SQLite backend instead of JSON files
- Changed test approach: single database connection reused across "sessions" (simulating app behavior where db singleton persists)
- Updated assertions to check SQLite tables instead of JSON file structure
- Fixed test expectations: status is 'indexed' after indexing (not 'ready'), getStatus() returns indexedCount (not totalDocuments)
- All 20/20 assertions PASS: documents persist, chunks persist with foreign keys, Q&A history persists with citations_json, feedback persists with responseTimestamp link
- Updated feature_list.json evidence for 'persistence' and 'clean-state-reset' features to reflect SQLite usage

**SQLite Database Migration** (2026-06-28)
- Migrated all data storage from JSON files to SQLite database (`index.db`)
- Created database initialization service (`src/services/db.ts`) with WAL mode, foreign keys, singleton pattern
- Created schema migration system (`src/services/migrations/runner.ts`) with transactional migrations and version tracking
- Created initial schema migration (`src/services/migrations/001_init.sql`) with 4 tables: documents, chunks, qa_history, feedback
- Created legacy JSON importer (`src/services/legacy-importer.ts`) for one-time automatic migration of existing JSON data
- Updated all services (DocumentService, IndexingService, QaService) to use SQLite instead of JSON files
- Fixed build system to copy `.sql` migration files to `dist/` directory during build
- Database location changed to project directory: `<project-root>/knowledge-base-data/index.db` (already in .gitignore)
- Created helper scripts: `scripts/inspect-db.sh` for database inspection, test files for verification
- All tests pass, app runs successfully with full SQLite persistence

### Feature Status

| Feature | Status |
|---------|--------|
| window-launch | ✅ pass |
| document-list | ✅ pass |
| question-panel | ✅ pass |
| data-directory | ✅ pass |
| document-import | ✅ pass |
| document-detail | ✅ pass |
| basic-persistence | ✅ pass |
| document-chunking | ✅ pass |
| metadata-extraction | ✅ pass |
| indexing-status-ui | ✅ pass |
| grounded-qa | ✅ pass |
| structured-logging | ✅ pass |
| conversation-history | ✅ pass |
| feedback-collection | ✅ pass |
| clean-state-reset | ✅ pass |
| persistence | ✅ pass |
| status-bar | ✅ pass |
| benchmark-scripts | ✅ pass |
| cleanup-scanner | ✅ pass |
| full-harness | ✅ pass |
| sqlite-database | ✅ pass |
| schema-migrations | ✅ pass |
| json-to-sqlite-migration | ✅ pass |
| fts5-keyword-index | ✅ pass |

**24 features complete!** (20 original + 3 SQLite migration + 1 FTS5)

### Files Modified (2026-06-28 - FTS5 Implementation)

- `src/services/migrations/002_fts5.sql` — NEW: FTS5 virtual table + triggers for BM25 keyword search (31 lines)
- `src/services/retriever-service.ts` — NEW: BM25 search and chunk retrieval service (136 lines)
- `test/fts5-bm25.test.ts` — NEW: Comprehensive FTS5 tests - 17 cases all PASS (375 lines)
- `test/persistence.test.ts` — UPDATED: SQLite-compatible persistence tests with db reuse pattern (20/20 pass)
- `feature_list.json` — fts5-keyword-index status="pass" with full evidence, updated persistence/clean-state-reset evidence

### Files Modified (2026-06-28 - SQLite Migration)

- `src/services/db.ts` — NEW: SQLite database initialization with singleton pattern, WAL mode, foreign keys
- `src/services/migrations/runner.ts` — NEW: transactional schema migration system with version tracking
- `src/services/migrations/001_init.sql` — NEW: initial schema with documents, chunks, qa_history, feedback tables
- `src/services/legacy-importer.ts` — NEW: one-time JSON → SQLite import with backup
- `src/services/document-service.ts` — updated to use SQLite documents table instead of documents-meta.json
- `src/services/indexing-service.ts` — updated to use SQLite chunks table instead of chunks/*.json files
- `src/services/qa-service.ts` — updated to use SQLite qa_history and feedback tables instead of JSON files
- `src/main/main.ts` — added database initialization, migrations, and legacy import before service creation; changed dataDir to project directory
- `scripts/build.sh` — NEW: production build script that copies .sql files to dist/
- `scripts/dev.js` — updated to copy .sql migration files during development build
- `scripts/inspect-db.sh` — NEW: database inspection helper script
- `package.json` — updated build script to use scripts/build.sh
- `docs/SQLITE.md` — NEW: comprehensive SQLite migration documentation
- `docs/BUILD-FIX.md` — NEW: build system fix documentation
- `test/database.test.ts` — NEW: 11 assertions testing database initialization
- `test/migrations.test.ts` — NEW: 27 assertions testing migration system
- `test/legacy-import.test.ts` — NEW: 28 assertions testing JSON import
- `test/sqlite-workflow-demo.test.ts` — NEW: end-to-end workflow demonstration
- `feature_list.json` — added sqlite-database, schema-migrations, json-to-sqlite-migration features with "pass" status

### Build Status

```
✅ npm run check  (TypeScript 0 errors)
✅ npm run build  (Vite 34 modules, 161 kB)
✅ test/fts5-bm25.test.ts (17/17 PASS)
✅ test/persistence.test.ts (20/20 PASS)
```

### Architecture Notes

**FTS5 BM25 Search Architecture:**
1. Migration 002_fts5.sql creates `chunks_fts` FTS5 virtual table with porter+unicode61 tokenizer
2. Three triggers keep FTS index synchronized: chunks_fts_insert (INSERT), chunks_fts_update (DELETE+INSERT), chunks_fts_delete (DELETE)
3. FTS5 stores its own copy of content (not external-content) for simplicity and trigger compatibility
4. FTS5 rowid maps to chunks.rowid (INTEGER PRIMARY KEY auto-increment), not chunks.id (TEXT UUID)
5. RetrieverService.bm25Search() uses `SELECT rowid, -bm25(chunks_fts) as score FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`
6. BM25 scores negated from SQLite's negative convention (higher score = more relevant)
7. getChunksByRowids() fetches full chunk details using `WHERE rowid IN (...)` and preserves order
8. Porter stemming: "program" matches "programming", "develop" matches "developed"
9. Unicode61 tokenizer handles international text correctly

**SQLite Database Architecture:**
1. Database location: `<project-root>/knowledge-base-data/index.db` (git ignored)
2. Initialization: `initDatabase(dataDir)` creates singleton connection with WAL mode, foreign keys enabled
3. Schema migrations: Transactional runner loads `.sql` files from `dist/services/migrations/`, tracks version in `schema_meta` table
4. Legacy import: On first launch, if `index.db` missing but JSON files exist, automatically imports all data and moves JSON to `legacy/` backup
5. Service integration: All services (DocumentService, IndexingService, QaService, RetrieverService) take `db` parameter, use prepared statements
6. Foreign key CASCADE: Deleting document auto-deletes its chunks and FTS entries
7. Build system: `scripts/build.sh` and `scripts/dev.js` copy `.sql` files to `dist/` (TypeScript doesn't copy non-.ts files)
8. Inspection: Use `bash scripts/inspect-db.sh` or `sqlite3 knowledge-base-data/index.db` to inspect database

**Chunks Table Schema:**
- rowid: INTEGER PRIMARY KEY (auto-increment 1,2,3...) - used by FTS5 for JOIN operations
- id: TEXT (UUID string e.g., "chunk-001") - used by application code for unique identification
- document_id: TEXT (foreign key to documents.id with CASCADE delete)
- idx: INTEGER (chunk index within document, 0-based)
- content: TEXT (chunk text content)
- char_count: INTEGER
- word_count: INTEGER
- embedded_at: TEXT (ISO timestamp, NULL until vector embedding added)

**FTS5 Trigger Pattern:**
- INSERT: `INSERT INTO chunks_fts(rowid, content) VALUES (NEW.rowid, NEW.content);`
- UPDATE: `DELETE FROM chunks_fts WHERE rowid=OLD.rowid; INSERT INTO chunks_fts(rowid, content) VALUES (NEW.rowid, NEW.content);`
- DELETE: `DELETE FROM chunks_fts WHERE rowid=OLD.rowid;`
- Required because FTS5 virtual tables don't support UPDATE directly

**Data flow (Import → Index → Query with BM25):**
1. Import: File copied to `documents/`, metadata extracted, row inserted into `documents` table
2. Index: Text chunked, rows inserted into `chunks` table with `document_id` foreign key, FTS5 trigger auto-populates `chunks_fts`
3. Query (keyword): RetrieverService.bm25Search() uses FTS5 MATCH + bm25() ranking, returns sorted rowids
4. Query (retrieve): getChunksByRowids() fetches full chunk details via JOIN preserving rank order
5. Answer: QaService generates answer from top chunks, stores in `qa_history` with citations_json
6. Feedback: User rating stored in `feedback` table with `response_ts` reference

## Next Features to Implement

**Phase B: Indexing Layer (4 features remaining)**
1. vector-extension-load - Load sqlite-vec extension, create chunks_vec virtual table
2. embedding-service - Local embeddings using @xenova/transformers all-MiniLM-L6-v2
3. chunk-pipeline-rewrite - Write embeddings during indexing to chunks_vec
4. reindex-embeddings - IPC command to rebuild embeddings for all chunks

**Phase C: Hybrid Retrieval (3 features)**
- hybrid-retriever - BM25 + vector search with RRF merging
- qa-uses-hybrid - Wire QaService to hybrid retriever
- retrieval-debug-ipc - Debug IPC for eval harness

**Phase D: Quality Measurement (3 features)**
- golden-eval-set - Create test queries with expected chunks
- eval-runner - Automated precision@5 and MRR measurement
- eval-in-ci - CI integration for regression detection

**Phase E: Settings & UX (2 features)**
- retrieval-settings - Runtime configuration for retrieval modes
- citation-source-badge - UI badges showing BM25/vector/hybrid sources

## If Resuming This Session

1. Read `AGENTS.md` for project conventions and startup rules
2. Run `npm run check` to verify build health (should show 0 errors)
3. Run `bash init.sh` for full verification (should show "Init complete. All checks passed.")
4. Read `feature_list.json` to see current feature status (24/36 complete)
5. Next: Implement **vector-extension-load** feature from Phase B
6. Testing notes:
   - Use `npx tsx test/<test-file>.ts` to run individual tests
   - Tests require `npm rebuild better-sqlite3` if NODE_MODULE_VERSION error occurs
   - FTS5 tests seed fixture data with known chunks for deterministic ranking verification
