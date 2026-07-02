# Session Handoff

## Current State (2026-07-01)

### Recently Completed (2026-07-01)

**LLM Settings Panel** (2026-07-01)
- Added LlmSettings interface to shared/types.ts: modelName, temperature (0-1, default 0.3), maxTokens (default 1024), streamEnabled (default true), systemPrompt
- IPC channels llm:settings:get and llm:settings:set registered
- SettingsService: getLlmSettings(), setLlmSettings(), getLlmDefaults() with validation (temperature clamped at 1.0, maxTokens must be positive integer, streamEnabled must be boolean)
- Fixed data-loss bug: SettingsService.set() now merges with existing data to preserve LLM settings
- SettingsPanel UI: model name text input, temperature slider (0-1, step 0.05), max tokens number input, stream toggle checkbox, system prompt textarea
- QaService accepts getLlmSettings callback; buildPrompt() uses custom systemPrompt; ask()/askStream() pass model/temperature/maxTokens to provider
- 6 new tests all PASS, full suite 163 tests/23 files PASS
- Cleanup scanner reports CLEAN

### Older Completed

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
| retrieval-debug | ✅ pass |
| retrieval-settings | ✅ pass |
| citation-source-badge | ✅ pass |
| env-config | ✅ pass |
| llm-provider-interface | ✅ pass |
| nvidia-llm-provider | ✅ pass |
| llm-health-check | ✅ pass |

**37 features complete!** (20 original + 10 Phases A-E + 7 Phase F)

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

**Citation Source Badges** (Phase E. Settings & UX) — 2026-06-29
- Added `sourceBadge()` helper in `ConversationHistory.tsx` that derives badge label and colors from citation's `sources`, `bm25Rank`, and `vectorRank` fields
- Badge renders inline between confidence percentage and document title in each expanded citation row
- Color-coded: **Hybrid** (purple bg), **BM25 #N** (blue bg), **Vector #N** (green bg)
- Cover-all fallback for edge cases (unknown source values)
- No structural changes to citation layout — click-through and excerpt truncation preserved
- TypeScript 0 errors, Vite builds 35 modules
- `feature_list.json` updated with evidence

**Feature Status Update:** 34 features complete! (36 total)

## Recently Completed (2026-06-29)

**Environment Config** (Phase F. LLM Foundation) — 2026-06-29
- Installed dotenv@16.5.0 npm package
- Created `.env.example` at project root with placeholder values (NVIDIA_API_KEY, NVIDIA_MODEL_NAME, NVIDIA_BASE_URL)
- Created `src/services/env-config.ts` with `loadEnvConfig()`, `getEnvConfig()`, `isLLMEnabled()` — loads `.env` via dotenv, validates API key presence, caches config
- Key logged only as `keyPresent: boolean` and `keyLength: integer` — never the actual value; WARN logged when key missing
- Added `llmEnabled: boolean` to `AppStatus` in types.ts
- Updated `IndexingService.getStatus()` to emit `llmEnabled` via `isLLMEnabled()`
- Updated `main.ts` to call `loadEnvConfig()` before services initialize
- 5 vitest tests all PASS: no .env → llmEnabled=false, .env values read correctly, isLLMEnabled() false when missing, defaults for missing optional values, cache integrity
- TypeScript 0 errors, Vite builds 35 modules

## Recently Completed (2026-06-29)

**Retrieval Debug IPC** (2026-06-29)
- Added RETRIEVE_DEBUG IPC channel (`qa:retrieve-debug`) to shared types
- Created `debugSearch()` in `retriever.ts` that returns bm25Results (rowid, score, rank), vectorResults (rowid, distance, rank), and fusedResults (full HybridSearchResult[] with chunk details)
- Refactored `hybridSearch` to share `internalHybridSearch` helper, eliminating code duplication
- Added `retrieveDebug()` method to QaService (delegates to debugSearch, logged at DEBUG)
- Registered IPC handler in ipc-handlers.ts (logged at DEBUG)
- Exposed via preload qa namespace
- Created test/retrieval-debug.test.ts with 11 tests all PASS
- TypeScript compiles 0 errors, build succeeds

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

## Recently Completed (2026-06-29 — Phase F: LLM Foundation)

