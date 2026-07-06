# Architecture -- AI Assistant with Knowledge Base

## System Overview

An Electron desktop application built with TypeScript and React. The app is a two-view AI assistant: a **Chat** view with session-based conversations and tool toggles (Knowledge Base RAG, Web Search, File Upload), and a **Knowledge Base** view for document management and indexing. All storage uses embedded SQLite.

## Layer Diagram

```
+-----------------------------------------------------------+
|                     Renderer (React)                        |
|  ChatView: SessionList, ChatMessage[], ChatInput            |
|  KnowledgeBaseView: DocumentList, DocumentDetail,           |
|    ImportPanel, SettingsPanel, StatusBar                    |
+-----------------------------------------------------------+
          |  window.knowledgeBase.* (typed IPC bridge)
+-----------------------------------------------------------+
|                     Preload Script                          |
|  contextBridge.exposeInMainWorld -> documents, indexing,   |
|    qa, feedback, app, llm, settings, sessions, chat        |
+-----------------------------------------------------------+
          |  ipcRenderer.invoke(IPC_CHANNELS.*)
+-----------------------------------------------------------+
|                     Main Process                           |
|  main.ts -> createWindow(), initializeServices(),          |
|    loadEnvConfig(), registerIpcHandlers()                   |
+-----------------------------------------------------------+
          |  Service method calls (constructor-injected deps)
+-----------------------------------------------------------+
|                     Services Layer                          |
|  Core:                                                      |
|    db.ts (SQLite singleton, loads sqlite-vec, migrations)   |
|    migrations/runner.ts (versioned schema migrations)       |
|    logger.ts (structured JSON logging)                     |
|  Business:                                                  |
|    DocumentService | IndexingService | QaService            |
|    ChatService | SessionService | WebSearchService          |
|    RetrieverService | Retriever (hybridSearch)              |
|    EmbeddingService | SettingsService                       |
|    PersistenceService (content file I/O)                    |
|  Providers:                                                 |
|    providers/types.ts (LlmProvider interface)               |
|    providers/nvidia-provider.ts (NVIDIA NIM)                |
|  Config:                                                    |
|    env-config.ts (dotenv, API keys)                         |
+-----------------------------------------------------------+
```

## Electron Layers

### Main Process (`src/main/`)

- **Window management**: Creates `BrowserWindow` instance with secure web preferences.
- **IPC registration**: Maps IPC channel names to service methods via `registerIpcHandlers()`.
- **Service initialization**: Constructs all services with dependency injection; reads `.env` via `env-config.ts` before services start.

### Preload (`src/preload/`)

The preload script exposes a typed API via `contextBridge`:

```typescript
window.knowledgeBase = {
  documents:  { list, import, get, getContent, delete },
  indexing:   { start, status, chunks, rebuildEmbeddings, onProgress },
  qa:         { ask, askStream, cancel, history, clearHistory, retrieveDebug,
                onStreamChunk, onStreamDone },
  feedback:   { submit, list },
  app:        { resetData, readFile },
  llm:        { health },
  settings:   { get, set },
  llmSettings:{ get, set },
  sessions:   { list, create, get, update, delete },
  chat:       { send, sendStream, cancel, onStreamChunk, onStreamDone },
}
```

### Renderer (`src/renderer/`)

React 18 application bundled by Vite. Two top-level views navigated via a tab bar:

**Chat View:**
- `SessionList` -- Left sidebar showing all saved conversations with titles.
- `ChatMessage[]` -- Conversation area with user/assistant bubbles, Markdown rendering, citations.
- `ChatInput` -- Bottom input bar with tool toggle buttons (KB RAG, Web Search, File Upload).

**Knowledge Base View:**
- `DocumentList` -- Sidebar listing of imported documents.
- `DocumentDetail` -- Metadata, content, chunks, delete/reindex controls.
- `ImportPanel` -- File picker for `.txt`, `.md`, `.pdf`, and `.docx` documents.
- `ConversationHistory` -- KB-only Q&A history (legacy, distinct from Chat).
- `QuestionPanel` -- Input bar for KB-only questions.

