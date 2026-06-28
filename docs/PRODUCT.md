# Product Description -- Knowledge Base

## What Is This?

A desktop application for managing a personal knowledge base. Users import text and Markdown documents via a file picker, view document content, and the system indexes them into searchable chunks for grounded Q&A with citations.

## Core Features

### Document Management
- Import `.txt` and `.md` files through a file picker in the ImportPanel.
- File validation: existence check, 10 MB size limit.
- View document metadata: title, filename, size, import date, indexing status.
- View document chunks with metadata (character count, word count).
- Browse a list of all imported documents in a sidebar panel.
- Delete documents and their associated data (content file, original copy).

### Text Indexing
- Split documents into ~500-character chunks at paragraph boundaries.
- Store chunks with metadata (character count, word count).
- Track indexing status per document and overall.
- Support indexing individual documents or the full library.
- Documents automatically marked as "indexed" after chunking.
- Indexing status visible in sidebar and status bar.

### Grounded Q&A
- Ask natural language questions about the document library.
- Receive answers with citations pointing to specific document chunks.
- Confidence scores indicate answer reliability (0.85 with citations, 0.30 without).
- 8 mock answer patterns covering architecture, import, indexing, retrieval, meetings, logging, feedback, and clean state.
- Full Q&A history is persisted across sessions.
- Query latency typically under 500ms.

### Conversation History
- Chat-style display of all Q&A exchanges.
- User questions shown as purple bubbles (right-aligned).
- Assistant answers shown as dark bubbles (left-aligned).
- Expandable citations for each answer.
- Confidence indicator with color coding (green/yellow/red).
- Timestamps on each exchange.
- Clear history with confirmation dialog.

### Feedback Collection
- Thumbs up/down buttons on each Q&A response in conversation history.
- Thumbs up/down buttons on the latest response in document view.
- Feedback persists across sessions.
- Each feedback entry includes: ID, Q&A timestamp, question, rating, optional comment, submission time.

### Clean State Reset
- Reset button in application header.
- Confirmation dialog before reset.
- Clears all documents, chunks, Q&A history, and feedback.
- Application returns to initial empty state.
- Data directory is removed and recreated.

### Persistence
- All data persists across application restarts.
- Document list loads automatically on application startup.
- Data stored locally in the user's application data directory.
- Four data files: documents-meta.json, qa-history.json, feedback.json, index-meta.json.

### Status Bar
- Real-time display of index status (idle, indexing, ready, error).
- Color-coded status indicator.
- Document count.
- Indexed document count.
- Last activity timestamp.

## User Interface

```
+------------------+----------------------------------------+
| Header           | History | Reset | Refresh              |
+------------------+----------------------------------------+
| Document List    | Document Detail / Conversation History |
| (sidebar)        |   - Metadata display                   |
|                  |   - Show Chunks toggle                 |
| [+ Import]       |   - Index Document button              |
|                  |   - Delete button                      |
| doc1 (Indexed)   |                                        |
|   3.2 KB         | Q&A Response:                          |
| doc2 (Imported)  |   Answer text...                       |
|   1.8 KB         |   Citations: [expandable]              |
|                  |   Confidence: high                     |
|                  |   [+1] [-1] feedback                   |
+------------------+----------------------------------------+
| Ask a question...                              [Ask]       |
+-----------------------------------------------------------+
| Status: Ready | Documents: 3 | Indexed: 3 | 12:34 PM     |
+-----------------------------------------------------------+
```

## Constraints

- Maximum supported file size: 10 MB.
- Supported formats: `.txt`, `.md`.
- Q&A uses mock patterns -- no LLM integration.
- All data is local; no network requests.
- Structured logging outputs to console (no file-based logging in this version).

## Performance Targets

- Import throughput: 10+ files per batch under 1 second.
- Indexing speed: 100+ chunks per second.
- Query latency: under 500ms per question.
- Citation accuracy: top 2 chunks must be relevant.

---

## Planned: Hybrid Retrieval (BM25 + Embeddings)

The next product milestone replaces the current keyword-overlap retriever with a hybrid search engine backed by an embedded SQLite index. This brings the "grounded Q&A" claim in line with reality and turns confidence into a measured quantity rather than a constant.

### What changes for the user

- **Better citations on paraphrased questions.** Semantic vector search catches matches that share meaning but not exact words; BM25 still handles exact-term queries (codes, names, identifiers) better than embeddings alone. Hybrid wins both.
- **Honest confidence.** Confidence is derived from the fused retrieval score distribution (top score, gap to runner-up, agreement between BM25 and vector). The hardcoded 0.85 / 0.30 values are removed.
- **Per-citation source badges.** Each citation in the conversation view shows whether it came from BM25, vector, or both — making it obvious why a chunk was surfaced.
- **Retrieval settings.** A small settings surface lets users pick mode (`hybrid` | `bm25` | `vector`), `topK`, `topN`, and the RRF constant. Sensible defaults; no tuning required.
- **Rebuild Embeddings command.** A one-click action re-embeds the entire library (idempotent), with progress feedback. Useful when switching embedding models or after a corrupted index.

### What changes under the hood

- Chunks, BM25 index, and vector index all live in a single SQLite file (`index.db`). Q&A history and feedback move there too.
- Local embeddings via `all-MiniLM-L6-v2` (384-dim). No network calls. ~25 MB bundled.
- Fusion via Reciprocal Rank Fusion (RRF).
- A first-launch migration imports existing JSON data into SQLite and preserves the originals in a `legacy/` backup folder.

### Quality measurement (mandatory companion)

A golden Q&A set (`test/fixtures/golden-qa.json`, ≥10 pairs over `data/sample-documents`) plus an eval runner (`scripts/eval-retrieval.ts`) score each mode on precision@5, MRR, and mean latency. CI fails any PR where hybrid precision@5 drops below the committed baseline.

### Acceptance bar for this milestone

- Hybrid precision@5 ≥ max(BM25-only, vector-only) on the seeded eval set.
- Query latency under 500 ms end-to-end with the bundled embedding model on a typical laptop.
- Lossless migration from the legacy JSON layout, verified by a round-trip test.
- App still starts (BM25-only) if the `sqlite-vec` extension fails to load, with a visible status flag.

### What is explicitly out of scope for this slice

- A real LLM behind the answer step (still mock patterns until a later milestone).
- Streaming token output, query rewriting, cross-encoder rerank, agentic loops — all deferred.
- PDF / DOCX ingestion — separate milestone.

See `feature_list.json` for the breakdown into 16 individually testable features across phases A (foundation), B (indexing layer), C (hybrid retrieval), D (quality measurement), and E (settings & UX). See `docs/ARCHITECTURE.md` for the schema, pipeline, and IPC additions.