**LLM Provider Interface** — 2026-06-29
- Created `src/services/providers/types.ts` with `LlmProvider` interface (chat + chatStream + checkHealth), `ChatMessage`, `ChatResponse`, `StreamChunk`, `LlmOptions`, `TokenUsage` types
- Updated QaService to accept `LlmProvider | null` via 4th constructor parameter
- QaService uses LLM provider for answer generation when available, falls back to mock patterns when null
- Added `buildPrompt()` to QaService that assembles system prompt with citation excerpts + user question
- QAResponse gains `modelUsed` and `tokensUsed` fields

**NVIDIA NIM Provider** — 2026-06-29
- Created `src/services/providers/nvidia-provider.ts` with `NvidiaProvider` class implementing LlmProvider
- Uses OpenAI SDK (`npm install openai`) configured with NVIDIA NIM base URL from env-config
- `chat()` sends model, messages, temperature, max_tokens; parses content + usage from response
- `chatStream()` uses async generator with `stream: true`, yielding delta chunks and final done event
- Both accept AbortSignal via OpenAI client options
- `checkHealth()` sends minimal "hello" chat, classifies errors: 401/403→invalid key, 429→rate limited, others→unavailable

**LLM Health Check** — 2026-06-29
- Added `llm:health` IPC channel, handler, and preload namespace
- Added `llmStatus` ('healthy'|'unhealthy'|'disabled') and `llmModel` to AppStatus interface
- IndexingService.getStatus() emits llmStatus and llmModel from env config
- main.ts wires NvidiaProvider when LLM enabled, passes to ipc-handlers

## Recently Completed (2026-07-01 — Phase G: Streaming, Cancel, Error Handling)

### streaming-answers
- Added `QaService.askStream(question, onChunk, signal?)` method that uses `llmProvider.chatStream()` async generator
- Registered `qa:ask-stream` IPC handler (fire-and-forget with `requestId`), sends `qa:stream-chunk` per delta and `qa:stream-done` on completion
- Preload exposes `qa.askStream()`, `qa.onStreamChunk()`, `qa.onStreamDone()`, `qa.cancel()`
- QuestionPanel shows Cancel button (red) during streaming; input disabled
- ConversationHistory shows typing cursor (▊ blink), incremental token display, error bubbles (red/tinted)
- `activeStreams` Map tracks AbortControllers; cancel deletes from Map
- Fallback: no LLM provider → "LLM not configured" message; no citations → refusal message
- 16 tests all PASS: streaming yields 5 chunks in order, cancel contains `[cancelled]`, no-provider fallback, no-citations refusal, error classification (6 error classes)

### cancel-request
- `qa:cancel` IPC handler aborts the request via `AbortController`
- `QaService.askStream()` passes `AbortSignal` to `llmProvider.chatStream()`
- Cancel detection: provider yields "Request cancelled" error chunk or `signal.aborted` → response with `[cancelled]` suffix
- QuestionPanel: Ask button becomes Cancel during streaming; input disabled
- Pre-aborted signal test verifies `[cancelled]` response

### llm-error-handling
- `classifyLlmError()` function: 401/403→"Invalid API key", 429→"Rate limited", timeout→"Request timed out", 5xx→"Service unavailable", safe generic fallback
- Error messages are predefined strings — no raw API key or response body in user-facing messages
- Errors logged at ERROR with sanitised data
- ConversationHistory renders errors with red background, red text, "error" status indicator

### Feature Status Update: 44 features complete! (49 total)

## Recently Completed (2026-07-01 — Markdown Rendering)

### markdown-rendering
- Installed `react-markdown@10.1.0` + `remark-gfm@4.0.1`
- Updated `ConversationHistory.tsx`:
  - Imported `ReactMarkdown` + `remarkGfm`
  - Replaced plain-text answer rendering with `<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>` for both history entries and streaming partial answers
  - Added `markdownComponents` object with custom renderers:
    - `code` (inline): gold `#ffcc88` text on `#2a2a4e` background, rounded corners
    - `code` (fenced/block): white text on `#0d0d1a` dark background, `#2a2a4e` border, padding, rounded
    - `table/th/td`: bordered dark theme with `#1a1a3e` header backgrounds
    - `blockquote`: purple `#533483` left border, muted `#1a1a2a` background
    - `a`: blue `#88bbff` links with `target="_blank"`
  - Added `@keyframes blink` animation and monospace font stack to `index.html`
  - Plain text degrades gracefully (ReactMarkdown renders it identically)
