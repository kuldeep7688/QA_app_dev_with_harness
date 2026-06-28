# Knowledge Base - Grounded Q&A with Citations

A desktop application for managing a personal knowledge base. Import text and Markdown documents, index them into searchable chunks, and ask questions with grounded answers backed by citations.

## Features

### Document Management
- **Import documents** - Add `.txt` and `.md` files via native file picker
- **File validation** - Automatic existence check and 10 MB size limit
- **Rich metadata** - View title, filename, size, import date, word count, line count, and indexing status
- **Content viewing** - Browse full document content and chunk details
- **Document deletion** - Remove documents and all associated data

### Text Indexing
- **Smart chunking** - Splits documents into ~500-character chunks at paragraph boundaries
- **Chunk metadata** - Tracks character count and word count per chunk
- **Status tracking** - Monitor indexing progress per document and across the library
- **Batch indexing** - Index individual documents or the entire library at once
- **Progress indicators** - Real-time status updates in sidebar and status bar

### Grounded Q&A with Citations
- **Natural language queries** - Ask questions about your document library
- **Cited answers** - Every answer includes references to specific document chunks
- **Confidence scores** - 0.85 with citations, 0.30 without (reliability indicator)
- **8 mock patterns** - Covers architecture, import, indexing, retrieval, meetings, logging, feedback, and clean state topics
- **Fast responses** - Query latency typically under 500ms
- **Persistent history** - Full Q&A history saved across sessions

### Conversation History
- **Chat-style interface** - User questions (purple, right-aligned) and assistant answers (dark, left-aligned)
- **Expandable citations** - View supporting chunks with document title, chunk index, and excerpt
- **Confidence indicators** - Color-coded (green/yellow/red) reliability markers
- **Timestamps** - Track when each exchange occurred
- **Clear history** - Reset conversation with confirmation dialog

### Feedback Collection
- **Thumbs up/down** - Rate Q&A responses directly in the conversation history
- **Persistent feedback** - All ratings saved across sessions
- **Detailed entries** - Includes Q&A timestamp, question, rating, optional comment, and submission time

### Clean State Reset
- **One-click reset** - Clear all data from the application header
- **Confirmation dialog** - Prevents accidental data loss
- **Complete cleanup** - Removes documents, chunks, Q&A history, and feedback
- **Fresh start** - Returns app to initial empty state

### Full Persistence
- **Automatic saving** - All data persists across application restarts
- **Auto-load on startup** - Document list loads automatically
- **Local storage** - Data stored in platform-specific user data directory
- **Four data files** - `documents-meta.json`, `qa-history.json`, `feedback.json`, `index-meta.json`

### Real-Time Status Bar
- **Index status** - Shows idle, indexing, ready, or error state
- **Color-coded indicator** - Visual dot (grey/yellow/green/red)
- **Document counts** - Total and indexed document counts
- **Last activity** - Timestamp of most recent operation

## Architecture

Built with modern web technologies and Electron security best practices:

- **Electron** - Desktop application framework with secure IPC
- **TypeScript** - Type-safe codebase with strict mode
- **React 18** - Modern UI with hooks and functional components
- **Vite** - Fast bundling and hot module replacement
- **Service layer** - Clean separation with dependency injection
- **Structured logging** - JSON logs with timestamps, levels, and service tags

### Layer Structure

```
Renderer (React)
    ↕ window.knowledgeBase.* (typed IPC bridge)
Preload Script (contextBridge)
    ↕ ipcRenderer.invoke(IPC_CHANNELS.*)
Main Process (IPC handlers)
    ↕ Service method calls
Services Layer (business logic)
    ↕ Filesystem operations
PersistenceService (JSON/text I/O)
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Linux, macOS, or Windows

### Installation

1. Clone the repository
2. Run the initialization script:

```bash
bash init.sh
```

This will:
- Install dependencies
- Run type checks
- Build the project
- Verify harness files
- Check sample data

### Running the App

```bash
npm run dev
```

The application window will open automatically.

### Development

```bash
# Type checking only
npm run check

# Production build
npm run build

# Run tests
npm test

