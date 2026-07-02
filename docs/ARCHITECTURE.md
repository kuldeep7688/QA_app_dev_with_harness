# Architecture -- Knowledge Base Electron App

## System Overview

The Knowledge Base is an Electron desktop application built with TypeScript and React. It provides document import with file picker, text indexing with chunking, content viewing, and grounded question answering with citations.

## Layer Diagram

```
+-----------------------------------------------------------+
|                     Renderer (React)                       |
|  App.tsx -> DocumentList, DocumentDetail, ImportPanel,    |
|             QuestionPanel, StatusBar                       |
+-----------------------------------------------------------+
         |  window.knowledgeBase.* (typed IPC bridge)
+-----------------------------------------------------------+
|                     Preload Script                         |
|  contextBridge.exposeInMainWorld -> documents, indexing, qa|
+-----------------------------------------------------------+
         |  ipcRenderer.invoke(IPC_CHANNELS.*)
+-----------------------------------------------------------+
|                     Main Process                           |
|  main.ts -> createWindow(), initializeServices()          |
|  ipc-handlers.ts -> registerIpcHandlers()                  |
+-----------------------------------------------------------+
         |  Service method calls
+-----------------------------------------------------------+
|                     Services Layer                         |
|  DocumentService | IndexingService | QaService             |
|  PersistenceService (filesystem I/O)                       |
|  Logger (structured JSON logging)                          |
+-----------------------------------------------------------+
```

## Electron Layers

### Main Process (`src/main/`)

- **Window management**: Creates `BrowserWindow` instances with secure web preferences.
- **IPC registration**: Maps IPC channel names to service methods via `registerIpcHandlers()`.
- **Service initialization**: Constructs all services with dependency injection.

### Preload (`src/preload/`)

The preload script exposes a typed API via `contextBridge`:

```typescript
window.knowledgeBase = {
  documents: { list, import, get, getContent, delete },
  indexing:   { start, status, chunks },
  qa:         { ask, history },
  feedback:   { submit, list },
}
```

### Renderer (`src/renderer/`)

React 18 application bundled by Vite:

- `App.tsx` -- Root layout with import toggle, document selection, and Q&A.
- `DocumentList` -- Sidebar listing of imported documents.
- `DocumentDetail` -- Shows metadata, full content, chunks, and delete button.
- `ImportPanel` -- File input for importing .txt and .md documents.
- `QuestionPanel` -- Text input for asking questions.
- `ConversationHistory` -- Chat-style display of Q&A history with expandable citations, confidence indicators, and clear-history action.
- `StatusBar` -- Shows index status and document count.

### Services (`src/services/`)

- `PersistenceService` -- Low-level JSON/text file I/O with atomic writes.
- `DocumentService` -- Document CRUD with content storage and cleanup.
- `IndexingService` -- Paragraph-aware chunking (~500 chars) and index management.
- `QaService` -- Q&A with hybrid (BM25 + vector) retrieval and dynamic confidence scoring.
- `Logger` -- Structured JSON logging with timestamps, log levels, and service-scoped loggers.

## Full Data Flow

### Document Import Flow

```
1. User selects file via ImportPanel
2. App.tsx calls window.knowledgeBase.documents.import(filePath)
3. Preload bridge invokes ipcRenderer.invoke('documents:import', filePath)
4. ipc-handlers.ts delegates to DocumentService.importDocument(filePath)
5. DocumentService:
   a. Validates file exists and is under 10MB
   b. Reads file content and stats
   c. Creates Document metadata object with UUID
   d. Copies file to documents directory via PersistenceService
   e. Stores extracted text content via PersistenceService
   f. Appends to documents-meta.json
   g. Logs structured event with documentId, filename, size
6. Result flows back through IPC
7. App.tsx calls refreshDocuments() to update the list
```

### Q&A Flow with Observability

```
1. User types question in QuestionPanel
2. App.tsx calls window.knowledgeBase.qa.ask(question)
3. QaService.ask():
   a. Logs question with length
   b. Calls retriever.hybridSearch(db, question, embedFn) with mode='hybrid' (or 'bm25' if vector extension not loaded), topK=5
   c. Hybrid retriever runs BM25 (FTS5 + bm25) and vector (sqlite-vec KNN) in parallel
   d. Fuses results via Reciprocal Rank Fusion (k=60)
   e. Hydrates fused results with document titles
   f. Derives confidence from fused score distribution: topScore * 30 + source-agreement bonus + gap-to-second bonus, capped at [0,1]
   g. Generates answer from mock patterns or fallback using citation excerpts
   h. Creates QAResponse with dynamic confidence score
   i. Saves to qa_history table
   j. Logs answer with confidence, citationCount, durationMs
4. Result flows to renderer
5. App.tsx displays answer with citations (including BM25/vector rank + source badges) and feedback buttons
```