**Shared:**
- `SettingsPanel` -- Modal overlay for retrieval and LLM settings.
- `StatusBar` -- Indexing status, LLM health indicator, document counts.
- `ResetDialog` -- Confirmation dialog for clean state reset.
- **Theme Toggle** -- Header button toggles `data-theme` attribute on `<html>`. CSS custom properties (40+ variables) define dark/light palettes, referenced by all CSS classes and inline styles via `var(--name)`. Theme state lives in React with no persistence.

### Services (`src/services/`)

**Core Infrastructure:**

| Service | File | Purpose |
|---------|------|---------|
| `db.ts` | `src/services/db.ts` | SQLite singleton, WAL mode, foreign keys, loads sqlite-vec extension |
| `migrations/runner.ts` | `src/services/migrations/runner.ts` | Versioned schema migrations from `*.sql` files |
| `logger.ts` | `src/services/logger.ts` | Structured JSON logging with log levels and service-scoped loggers |
| `env-config.ts` | `src/services/env-config.ts` | Loads `.env` via dotenv; provides NVIDIA+TAVILY keys, model name |

**Business Logic:**

| Service | File | Purpose |
|---------|------|---------|
| `DocumentService` | `src/services/document-service.ts` | Document CRUD against SQLite `documents` table |
| `IndexingService` | `src/services/indexing-service.ts` | Paragraph-aware chunking, SQLite write, embedding + vec insert |
| `QaService` | `src/services/qa-service.ts` | KB-only Q&A: hybrid retriever + LLM (or mock), streaming, buildPrompt, confidence |
| `ChatService` | `src/services/chat-service.ts` | General chat orchestrator: optional tools (KB/Web/File) → LLM → response. sendMessage/sendStream with LlmProvider. Saves to chat_messages with citations, tokens, web results. |
| `SessionService` | `src/services/session-service.ts` | CRUD for conversation sessions and chat_messages. createSession/listSessions/getSession/updateSession/deleteSession. addMessage/getMessages/setAutoTitle (60-char truncation). |
| `WebSearchService` | `src/services/web-search-service.ts` | Tavily API wrapper: search(query) → {title, url, content}[]. API key from env-config, never in logs. |
| `Retriever` | `src/services/retriever.ts` | Pure `hybridSearch(db, query, embedFn, opts)` — BM25 + Vector + RRF |
| `RetrieverService` | `src/services/retriever-service.ts` | Legacy BM25-only wrapper (backward compat) |
| `EmbeddingService` | `src/services/embedding-service.ts` | Local MiniLM-L6-v2 model, embed/embedBatch (384-dim) |
| `SettingsService` | `src/services/settings-service.ts` | RetrievalSettings + LlmSettings CRUD with validation + caching |
| `PersistenceService` | `src/services/persistence-service.ts` | Filesystem I/O for content files and reset operations |
| `FileExtractionService` | `src/services/file-extraction-service.ts` | Text extraction from .txt, .md, .pdf, .docx files |

**LLM Providers:**

| Provider | File | Purpose |
|----------|------|---------|
| `types.ts` | `src/services/providers/types.ts` | `LlmProvider` interface + `ChatMessage`, `ChatResponse`, `StreamChunk`, `LlmOptions`, `TokenUsage` |
| `nvidia-provider.ts` | `src/services/providers/nvidia-provider.ts` | Concrete provider using OpenAI SDK on NVIDIA NIM endpoint. `chat()`, `chatStream()`, `checkHealth()` with AbortSignal support |

## Data Flows

### Document Import Flow

```
1. User selects file via ImportPanel (KB view)
2. App.tsx calls window.knowledgeBase.documents.import(filePath)
3. Preload bridge invokes ipcRenderer.invoke('documents:import', filePath)
4. ipc-handlers.ts delegates to DocumentService.importDocument(filePath)
5. DocumentService:
   a. Validates file exists, within 10MB, supported format (.txt/.md/.pdf/.docx)
    b. Reads file content via FileExtractionService (text extraction per format)
   c. Creates Document metadata object with UUID (wordCount, lineCount, fileType)
   d. Copies file to documents/ directory via PersistenceService
   e. Stores extracted text to content/<doc-id>.txt
   f. INSERTs document row into SQLite documents table
   g. Logs at INFO with documentId, filename, size, totalDocuments
6. Result flows back through IPC
7. App.tsx calls refreshDocuments() to update the list
```

### Q&A Flow (Knowledge Base View)

