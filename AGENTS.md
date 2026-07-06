# AGENTS.md

## Startup Rules

Before writing any code, complete these steps in order:

1. **Read this file completely.** It defines the boundaries and conventions for this project.
2. **Read `docs/ARCHITECTURE.md`** to understand the Electron layer structure, chunking, and Q&A flow.
3. **Read `docs/PRODUCT.md`** to understand the feature requirements.
4. **Read `docs/RELIABILITY.md`** to understand logging, observability, and clean state requirements.
5. **Run `bash init.sh`** to verify the project builds and initializes cleanly.
6. **Read `feature_list.json`** to see the current state of all features.

## Project Context

- Chat-first AI assistant with session-based conversations
- Session management (CRUD, auto-title, persistence via SQLite)
- Tool-selectable chat messages (KB RAG, Web Search, File Upload)
- Document import with validation and text indexing
- Grounded Q&A with citations (via KB view)
- LLM answer generation via NVIDIA NIM (streaming, markdown, cancellable)
- Structured logging for runtime observability
- Web search integration via Tavily API
- File upload with text extraction for chat context
- Feedback collection on Q&A responses
- Theme toggle (dark/light with CSS custom properties)
- Clean state reset for testing
- Benchmark scripts for performance measurement
- Cleanup scanner for detecting stale artifacts

## Docs Hierarchy

The `docs/` directory is organized for agent readability:

```
docs/
  ARCHITECTURE.md   -- Electron layers, data flow, full pipeline
  PRODUCT.md        -- Feature requirements and user-facing behavior
  RELIABILITY.md    -- Logging, observability, clean state, benchmarking
```

When adding new features, update the relevant doc before writing code.

## Electron Layer Boundaries

### Main Process (`src/main/`)

- Owns BrowserWindow lifecycle and IPC registration.
- All filesystem access happens here via services.
- Structured logging for all IPC events.

### Preload (`src/preload/`)

- The ONLY bridge between main and renderer.
- Uses `contextBridge.exposeInMainWorld` to expose typed APIs.
- Exposes: documents, indexing, qa, feedback, app, llm, settings, llmSettings, sessions, chat namespaces.

### Renderer (`src/renderer/`)

- React + TypeScript UI layer.
- Communicates exclusively through `window.knowledgeBase` API.
- Never imports Node.js modules.

### Services (`src/services/`)

- Pure TypeScript business logic in the main process.
- Constructor-injected `PersistenceService`.
- All services use `logger.forService()` for structured JSON output.

## Conventions

- TypeScript strict mode. No `any` without a comment explaining why.
- Named exports only.
- IPC channels defined once in `src/shared/types.ts`.
- New IPC channels follow the pattern: `namespace:action`.
- All service methods must log at INFO level for significant events.
- DEBUG level for routine data access.
- WARN for missing but non-critical data.
- ERROR for failures.

## Working Rules

- Work on one feature at a time.
- Do not mark a feature complete just because code was added.
- Keep changes within the selected feature scope unless a blocker forces a
  narrow supporting fix.
- Do not silently change verification rules during implementation.
- Prefer durable repo artifacts over chat summaries.

## Definition of Done

A feature is "done" when:

1. TypeScript compiles without errors (`npm run check`).
2. The app launches and the window is visible.
3. The feature appears in `feature_list.json` with status `"pass"` and evidence.
4. The code respects Electron layer boundaries.
5. Structured logging covers all service operations.
6. `docs/ARCHITECTURE.md` and/or `docs/PRODUCT.md` are updated.
7. `clean-state-checklist.md` passes all checks.

## Session Handoff

When resuming work, read `session-handoff.md` for context from the previous session. When finishing a session, update it with:

- What was accomplished
- What remains
- Any blockers or decisions made
- Files that were modified
- Benchmark results if applicable

Update the `agent-progress.md` by appending a new entry with implementation details, learnings, and verification

## Testing

- **Always use `npm test`** to run all 204 tests across 24 test files. This handles the native module rebuild: `pretest` rebuilds `better-sqlite3` for Node.js, then vitest runs, then `posttest` rebuilds it back for Electron.
- **Never run `npx vitest run` directly** — it skips the `pretest` hook, so test files fail with `NODE_MODULE_VERSION` mismatch (Node.js 127 vs Electron 146).
- To run a single test file: `npx vitest run test/<file>.test.ts` — but only after running `npm rebuild better-sqlite3` first.
- Vitest picks up all `*.test.ts` files under `test/` automatically.

## Clean State

Before each major testing cycle:

1. Run `bash scripts/cleanup-scanner.sh` to check for stale artifacts.
2. Use the in-app Reset button or `RESET_DATA` IPC to clear all data.
3. Verify `clean-state-checklist.md` passes.
4. Run `bash scripts/benchmark.sh` to measure performance.