### Feedback Flow

```
1. User clicks thumbs up/down on a response
2. App.tsx calls window.knowledgeBase.feedback.submit(timestamp, question, rating)
3. QaService.submitFeedback():
   a. Creates FeedbackEntry with UUID, timestamp, rating
   b. Appends to feedback.json
   c. Logs structured event
4. Feedback persists across sessions
```

### Clean State Reset Flow

```
1. User clicks Reset button in header
2. Confirmation dialog appears
3. App.tsx calls window.knowledgeBase.app.resetData()
4. PersistenceService.resetAll():
   a. Removes entire data directory (rmSync recursive)
   b. Recreates directory structure
   c. Logs reset event
5. App.tsx clears all React state
6. refreshDocuments() reloads empty state
```

## IPC Channels (14 total)

| Channel | Direction | Handler | Purpose |
|---------|-----------|---------|---------|
| `documents:list` | R -> M | DocumentService.listDocuments | List all documents |
| `documents:import` | R -> M | DocumentService.importDocument | Import a file |
| `documents:get` | R -> M | DocumentService.getDocument | Get document by ID |
| `documents:delete` | R -> M | DocumentService.deleteDocument | Delete document |
| `indexing:start` | R -> M | IndexingService.startIndexing | Start indexing |
| `indexing:status` | R -> M | IndexingService.getStatus | Get indexing status |
| `indexing:chunks` | R -> M | IndexingService.getChunksForDocument | Get chunks |
| `qa:ask` | R -> M | QaService.ask | Ask a question |
| `qa:history` | R -> M | QaService.getHistory | Get Q&A history |
| `qa:clear-history` | R -> M | QaService.clearHistory | Clear history |
| `feedback:submit` | R -> M | QaService.submitFeedback | Submit feedback |
| `feedback:list` | R -> M | QaService.getFeedback | Get all feedback |
| `app:reset` | R -> M | PersistenceService.resetAll | Reset all data |
| `app:status` | R -> M | IndexingService.getStatus | Get app status |

## Data Storage

```
knowledge-base-data/
  documents-meta.json     # Document metadata array
  content/
    <doc-id>.txt          # Extracted text content per document
  documents/
    <filename>            # Original file copies
  chunks/
    <doc-id>.json         # Chunk array per document
  index/
    index-meta.json       # Mapping of document IDs to chunk IDs
  qa-history.json         # Q&A interaction log
  feedback.json           # Feedback entries
```

## Logging

All log entries follow this JSON structure:

```json
{
  "timestamp": "2026-03-30T12:00:00.000Z",
  "level": "INFO",
  "service": "document-service",
  "message": "Document imported successfully",
  "data": {
    "documentId": "abc-123",
    "filename": "design-notes.md",
    "sizeBytes": 2048,
    "contentLength": 1980,
    "totalDocuments": 3
  }
}
```

Log levels:

- **DEBUG**: Routine data access (listing, reading files, chunk retrieval)
- **INFO**: Significant events (import, indexing, Q&A, feedback, reset)
- **WARN**: Missing but non-critical data (skipped documents, content not found)
- **ERROR**: Failures (file not found, parse errors)

---

## Planned: SQLite Hybrid Retrieval (in-flight features)

The current retrieval path is a keyword-overlap scan over JSON chunk files. The next architectural milestone replaces this with an embedded SQLite index supporting both BM25 keyword search and vector (cosine) search, fused at query time.

### Target Stack

| Concern | Component |
|---|---|
| Embedded DB | SQLite via `better-sqlite3` (WAL mode, foreign keys on) |
| Keyword index | SQLite FTS5 with built-in `bm25()` ranking |
| Vector index | `sqlite-vec` extension (`vec0` virtual table, 384-dim cosine) |
| Embeddings | `@xenova/transformers` `all-MiniLM-L6-v2` (local, 384-dim) |
| Fusion | Reciprocal Rank Fusion (RRF, k=60 default) |
| Native rebuild | `@electron/rebuild` (postinstall) |

### Target Schema (v1)