```
1. User types question in QuestionPanel (KB view)
2. App.tsx calls window.knowledgeBase.qa.askStream({question, requestId})
   or window.knowledgeBase.qa.ask(question)
3. QaService.ask/askStream():
   a. Logs question with length at INFO
   b. Calls retriever.hybridSearch(db, question, embedFn)
      with mode from settings (hybrid/bm25/vector), topK=5
   c. Hybrid retriever runs BM25 (FTS5 + bm25()) and vector (sqlite-vec KNN) in parallel
   d. Fuses results via Reciprocal Rank Fusion (k=60 default)
   e. Hydrates fused results with document titles
   f. Derives confidence from fused score distribution (topScore, source-agreement, gap)
   g. Calls buildPrompt(question, citations, chatHistory?) → ChatMessage[]
   h. When llmProvider present: calls llmProvider.chat/chatStream()
   i. When llmProvider null: returns configured fallback message
   j. Saves to qa_history table (model, tokens, citations)
   k. Logs answer with confidence, citationCount, durationMs, tokens
4. For streaming: token chunks arrive via qa:stream-chunk events
5. Final qa:stream-done delivers QAResponse with citations
6. App.tsx displays answer with markdown, citations, source badges, feedback buttons
```

### Chat Flow (Chat View)

```
1. User types message in ChatInput with tool toggles (KB/Web/File)
2. App.tsx calls window.knowledgeBase.chat.sendStream({text, sessionId, tools})
3. ChatService.sendMessage() / sendStream():
   a. Saves user message to chat_messages immediately
   b. Loads recent messages from chat_messages for session context
   c. If tools.kbSearch: calls retriever.hybridSearch(text) → citations
   d. If tools.webSearch: calls WebSearchService.search(text) → formatted results
   e. If tools.fileUpload: extracts text from in-memory file data
   f. Builds ChatMessage[]:
      - system: role instructions + inline citations + web results + file content
      - [optional prior exchange history]
      - user: text
    g. Calls llmProvider.chatStream(messages, {signal})
   h. Streams token chunks to renderer via chat:stream-chunk events
   i. On completion:
       - Saves assistant response to chat_messages (with citations, web results, tokens)
       - Updates session.updatedAt and messageCount
       - Auto-generates session title from first user message if empty
   j. Sends chat:stream-done with final ChatResponse
4. ChatInput shows streaming state with cancel option
5. Renderer displays markdown-formatted response with inline citations/links
```

### Feedback Flow

```
1. User clicks thumbs up/down on Q&A response (KB view)
2. App.tsx calls window.knowledgeBase.feedback.submit(timestamp, question, rating)
3. QaService.submitFeedback():
   a. Creates FeedbackEntry with UUID, timestamp, rating
   b. INSERTs into feedback table
   c. Logs at INFO with rating and question length
4. Feedback persists across sessions
```

### Clean State Reset Flow

```
1. User clicks Reset button in header
2. Confirmation dialog appears
3. App.tsx calls window.knowledgeBase.app.resetData()
4. PersistenceService.resetAll():
   a. Removes entire data directory (rmSync recursive)
   b. Recreates empty directory structure
   c. Logs reset event at WARN
5. App.tsx clears all React state (sessions, chats, documents)
6. refreshDocuments() and loadSessions() reload empty state
```

## IPC Channels (40 channels)

