# Product Description -- AI Assistant with Knowledge Base

## What Is This?

A desktop AI assistant with a personal knowledge base. Chat with an LLM (NVIDIA NIM), search the web via Tavily, ask questions about your indexed documents, upload files directly into conversations, and revisit past conversations through saved sessions.

The app has two views:

- **Chat View**: Session-based conversations with toggleable tools (Knowledge Base RAG, Web Search, File Upload). Pure general chat when no tools are active.
- **Knowledge Base View**: Import, index, and manage documents. Ask KB-only questions with grounded citations.

## Core Features

### AI Chat

- General LLM conversation using NVIDIA NIM (OpenAI-compatible endpoint).
- Streaming answers with Markdown rendering (headers, lists, code blocks, tables).
- Cancel mid-response — the "Send" button becomes "Cancel" during generation.
- Named, saveable conversation sessions with auto-generated titles from the first message.
- Session sidebar for browsing, renaming, and deleting past conversations.
- Conversations persist across app restarts in SQLite.

### Tool Use (per-message toggles)

Each message in Chat View can activate one or more tools via toggle buttons above the input:

- **Knowledge Base RAG**: Toggle to search indexed documents. The system retrieves relevant chunks via hybrid search (BM25 + vector), injects them into the prompt, and the LLM answers with citations.
- **Web Search**: Toggle to search the web via Tavily API. Results are injected into the prompt, and the LLM synthesizes an answer with source links.
- **File Upload**: Attach `.txt` or `.md` files directly to a chat message. File content is extracted and injected into the prompt for the current turn. Files are not indexed or persisted in the KB.

### Knowledge Base Management

- Import `.txt` and `.md` files through a file picker.
- File validation: existence check, 10 MB size limit.
- View document metadata: title, filename, size, import date, indexing status, word count, line count, file type.
- View document chunks with character/word count.
- Browse all imported documents in a sidebar.
- Delete documents (removes content, chunks, embeddings — cascade via foreign keys).
- Index documents for search (chunks stored in SQLite, embedded locally).
- Rebuild embeddings for all indexed documents (idempotent, with progress feedback).
- Indexing status visible per document and in the status bar (color-coded).

### Retrieval Engine

- **Hybrid search** (BM25 keyword + vector semantic):
  - BM25 via SQLite FTS5 with `porter unicode61` tokenizer and `bm25()` ranking.
  - Vector search via `sqlite-vec` extension (384-dim cosine, MiniLM-L6-V2 embeddings).
  - Reciprocal Rank Fusion (RRF) merges results — tunable `k` constant.
- **Three modes**: `hybrid` (default), `bm25` (keyword only), `vector` (semantic only).
- **Dynamic confidence scoring** derived from fused retrieval score distribution: top score, gap-to-second, both-sources bonus. No hardcoded constant.
- **Per-citation source badges**: Each expanded citation shows whether the chunk was found by BM25, Vector, or both (Hybrid), with rank position.
- **Embeddings are local**: All-MiniLM-L6-v2 runs entirely on-device via `@xenova/transformers`. No network calls. ~25 MB model downloaded on first run.
- **Graceful degradation**: If `sqlite-vec` extension fails to load, the app falls back to BM25-only mode with a visible status flag.

### Conversation Features

- Chat-style display with Markdown rendering for both KB Q&A and general chat.
- User messages right-aligned, assistant messages left-aligned.
- Confidence indicator (green ≥70% / yellow ≥40% / red otherwise) for KB answers.
- Expandable citations per KB answer with document title, chunk excerpt, and source badge.
- Web search results shown as inline source links.
- Token usage per response (`1.2K tokens | 3:15 PM`), cumulative session totals.
- Feedback collection: thumbs up/down on KB Q&A responses.

### Settings

- **Retrieval Settings**: Mode selector (hybrid / bm25 / vector), topK, topN, rrfK, embeddings toggle.
- **LLM Settings**: Model name, temperature (0–1 slider), max tokens, streaming toggle, custom system prompt textarea.
- Changes apply immediately to the next question — no restart required.
- Invalid values (bad mode, negative numbers, non-boolean) are rejected with a log warning.

### Theme Toggle

- Theme toggle button (☀️/🌙) in the application header to switch between dark and light themes.
- All UI components instantly reflect the active theme through CSS custom properties.
- Default theme is dark. Theme is toggled client-side via React state and `data-theme` attribute.

### Clean State Reset

- Reset button in application header.
- Confirmation dialog before reset.
- Clears all data: documents, chunks, Q&A history, feedback, sessions, chat messages.
- Application returns to empty state.
- Data directory is removed and recreated.

### Persistence

- All data persists across application restarts.
- Single SQLite database (`index.db`) stores: documents, chunks (with FTS5 + vector), Q&A history, feedback, sessions, chat messages.
- Content file copies stored in `<dataDir>/content/`, original file copies in `<dataDir>/documents/`.
- Legacy JSON data (from prior versions) is auto-imported on first run and backed up to `<dataDir>/legacy/`.

### Status Bar

- Real-time display of indexing status (idle/indexing/ready/error) with color-coded dot.
- Document count and indexed count.
- LLM provider status dot: green (healthy), grey (disabled), red (unhealthy).
- Last activity timestamp.

## User Interface

```
+----------+----------------------------------------------------+
|  CHAT  |  KNOWLEDGE BASE   | [Settings] [Reset]         |
+----------+----------------------------------------------------+
| Session  |  [Conversation Area]                               |
| List     |                                                     |
|          |  User message (right-aligned)                       |
| Chat 1   |  Assistant answer (left-aligned, Markdown):         |
| Chat 2   |    - Rich text, lists, code blocks                  |
| Chat 3   |    - Citations with source badges (KB mode)         |
| [+ New]  |    - Web source links (web search mode)             |
|          |    - Token count | timestamp                         |
|          |                                                     |
|          |  [Streaming cursor during generation]               |
|          |                                                     |
+----------+----------------------------------------------------+
| [KB] [Web] [📎]  | Type a message... [Send/Cancel]     |
+----------------------------------------------------------+
| LLM: healthy | Docs: 5/5 indexed | Last: 12:34 PM          |
+----------------------------------------------------------+
```

## Constraints

- Maximum supported file size for KB import: 10 MB.
- Supported formats for KB import: `.txt`, `.md`.
- Supported formats for chat file upload: `.txt`, `.md`.
- LLM provider: NVIDIA NIM (requires network and API key).
- Web search provider: Tavily API (requires network and API key).
- Embeddings are local (no network) after initial ~25 MB model download.
- All structured data persists in embedded SQLite; no external database server.

## Performance Targets

- Document import: 10+ files per batch under 1 second.
- Indexing speed: 100+ chunks per second.
- Retrieval latency: <500ms per question.
- LLM first token latency: <1 second (streaming).
- End-to-end (retrieval + LLM): <3 seconds for typical questions.
- Cancel responsiveness: abort in-flight request within 200ms.

## Configuration

`.env` (never committed):
```bash
NVIDIA_API_KEY=nvapi-...
NVIDIA_MODEL_NAME=google/gemma-2-2b-it
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
TAVILY_API_KEY=tvly-...
```

Runtime overrides via `settings.json` (modelName, temperature, maxTokens, streamEnabled, systemPrompt, plus all retrieval settings).