```sql
CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT, filename TEXT,
                        size INTEGER, imported_at TEXT, status TEXT,
                        word_count INTEGER, line_count INTEGER, file_type TEXT);

CREATE TABLE chunks (
  rowid       INTEGER PRIMARY KEY,
  id          TEXT UNIQUE NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  content     TEXT NOT NULL,
  char_count  INTEGER, word_count INTEGER,
  embedded_at TEXT,
  vec_rowid   INTEGER            -- links to chunks_vec.rowid for hybrid join
);
CREATE INDEX chunks_doc_idx ON chunks(document_id, idx);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  tokenize='porter unicode61'
);
-- triggers keep chunks_fts in sync with chunks

CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[384]);

CREATE TABLE qa_history (id INTEGER PRIMARY KEY, ts TEXT, question TEXT,
                         answer TEXT, confidence REAL, citations_json TEXT,
                         model_used TEXT, prompt_tokens INTEGER,
                         completion_tokens INTEGER, total_tokens INTEGER);
CREATE TABLE feedback   (id TEXT PRIMARY KEY, response_ts TEXT, question TEXT,
                         rating TEXT, comment TEXT, submitted_at TEXT);
CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);
```

### Hybrid Retrieval Pipeline

```
question
  ├─ embed(question) ────► sqlite-vec KNN top-N ──► [(vecRowid, distance)]
  │                            │
  │                    JOIN chunks via chunks.vec_rowid
  │                            │
  │                    ──► [(chunkRowid, vRank)]
  │
  └─ tokenize(question) ─► FTS5 MATCH + bm25() ───► [(chunkRowid, bRank)]
                                                              │
                       Reciprocal Rank Fusion ◄─────────────────┘
                                      │
                 dedup by rowid; score = Σ 1/(k + rank)
                                      │
                             top-K (default 5)
                                      │
                      hydrate chunks + documents
                                      │
                 pass as citations to QaService.answer()
```

Defaults: `N=20` per source, `K=5`, `rrfK=60`, all configurable via `opts` parameter.

### New / Changed Layer Map

```
Services (post-migration)
  ├─ db.ts                  -- SQLite singleton, loads sqlite-vec, runs migrations
  ├─ migrations/            -- versioned SQL/TS migrations (schema_meta)
  ├─ embedding-service.ts   -- MiniLM model loader, embed/embedBatch
  ├─ retriever.ts           -- pure hybridSearch(query, opts) → fused results
  │                            BM25 via FTS5 + bm25(), vector via sqlite-vec KNN,
  │                            RRF fusion (k=60 default), modes: hybrid|bm25|vector
  ├─ retriever-service.ts   -- legacy BM25-only wrapper (kept for backward compat)
  ├─ indexing-service.ts    -- chunks → SQLite + chunks_fts (triggers) + chunks_vec
  │                            stores vec_rowid in chunks table for join
  ├─ qa-service.ts          -- calls retriever; confidence from fused scores
  ├─ settings-service.ts    -- RetrievalSettings + LlmSettings CRUD with <dataDir>/settings.json
  │                            cache, validation, and WARN logs for invalid values
  └─ persistence-service.ts -- retained for raw content/<id>.txt files only
```

### IPC Channels (27 total — 14 original + 11 SQLite/hybrid + 2 settings)

| Channel | Direction | Handler | Purpose |
|---------|-----------|---------|---------|
| `documents:list` | R -> M | DocumentService.listDocuments | List all documents |
| `documents:import` | R -> M | DocumentService.importDocument | Import a file |
| `documents:get` | R -> M | DocumentService.getDocument | Get document by ID |
| `documents:get-content` | R -> M | DocumentService.getDocument | Get document content |
| `documents:delete` | R -> M | DocumentService.deleteDocument | Delete document |
| `indexing:start` | R -> M | IndexingService.startIndexing | Start indexing |
| `indexing:status` | R -> M | IndexingService.getStatus | Get indexing status |
| `indexing:chunks` | R -> M | IndexingService.getChunksForDocument | Get chunks |
| `indexing:rebuild-embeddings` | R -> M | IndexingService.rebuildEmbeddings | Re-embed all chunks |
| `indexing:progress` (event) | M -> R | IndexingService.rebuildEmbeddings | Progress stream |
| `qa:ask` | R -> M | QaService.ask | Ask a question |
| `qa:history` | R -> M | QaService.getHistory | Get Q&A history |
| `qa:clear-history` | R -> M | QaService.clearHistory | Clear history |
| `qa:retrieve-debug` | R -> M | QaService.retrieveDebug | Debug retrieval (returns BM25, vector, fused lists) |
| `feedback:submit` | R -> M | QaService.submitFeedback | Submit feedback |
| `feedback:list` | R -> M | QaService.getFeedback | Get all feedback |
| `app:reset` | R -> M | PersistenceService.resetAll | Reset all data |
| `app:status` | R -> M | IndexingService.getStatus | Get app status |
| `dialog:show-open` | R -> M | dialog.showOpenDialog | File picker |
| `settings:get` | R -> M | SettingsService.get | Get retrieval settings |
| `settings:set` | R -> M | SettingsService.set | Update retrieval settings (validates, logs WARN on invalid) |

