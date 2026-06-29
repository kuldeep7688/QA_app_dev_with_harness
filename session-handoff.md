# Session Handoff

## Current State (2026-06-28)

### Recently Completed (2026-06-28)

**QaService Wired to Hybrid Retriever** (2026-06-28)
- QaService.ask() now calls retriever.hybridSearch() instead of getAllChunks() + keyword overlap
- Citations carry bm25Rank, vectorRank, sources (Array<'bm25'|'vector'>) for debug and source badges
- Confidence derived dynamically from fused score distribution: topScore * 30 + both-sources bonus + gap-to-second bonus, capped at [0,1]
- QaService constructor simplified to `(db, embedFn)` — removed PersistenceService and IndexingService dependencies
- Fixed bm25Search() in retriever.ts to sanitize FTS5 queries: strip `?'"()` chars and remove English stopwords/question words to prevent FTS5 implicit-AND failures
- Created test/qa-hybrid.test.ts with 7 integration tests all PASS: empty state, citations metadata, dynamic confidence, retrieval debug fields, history persistence, clear history
- Updated main.ts, demo test, and persistence test to use new QaService constructor
- TypeScript compiles 0 errors, all 56 test assertions pass

### Recently Completed

**Hybrid Retriever (BM25 + Vector via RRF)** (2026-06-28)
- Created pure `src/services/retriever.ts` with `hybridSearch(db, query, embedFn, opts?)` function
- BM25 search via FTS5 + bm25() ranking with porter stemming
- Vector search via sqlite-vec KNN with proper vec_rowid JOIN to chunks table
- Reciprocal Rank Fusion (RRF) merging with configurable k (default 60)
- Three modes: `hybrid` | `bm25` | `vector` via `opts.mode`
- Configurable topN (per-source), topK (final), rrfK
- Deterministic tie-breaking via chunk rowid (stable secondary key)
- Structured logging at INFO/DEBUG for all operations
- All 20 integration tests PASS (49 total across 6 vitest suites)

**Migration 004: vec_rowid Link** (2026-06-28)
- Created `src/services/migrations/004_vec_link.sql` adding `vec_rowid INTEGER` to chunks table
- Updated `indexing-service.ts` to store `vec_rowid` in both `indexChunksWithEmbeddings()` and `rebuildEmbeddings()`
- Fixes the fragile implicit rowid alignment between chunks and chunks_vec tables
- Enables proper SQL JOIN: `chunks_vec.rowid = chunks.vec_rowid`

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
| vector-extension-load | ✅ pass |
| embedding-service | ✅ pass |
| chunk-pipeline-rewrite | ✅ pass |
| reindex-embeddings | ✅ pass |
| hybrid-retriever | ✅ pass |
| qa-uses-hybrid | ✅ pass |

**30 features complete!** (20 original + 4 SQLite/migration + 6 Phase B/C)

### Files Modified (2026-06-28 - Hybrid Retriever Implementation)

- `src/services/retriever.ts` — NEW: Pure hybridSearch function with BM25 + Vector + RRF fusion (230 lines)
- `src/services/migrations/004_vec_link.sql` — NEW: Adds vec_rowid column to chunks table for proper join
- `src/services/indexing-service.ts` — UPDATED: Stores vec_rowid in both indexChunksWithEmbeddings and rebuildEmbeddings
- `test/hybrid-retriever.test.ts` — NEW: 20 integration tests for hybrid, bm25, vector modes (400 lines)
- `feature_list.json` — hybrid-retriever status="pass" with evidence
- `docs/ARCHITECTURE.md` — UPDATED: Schema includes vec_rowid, pipeline includes vec_rowid JOIN, IPC table expanded
- `session-handoff.md` — Updated with latest feature status and evidence

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

### Files Modified (2026-06-28 - QaService Hybrid Wired)