- TypeScript compiles 0 errors, Vite build succeeds (287 modules, 328 kB)
- init.sh all 5 checks pass

## Next Features to Implement (prioritized)

**Immediate: Phase H: UX & Quality (3 features remaining)**
- token-usage-tracking - Token counts in UI and persistence
- llm-settings - LLM settings panel (model, temperature, etc.)
- answer-eval - Answer quality eval script

**Deferred: Phase D: Quality Measurement (3 features)**
- golden-eval-set - Create test queries with expected chunks
- eval-runner - Automated precision@5 and MRR measurement
- eval-in-ci - CI integration for regression detection

### Additional Changes (2026-07-01 — Gemma compat + LLM Health UI)

- `src/services/providers/nvidia-provider.ts` — UPDATED: `sanitizeMessages()` handles Gemma models (system→user conversion, merge with `Question:` prefix for strict user/assistant alternation)
- `src/services/qa-service.ts` — UPDATED: `DEFAULT_SYSTEM_PROMPT` rewritten from meta-instructions to direct instructions (avoids Gemma preamble)
- `src/renderer/components/StatusBar.tsx` — UPDATED: added LLM status dot + model name next to index dot, uses `AppStatus.llmStatus` and `llmModel`
- `feature_list.json` — llm-health-ui set to "pass" (43/49 complete)

### Files Modified (2026-07-01 — Phase G: Streaming, Cancel, Error Handling)

- `src/services/qa-service.ts` — UPDATED: added `askStream()`, `classifyLlmError()`, import of `StreamChunk`, rewritten `DEFAULT_SYSTEM_PROMPT`
- `src/services/providers/nvidia-provider.ts` — UPDATED: `sanitizeMessages()` for Gemma model compatibility
- `src/main/ipc-handlers.ts` — UPDATED: added `qa:ask-stream` and `qa:cancel` handlers, `activeStreams` Map
- `src/preload/preload.ts` — UPDATED: added streaming API, `STREAM_CHUNK`/`STREAM_DONE` channels
- `src/renderer/types.d.ts` — UPDATED: streaming API type declarations
- `src/renderer/App.tsx` — REWRITTEN: streaming state, event listeners, `isStreaming` flag
- `src/renderer/components/QuestionPanel.tsx` — UPDATED: `onCancel` prop, Cancel button, `isStreaming` prop, disabled input
- `src/renderer/components/ConversationHistory.tsx` — UPDATED: `streamingEntry` prop, error display, token usage, cancelled state
- `src/renderer/components/StatusBar.tsx` — UPDATED: LLM status dot + model name
- `test/llm-provider.test.ts` — UPDATED: 16 tests (10 new)
- `feature_list.json` — 3 Phase G + 2 retroactive Phase F + llm-health-ui → "pass" (43/49 complete)

### Files Modified (2026-07-01 — Markdown Rendering)

- `package.json` — UPDATED: added react-markdown + remark-gfm dependencies
- `src/renderer/components/ConversationHistory.tsx` — UPDATED: ReactMarkdown rendering with custom components for code/tables/blockquotes/links
- `src/renderer/index.html` — UPDATED: added @keyframes blink animation, monospace font stack for code blocks
- `feature_list.json` — markdown-rendering → "pass" (44/49 complete)
- `session-handoff.md` — Updated
- `agent-progress.md` — Updated

1. Read `AGENTS.md` for project conventions and startup rules
2. Run `npm run check` to verify build health (should show 0 errors)
3. Run `bash init.sh` for full verification (should show "Init complete. All checks passed.")
4. Run `npm rebuild better-sqlite3` before vitest tests (if they fail with NODE_MODULE_VERSION mismatch)
5. Read `feature_list.json` to see current feature status (44/49 complete)
6. Next: Implement Phase H features (token-usage-tracking, llm-settings, answer-eval), then Phase D eval features.
7. Testing notes:
   - Use `npx vitest run test/<test-file>.ts` to run individual tests (vitest-compatible tests only)
   - Some old test files use custom runners and are incompatible with vitest (pre-existing)
   - `npm rebuild better-sqlite3` for Node.js when running vitest; `postinstall` rebuilds for Electron
   - Streaming test (llm-provider.test.ts) covers askStream, cancel, error classification