### Migration & Backward Compatibility

1. On first launch after upgrade, if `index.db` is missing but legacy JSON files exist, run a one-shot importer in a single transaction.
2. Legacy `documents-meta.json`, `chunks/*.json`, `qa-history.json`, `feedback.json` are moved (not deleted) into `<dataDir>/legacy/`.
3. `schema_meta(version)` row drives future migrations.
4. Re-embedding is decoupled from migration so users can defer it; chunks are usable for BM25 immediately.

### Updated Data Storage Layout

```
knowledge-base-data/
  index.db               # SQLite (chunks, FTS, vectors, qa_history, feedback)
  content/<doc-id>.txt   # raw extracted text (unchanged)
  documents/<filename>   # original file copies (unchanged)
  settings.json          # RetrievalSettings (mode, topK, topN, rrfK, embeddingsEnabled)
  legacy/                # one-time backup of pre-SQLite JSON
```

### Risk Notes

- `better-sqlite3` native ABI must match Electron's — handled by `@electron/rebuild` in `postinstall` and CI.
- `sqlite-vec` ships platform binaries via npm; if load fails the app must degrade to BM25-only mode with a visible status flag.
- MiniLM model adds ~25 MB; default is bundled (no network), with first-run download as an alternative.
- RRF `k` is data-dependent; default 60 (literature norm) is exposed in settings and tuned via the eval harness.

---

## Planned: LLM Answer Generation (after hybrid retrieval)

Once the hybrid retriever is in place, the final piece turns the app from a mock Q&A demo into a real RAG system: an LLM provider generates answers grounded in the retrieved citations. The default provider is NVIDIA NIM (OpenAI-compatible endpoint), configured via a `.env` file.

### Target Stack

| Concern | Component |
|---|---|
| LLM provider | NVIDIA NIM (`https://integrate.api.nvidia.com/v1`) — OpenAI-compatible chat completions |
| Auth | `NVIDIA_API_KEY` in `.env` (loaded by `dotenv`); key never reaches renderer |
| Default model | `google/gemma-2-2b-it` (configurable via env or settings) |
| Streaming | OpenAI SDK `stream: true` → async generator → `webContents.send()` token deltas |
| Cancel | `AbortController` via OpenAI SDK `signal` option |
| HTTP client | OpenAI SDK (native `fetch` via Node.js/Electron) |
| Markdown render | `react-markdown` + `remark-gfm` in renderer |

### Provider Architecture

```
src/services/providers/
  types.ts              -- LlmProvider interface, ChatMessage, ChatResponse,
                           StreamChunk, LlmOptions
  nvidia-provider.ts    -- concrete LlmProvider; calls NVIDIA NIM
                           chat() + chatStream() with AbortSignal support
```

QaService is injected with `LlmProvider | null` at construction. When null (env missing, health check failed), it falls back to a simplified mock response. When present, it calls `buildPrompt()` → `llmProvider.chat()` or `chatStream()`.

### Prompt Assembly Flow

```
retaiever.hybridSearch(question)
        │
        ▼
  Citation[] (top-K via RRF)
        │
  buildPrompt(question, citations, chatHistory?)
        │
        ▼
  ChatMessage[]
  ├─ system: role instructions + inline citation excerpts
  ├─ [optional history: N prior exchanges]
  └─ user: question
        │
  llmProvider.chatStream(messages, opts)
        │
        ▼
  StreamChunk[] → IPC → renderer → ReactMarkdown
```

### Streaming IPC

```
Renderer                    Main                          NVIDIA
   │                         │                               │
   ├─ ipcRenderer.invoke ──► qa:ask-stream                  │
   │ ('qa:ask-stream',       │                               │
   │  {question, requestId}) │                               │
   │                         ├─ retriever.hybridSearch()      │
   │                         ├─ buildPrompt()                │
   │                         ├─ llmProvider.chatStream() ───► POST /chat/completions
   │                         │      {stream: true, signal}   │
   │                         │                               │
   │  ◄─ qa:stream-chunk ───┤ ◄── SSE data: {...} ──────────┤
   │    {requestId, delta}   │                               │
   │                         │                               │
   │  ◄─ qa:stream-done ────┤ ◄── SSE [DONE] or finish ─────┤
   │    {requestId,          │        {usage, finish_reason}
   │     QAResponse}         │
   │                         │
   │  ... or ipcRenderer ──► qa:cancel
   │  invoke('qa:cancel',    ├─ signal.abort()
   │   {requestId})          │
```