# Watch mode for tests
npm test:watch
```

## The Harness

This project includes a comprehensive development harness for AI agents and human developers:

### Core Files

- **AGENTS.md** - Startup rules, layer boundaries, conventions, and definition of done
- **CLAUDE.md** - Quick reference with all IPC channels, interfaces, and common tasks
- **feature_list.json** - Current status of all 17 features with evidence and timestamps
- **init.sh** - Project initialization and verification script

### Documentation

- **docs/ARCHITECTURE.md** - Electron layers, data flow, IPC channels, and storage layout
- **docs/PRODUCT.md** - Feature requirements and user-facing behavior
- **docs/RELIABILITY.md** - Logging, observability, clean state, and benchmarking

### Quality Control

- **clean-state-checklist.md** - Verification checklist for testing cycles
- **evaluator-rubric.md** - Grading criteria for code quality assessment
- **quality-document.md** - Comprehensive quality assessment (97/100, Grade A+)
- **session-handoff.md** - Context for resuming work across sessions
- **agent-progress.md** - Implementation log with learnings and decisions

### Performance & Maintenance

#### Benchmark Scripts

Run performance benchmarks to measure key operations:

```bash
bash scripts/benchmark.sh
```

**What it measures:**

- **Import throughput** - Copies 3 sample documents and reports files/sec
- **Indexing speed** - Estimates chunk count and reports chunks/sec
- **Query latency** - Processes 5 test queries and reports avg latency
- **Data integrity** - Validates imported files match originals byte-for-byte

**Example output:**

```
=== Benchmark Results ===
[import] 3 files: 14ms (214 files/sec)
[index]  ~20 chunks: 13ms (1538 chunks/sec)
[query]  5 questions: 13ms (2.6ms avg)
[verify] Data integrity: PASS
=== Summary: 4/4 tasks passed ===
```

#### Cleanup Scanner

Check for stale artifacts and inconsistent state:

```bash
bash scripts/cleanup-scanner.sh
```

**What it checks:**

- **Orphaned content files** - Content without metadata
- **Dangling chunks** - Chunks without index entries
- **Missing content** - Metadata without content files
- **Inconsistent metadata** - Indexed status without chunks
- **Stale Q&A references** - History citing deleted documents

**Example output:**

```
=== Cleanup Scanner ===
[OK] No orphaned content files
[OK] No dangling chunk files
[OK] No missing content files
[OK] All indexed documents have chunk files
[OK] No stale Q&A references
=== Result: CLEAN (0 issues) ===
```

### Structured Logging

All services emit structured JSON logs for runtime observability:

```json
{
  "timestamp": "2026-03-30T12:00:00.000Z",
  "level": "INFO",
  "service": "document-service",
  "message": "Document imported successfully",
  "data": {
    "documentId": "abc-123",
    "filename": "design-notes.md",
    "sizeBytes": 2048
  }
}
```

**Log levels:**
- DEBUG - Routine data access
- INFO - Significant events
- WARN - Non-critical issues
- ERROR - Failures

**Configure log level:**

```bash
LOG_LEVEL=INFO npm run dev    # INFO, WARN, ERROR only
LOG_LEVEL=WARN npm run dev    # WARN and ERROR only
LOG_LEVEL=ERROR npm run dev   # ERROR only
```

## Project Status

All 17 features are complete and verified:

| Feature | Status |
|---------|--------|
| Window Launch | ✓ pass |
| Document List Panel | ✓ pass |
| Question Panel | ✓ pass |
| Data Directory | ✓ pass |
| Document Import | ✓ pass |
| Document Detail with Content | ✓ pass |
| Basic Persistence | ✓ pass |
| Document Chunking | ✓ pass |
| Metadata Extraction | ✓ pass |
| Indexing Status in StatusBar | ✓ pass |
| Grounded Q&A with Citations | ✓ pass |
| Structured JSON Logging | ✓ pass |
| Conversation History | ✓ pass |
| Feedback Collection | ✓ pass |
| Clean State Reset | ✓ pass |
| Full Persistence | ✓ pass |
| Status Bar | ✓ pass |

**Harness completeness:** 13/13 files present

**Benchmark scripts:** Fully functional

**Cleanup scanner:** Operational

**Overall grade:** A+ (97/100)

## Performance Targets

- **Import throughput:** 10+ files per batch under 1 second
- **Indexing speed:** 100+ chunks per second
- **Query latency:** Under 500ms per question
- **Citation accuracy:** Top 2 chunks must be relevant

## Constraints

- Maximum file size: 10 MB
- Supported formats: `.txt`, `.md`
- Q&A uses mock patterns (no LLM integration)
- All data is local (no network requests)
- Logs to console only (no file-based logging)

## Data Storage

All data is stored in the platform-specific user data directory:

```
~/.config/knowledge-base/knowledge-base-data/  (Linux)
~/Library/Application Support/knowledge-base/knowledge-base-data/  (macOS)
%APPDATA%/knowledge-base/knowledge-base-data/  (Windows)
```

**Directory structure:**

```
knowledge-base-data/
  documents-meta.json     # Document metadata array
  content/
    <doc-id>.txt          # Extracted text content
  documents/
    <filename>            # Original file copies
  chunks/
    <doc-id>.json         # Chunk array per document
  index/
    index-meta.json       # Document ID to chunk ID mapping
  qa-history.json         # Q&A interaction log
  feedback.json           # User feedback entries
```

## License

This is a demonstration project for AI-assisted development workflows.

## Contributing

This project uses a structured development harness designed for AI agents. Before contributing:

1. Read `AGENTS.md` for conventions and boundaries
2. Read `docs/ARCHITECTURE.md` for system structure
3. Run `bash init.sh` to verify your setup
4. Run `bash scripts/benchmark.sh` before and after changes
5. Run `bash scripts/cleanup-scanner.sh` to verify data integrity
6. Update `feature_list.json` with evidence when completing features
7. Update relevant docs when adding features

## Contact

For questions about the harness methodology or architecture decisions, see the documentation in `docs/`.