| Channel | Direction | Handler | Purpose |
|---------|-----------|---------|---------|
| `documents:list` | R → M | DocumentService.listDocuments | List all documents |
| `documents:import` | R → M | DocumentService.importDocument | Import a file |
| `documents:get` | R → M | DocumentService.getDocument | Get document by ID |
| `documents:get-content` | R → M | DocumentService.getDocumentContent | Get document text content |
| `documents:delete` | R → M | DocumentService.deleteDocument | Delete document |
| `indexing:start` | R → M | IndexingService.startIndexing | Start indexing (single/bulk) |
| `indexing:status` | R → M | IndexingService.getStatus | Get indexing + app status |
| `indexing:chunks` | R → M | IndexingService.getChunksForDocument | Get document chunks |
| `indexing:rebuild-embeddings` | R → M | IndexingService.rebuildEmbeddings | Re-embed all chunks |
| `indexing:progress` (event) | M → R | rebuildEmbeddings | Progress stream (processed/total) |
| `qa:ask` | R → M | QaService.ask | Ask KB question (non-streaming) |
| `qa:ask-stream` | R → M | QaService.askStream | Ask KB question (streaming) |
| `qa:stream-chunk` (event) | M → R | askStream | Token delta per chunk |
| `qa:stream-done` (event) | M → R | askStream | Final QAResponse with citations |
| `qa:cancel` | R → M | activeStreams.abort | Cancel in-flight KB question |
| `qa:history` | R → M | QaService.getHistory | Get KB Q&A history |
| `qa:clear-history` | R → M | QaService.clearHistory | Clear KB Q&A history |
| `qa:retrieve-debug` | R → M | QaService.retrieveDebug | Debug: BM25/vector/fused lists |
| `feedback:submit` | R → M | QaService.submitFeedback | Submit feedback |
| `feedback:list` | R → M | QaService.getFeedback | Get all feedback |
| `app:reset` | R → M | PersistenceService.resetAll | Reset all data |
| `app:status` | R → M | IndexingService.getStatus | Get app status |
| `dialog:show-open` | R → M | dialog.showOpenDialog | File picker |
| `settings:get` | R → M | SettingsService.get | Get retrieval settings |
| `settings:set` | R → M | SettingsService.set | Update retrieval settings |
| `llm:health` | R → M | llmProvider.checkHealth | LLM connectivity check |
| `llm:settings:get` | R → M | SettingsService.getLlmSettings | Get LLM settings |
| `llm:settings:set` | R → M | SettingsService.setLlmSettings | Update LLM settings |
| `sessions:list` | R → M | SessionService.listSessions | List all sessions (updatedAt DESC) |
| `sessions:create` | R → M | SessionService.createSession | Create new session (optional title) |
| `sessions:get` | R → M | SessionService.getSession | Get session metadata by ID |
| `sessions:get-messages` | R → M | SessionService.getMessages | Get all messages for a session |
| `sessions:update` | R → M | SessionService.updateSession | Rename session |
| `sessions:delete` | R → M | SessionService.deleteSession | Delete session + messages (CASCADE) |
| `chat:send` | R → M | ChatService.sendMessage | Send chat (non-streaming) with tools |
| `chat:send-stream` | R → M | ChatService.sendStream | Send chat (streaming), fire-and-forget |
| `chat:stream-chunk` (event) | M → R | sendStream | Token delta per chunk |
| `chat:stream-done` (event) | M → R | sendStream | Final response with citations/webResults |
| `chat:cancel` | R → M | activeChatStreams.abort | Cancel in-flight chat |

## Data Storage

### SQLite Schema (`index.db`)

```
documents (id, title, filename, size, imported_at, status,
           word_count, line_count, file_type)
chunks (rowid, id, document_id [FK], idx, content,
        char_count, word_count, embedded_at, vec_rowid)
chunks_fts (FTS5 virtual table, porter+unicode61, triggers)
chunks_vec (vec0 virtual table, embedding float[384])
qa_history (id, ts, question, answer, confidence, citations_json,
            model_used, prompt_tokens, completion_tokens, total_tokens)
feedback (id, response_ts, question, rating, comment, submitted_at)
sessions (id, title, created_at, updated_at, message_count)
chat_messages (id, session_id [FK], role, content, tools_json,
               citations_json, web_results_json, uploaded_files_json,
               tokens_used_json, model, created_at)
schema_meta (key, value) -- migration version tracking
```

### Filesystem Layout

Data directory depends on runtime mode:

| Mode | Path |
|------|------|
| Development (`npm run dev`) | `<project-root>/knowledge-base-data/` |
| Production (packaged app) | `app.getPath('userData')/knowledge-base-data/` — i.e., `~/.config/knowledge-base/` (Linux), `~/Library/Application Support/knowledge-base/` (macOS), `%APPDATA%/knowledge-base/` (Windows) |

```
knowledge-base-data/
  index.db               # SQLite (all structured data)
  content/<doc-id>.txt   # raw extracted text per document
  documents/<filename>   # original file copies
  settings.json          # RetrievalSettings + LlmSettings
  legacy/                # one-time backup of pre-SQLite JSON
```

## Packaging

The app is packaged using `electron-builder`. Configuration lives in `electron-builder.yml`.

### Files included in package