### Services Map (Phases F–H)

```
Services (post-LLM)
  ├─ providers/
  │   ├─ types.ts            -- LlmProvider, ChatMessage, ChatResponse, etc. ✅
  │   └─ nvidia-provider.ts  -- NVIDIA NIM via OpenAI SDK ✅
  ├─ prompt-builder.ts       -- buildPrompt(question, citations, history?) → ChatMessage[] (in qa-service.ts)
  ├─ qa-service.ts           -- injected LlmProvider; calls retriever + provider ✅
  ├─ retriever.ts            -- hybridSearch (from prior phase) ✅
  ├─ db.ts, migrations/      -- SQLite (from prior phase) ✅
  └─ env-config.ts           -- loads .env, provides API key + model name ✅
```

### IPC Channels (6 additions — 32 total including hybrid search additions)

| Channel | Direction | Purpose | Status |
|---|---|---|---|
| `llm:health` | R → M | Connectivity check (minimal chat) | ✅ |
| `qa:ask-stream` | R → M | Streaming ask; response via events | 🔜 |
| `qa:stream-chunk` (event) | M → R | Token delta per chunk | 🔜 |
| `qa:stream-done` (event) | M → R | Final `QAResponse` with citations, usage | 🔜 |
| `qa:cancel` | R → M | Abort in-flight request by `requestId` | 🔜 |
| `settings:get` | R → M | Read retrieval settings | ✅ |
| `settings:set` | R → M | Write retrieval settings | ✅ |
| `llm:settings:get` | R → M | Read LLM settings | ✅ |
| `llm:settings:set` | R → M | Write LLM settings | ✅ |

### Type Additions (✅ all implemented)

```typescript
// shared/types.ts additions
interface TokenUsage { prompt: number; completion: number; total: number; }
// QAResponse gains: modelUsed?: string, tokensUsed?: TokenUsage
// AppStatus gains: llmStatus, llmModel

// LlmSettings { modelName, temperature, maxTokens, streamEnabled, systemPrompt }
// SettingsService.getLlmSettings / setLlmSettings with validation

// providers/types.ts exports:
//   LlmProvider (chat + chatStream + checkHealth)
//   ChatMessage { role, content }
//   ChatResponse { content, usage?, model? }
//   StreamChunk { type: 'delta'|'done'|'error', content?, usage?, model?, error? }
//   LlmOptions { model?, temperature?, maxTokens?, signal?, systemPrompt? }
//   TokenUsage { prompt, completion, total }
```

### Configuration

`.env` (at project root, `.gitignore`d):
```
NVIDIA_API_KEY=nvapi-...
NVIDIA_MODEL_NAME=google/gemma-2-2b-it
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
```

`settings.json` (runtime overrides):
```json
{
  "retrievalMode": "hybrid",
  "topK": 5,
  "modelName": "google/gemma-2-2b-it",
  "temperature": 0.3,
  "maxTokens": 1024,
  "streamEnabled": true,
  "systemPrompt": "You are a helpful assistant..."
}
```

### Error Classification

| Error class | User message | Log level |
|---|---|---|
| `AbortError` | Silent (cancel flow) | DEBUG |
| 401 / 403 | "Invalid API key. Check your .env file." | ERROR |
| 429 | "Rate limited by NVIDIA. Please wait." | WARN |
| 5xx / network | "LLM service unavailable. Check your connection." | ERROR |
| Timeout (30s) | "Request timed out." | ERROR |

No API key or raw response body in error messages or logs.

### Risk Notes

- `.env` file must be `.gitignore`d — the API key must never be committed.
- NVIDIA NIM rate limits apply; 429 responses handled gracefully with retry-after hint.
- `gemma-2-2b-it` is a lightweight model (~2B params) suitable for RAG; latency typically < 2s.
- Markdown rendering of answers introduces XHTML injection to React via `dangerouslySetInnerHTML` — mitigated by `react-markdown`'s built-in sanitisation.
- Streaming chunk ordering guaranteed by HTTP/1.1 response body ordering; request ID de-duplication handles any IPC reordering.