- `src/shared/types.ts` — UPDATED: Citation interface adds bm25Rank, vectorRank, sources fields
- `src/services/qa-service.ts` — REWRITTEN: uses hybridSearch(), dynamic confidence, simplified constructor (db, embedFn)
- `src/services/retriever.ts` — UPDATED: bm25Search() sanitizes queries (strips stopwords/question words + special chars)
- `src/main/main.ts` — UPDATED: passes embed to QaService constructor
- `test/qa-hybrid.test.ts` — NEW: 7 integration tests for hybrid-wired Q&A
- `test/persistence.test.ts` — UPDATED: uses new QaService(db, embed) constructor
- `test/sqlite-workflow-demo.test.ts` — UPDATED: uses new QaService(db, embed) constructor
- `docs/ARCHITECTURE.md` — UPDATED: Q&A flow reflects hybrid retriever, dynamic confidence
- `feature_list.json` — qa-uses-hybrid status="pass" with evidence
- `session-handoff.md` — Updated with latest feature status

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

### Recently Completed (2026-06-29)

**Retrieval Debug IPC** (2026-06-29)
- Added RETRIEVE_DEBUG IPC channel (`qa:retrieve-debug`) to shared types
- Created `debugSearch()` in `retriever.ts` that returns bm25Results (rowid, score, rank), vectorResults (rowid, distance, rank), and fusedResults (full HybridSearchResult[] with chunk details)
- Refactored `hybridSearch` to share `internalHybridSearch` helper, eliminating code duplication
- Added `retrieveDebug()` method to QaService (delegates to debugSearch, logged at DEBUG)
- Registered IPC handler in ipc-handlers.ts (logged at DEBUG)
- Exposed via preload qa namespace
- Created test/retrieval-debug.test.ts with 11 tests all PASS
- TypeScript compiles 0 errors, build succeeds

**Feature Status Update:** 32 features complete! (36 total)

## Recently Completed (2026-06-29)

**Retrieval Settings** (Phase E. Settings & UX) — 2026-06-29
- Created `src/services/settings-service.ts` with `SettingsService` class: in-memory cache, `readJson/writeJson` to `<dataDir>/settings.json`, sensible defaults (hybrid, topK=5, topN=20, rrfK=60, embeddingsEnabled=true)
- Validation rejects invalid values with WARN log: bad mode, negative/zero/float numbers, non-boolean
- Added `RetrievalSettings` interface and `settings:get`/`settings:set` IPC channels to `src/shared/types.ts`
- Updated `QaService` to accept `getSettings` callback; passes `retrievalMode`/`topK`/`topN`/`rrfK` as opts to `hybridSearch` and `debugSearch`
- Registered IPC handlers in `src/main/ipc-handlers.ts`; injected into `main.ts` via `SettingsService`
- Exposed `settings.get/settings.set` in preload and renderer type declarations
- Created `SettingsPanel` modal overlay UI component (mode dropdown, number inputs, checkbox, Save/Cancel)
- Added Settings button in App.tsx header
- 31 integration tests covering: defaults, persistence across instances, update, disk reload, cache, invalid value rejection (6 types), partial updates, getDefaults isolation, corrupted file fallback
- TypeScript compiles 0 errors, build succeeds (35 modules)
- `docs/ARCHITECTURE.md` updated with settings IPC table and services layer

## Next Features to Implement

**Phase D: Quality Measurement (3 features)**
- golden-eval-set - Create test queries with expected chunks
- eval-runner - Automated precision@5 and MRR measurement
- eval-in-ci - CI integration for regression detection

**Phase E: Settings & UX (1 feature)**
- citation-source-badge - UI badges showing BM25/vector/hybrid sources

## If Resuming This Session

1. Read `AGENTS.md` for project conventions and startup rules
2. Run `npm run check` to verify build health (should show 0 errors)
3. Run `bash init.sh` for full verification (should show "Init complete. All checks passed.")
4. Read `feature_list.json` to see current feature status (32/36 complete)
5. Next: Implement **golden-eval-set** feature from Phase D, **citation-source-badge** from Phase E, or continue with Phase D features
6. Testing notes:
   - Use `npx vitest run test/<test-file>.ts` to run individual tests (vitest-compatible tests only)
   - Some old test files use custom runners and are incompatible with vitest (pre-existing)
   - Tests require `npm rebuild better-sqlite3` if NODE_MODULE_VERSION error occurs
   - Hybrid retriever tests seed 10 fixture chunks with real MiniLM embeddings (384-dim)