- `dist/**/*` — compiled TypeScript (main process, preload, services, SQL migrations)
- `package.json` — app metadata
- `node_modules/` — pruned by electron-builder (native modules in `asarUnpack`)

`better-sqlite3` is unpacked from the ASAR archive (`asarUnpack`) because it's a native Electron module.

### Build scripts

| Command | Output |
|---------|--------|
| `npm run package` | Platform-specific installer (current OS) |
| `npm run package:linux` | `.AppImage` + `.deb` in `release/` |
| `npm run package:mac` | `.dmg` in `release/` |
| `npm run package:win` | `.exe` installer in `release/` |

Internally these run `npm run build` (TypeScript compile + Vite + migration copy) followed by `electron-builder`.

### Environment variables at runtime

Packaged apps read API keys from system environment variables (not `.env`):

- `NVIDIA_API_KEY` — required for LLM features
- `TAVILY_API_KEY` — required for web search

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

### Log Levels

| Level | When to Use |
|-------|-------------|
| DEBUG | Routine data access (listing, reading files, chunk retrieval) |
| INFO | Significant events (import, indexing, Q&A, chat, session CRUD) |
| WARN | Missing but non-critical data (skipped documents, disabled vector) |
| ERROR | Failures (file not found, LLM errors, database errors) |

### Service Logging Points

- **PersistenceService**: directory init, file read/write, clean state reset
- **DocumentService**: import (size, metadata), delete (remaining count), document not found
- **IndexingService**: start, chunk progress, batch completion (throughput), embeddings generation
- **Retriever**: hybrid search start (query + mode), BM25/vector counts, RRF results, timing
- **QaService**: question processing, answer (confidence, duration, tokens), feedback
- **ChatService**: chat start (text + tools config), tool results, LLM completion (duration, tokens)
- **SessionService**: create, rename, delete sessions
- **WebSearchService**: search query, result count, duration
- **IPC Handlers**: every channel invocation (INFO for mutations, DEBUG for reads), startup channel list
- **Providers**: health check results, LLM errors (sanitised, no API keys)
- **SettingsService**: load, save, invalid-value WARN
- **db.ts**: database init, SQLite version, WAL mode, vector extension loading
- **migrations/runner**: version tracking, applied migrations

### Configuring Log Level

Set `LOG_LEVEL` env var (default: `DEBUG`):
```bash
LOG_LEVEL=INFO npm run dev
LOG_LEVEL=WARN npm run dev
LOG_LEVEL=ERROR npm run dev
```

## Configuration

```bash
# .env (never committed)
NVIDIA_API_KEY=nvapi-...
NVIDIA_MODEL_NAME=google/gemma-2-2b-it
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
TAVILY_API_KEY=tvly-...
```

Runtime overrides in `settings.json`:
```json
{
  "retrievalMode": "hybrid",
  "topK": 5,
  "topN": 20,
  "rrfK": 60,
  "embeddingsEnabled": true,
  "modelName": "google/gemma-2-2b-it",
  "temperature": 0.3,
  "maxTokens": 1024,
  "streamEnabled": true,
  "systemPrompt": "You are a helpful AI assistant..."
}
```

## Error Classification

| Error class | User message | Log level |
|---|---|---|
| `AbortError` | Silent (cancel flow) | DEBUG |
| 401 / 403 | "Invalid API key. Check your .env file." | ERROR |
| 429 | "Rate limited by NVIDIA. Please wait." | WARN |
| 5xx / network | "LLM service unavailable. Check your connection." | ERROR |
| Timeout (30s) | "Request timed out." | ERROR |

No API key or raw response body in error messages or logs.

## Risk Notes

- `better-sqlite3` native ABI must match Electron's — handled by `@electron/rebuild` in `postinstall`.
- `sqlite-vec` ships platform binaries; if load fails the app degrades to BM25-only mode with a visible status flag.
- MiniLM model adds ~25 MB; first-run download required via `@xenova/transformers`.
- RRF `k` is data-dependent; default 60 is exposed in settings and tunable.
- `.env` file must be `.gitignore`d — API keys must never be committed.
- NVIDIA NIM rate limits apply; 429 responses handled gracefully.
- Streaming chunk ordering guaranteed by HTTP/1.1 response body ordering; request ID de-duplication handles IPC reordering.
