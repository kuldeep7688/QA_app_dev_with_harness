# Chat Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot the Electron app from KB-only Q&A to a two-view AI assistant with sessions, tool-selectable chat (KB RAG, Web Search, File Upload), and Tavily integration.

**Architecture:** Add SessionService, ChatService, WebSearchService. Two SQLite migrations (sessions + chat_messages). Restructure App.tsx for two-tab navigation. Reuse existing LlmProvider, retriever, and services.

**Tech Stack:** TypeScript, Electron, React 18, SQLite (better-sqlite3), NVIDIA NIM, Tavily API, Vite

---

## File Structure

### New files (7):
- `src/services/session-service.ts` — Session CRUD
- `src/services/chat-service.ts` — Chat orchestration (tools + LLM)
- `src/services/web-search-service.ts` — Tavily API wrapper
- `src/services/migrations/006_sessions.sql` — sessions + chat_messages tables
- `src/renderer/components/ChatView.tsx` — Chat view container
- `src/renderer/components/SessionList.tsx` — Session sidebar
- `src/renderer/components/ChatInput.tsx` — Input bar with tool toggles

### Modified files (10):
- `src/shared/types.ts` — Add Session, ChatMessage, ChatTools, IPC channels
- `src/services/env-config.ts` — Add TAVILY_API_KEY
- `src/services/db.ts` — Register migration 006
- `src/main/ipc-handlers.ts` — Add session + chat IPC handlers
- `src/main/main.ts` — Wire new services
- `src/preload/preload.ts` — Expose sessions + chat namespaces
- `src/renderer/types.d.ts` — Add session/chat type declarations
- `src/renderer/App.tsx` — Two-tab navigation (Chat | Knowledge Base)
- `.env.example` — Add TAVILY_API_KEY
- `src/services/retriever.ts` — export hybridSearch for ChatService import

### Test files (4):
- `test/session-service.test.ts` — Session CRUD + persistence
- `test/web-search-service.test.ts` — Tavily search formatting
- `test/chat-service.test.ts` — Full chat flow with tools
- `test/chat-view.test.ts` — Renderer integration tests

---

## Tasks

### Task 1: Migration 006 — sessions + chat_messages tables

**Files:**
- Create: `src/services/migrations/006_sessions.sql`
- Verify: `test/migrations.test.ts` (existing — no change)

- [ ] **Step 1: Create the migration SQL**

```sql
-- 006_sessions.sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tools_json TEXT,
  citations_json TEXT,
  web_results_json TEXT,
  uploaded_files_json TEXT,
  tokens_used_json TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages(session_id, id);
```

- [ ] **Step 2: Register migration in db.ts**

In `src/services/db.ts`, after the existing migration imports/registrations, add a comment noting 006_sessions.sql will be auto-discovered by the migration runner (it loads all `*.sql` files from the migrations directory sorted numerically). No code change needed if the runner globs the directory — verify this by checking `runner.ts`:

Run: `grep -n 'glob\|readdir\|\\.sql' src/services/migrations/runner.ts`
Expected: Runner already discovers .sql files dynamically. If yes, no change needed. If it has a hardcoded list, add 006.

- [ ] **Step 3: Commit**

```bash
git add src/services/migrations/006_sessions.sql
git commit -m "feat: add sessions and chat_messages tables"
```

---

### Task 2: Types — add Session, ChatMessage, ChatTools, IPC channels

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add new interfaces to shared/types.ts**

```typescript
// Existing interfaces (Document, Citation, QAResponse, etc.) remain unchanged.

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface UploadedFileData {
  name: string;
  content: string;
  type: string;
}

export interface ChatTools {
  kbEnabled: boolean;
  webEnabled: boolean;
  files?: UploadedFileData[];
}

export interface ChatMessageData {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolsConfig?: ChatTools;
  citations?: Citation[];
  webResults?: { title: string; url: string; content: string }[];
  uploadedFiles?: { name: string; type: string; size: number }[];
  tokensUsed?: TokenUsage;
  model?: string;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
```

- [ ] **Step 2: Add IPC channels**

In the `IPC_CHANNELS` constant:

```typescript
SESSIONS_LIST: 'sessions:list',
SESSIONS_CREATE: 'sessions:create',
SESSIONS_GET: 'sessions:get',
SESSIONS_UPDATE: 'sessions:update',
SESSIONS_DELETE: 'sessions:delete',
CHAT_SEND: 'chat:send',
CHAT_SEND_STREAM: 'chat:send-stream',
CHAT_CANCEL: 'chat:cancel',
CHAT_STREAM_CHUNK: 'chat:stream-chunk',
CHAT_STREAM_DONE: 'chat:stream-done',
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add Session, ChatMessageData, ChatTools types and IPC channels"
```

---

### Task 3: WebSearchService — Tavily API wrapper

**Files:**
- Create: `src/services/web-search-service.ts`
- Test: `test/web-search-service.test.ts`

- [ ] **Step 1: Create WebSearchService**

```typescript
import { logger } from './logger.js';

const log = logger.forService('web-search-service');

export interface WebSearchConfig {
  apiKey: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

export class WebSearchService {
  private apiKey: string;
  private baseUrl = 'https://api.tavily.com/search';

  constructor(config: WebSearchConfig) {
    this.apiKey = config.apiKey;
    log.info('WebSearchService initialized', { baseUrl: this.baseUrl, keyPresent: !!this.apiKey });
  }

  async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
    if (!query.trim()) return [];
    if (!this.apiKey) {
      log.warn('Web search disabled: no API key');
      return [];
    }

    const start = Date.now();
    log.info('Web search starting', { queryLength: query.length, maxResults });

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          include_answer: false,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
          log.error('Web search: invalid API key', { status });
          return [];
        }
        if (status === 429) {
          log.warn('Web search: rate limited', { status });
          return [];
        }
        log.error('Web search: API error', { status });
        return [];
      }

      const data = await response.json() as { results: Array<{ title: string; url: string; content: string }> };
      const results: WebSearchResult[] = (data.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
      }));

      const duration = Date.now() - start;
      if (results.length > 0) {
        log.info('Web search completed', { resultCount: results.length, durationMs: duration });
      } else {
        log.info('Web search: no results', { durationMs: duration });
      }

      return results;
    } catch (err) {
      const duration = Date.now() - start;
      log.error('Web search: network error', { durationMs: duration, error: String(err) });
      return [];
    }
  }
}
```

- [ ] **Step 2: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSearchService } from '../src/services/web-search-service.js';

describe('WebSearchService', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns empty array for empty query', async () => {
    const service = new WebSearchService({ apiKey: 'test-key' });
    const results = await service.search('');
    expect(results).toEqual([]);
  });

  it('returns empty array when no API key', async () => {
    const service = new WebSearchService({ apiKey: '' });
    const results = await service.search('hello');
    expect(results).toEqual([]);
  });

  it('parses search results from Tavily response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: 'Result 1', url: 'https://example.com/1', content: 'Content 1' },
          { title: 'Result 2', url: 'https://example.com/2', content: 'Content 2' },
        ],
      }),
    });
    const service = new WebSearchService({ apiKey: 'test-key' });
    const results = await service.search('test query');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: 'Result 1', url: 'https://example.com/1', content: 'Content 1' });
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    const service = new WebSearchService({ apiKey: 'test-key' });
    const results = await service.search('test');
    expect(results).toEqual([]);
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    const service = new WebSearchService({ apiKey: 'test-key' });
    const results = await service.search('test');
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run test/web-search-service.test.ts`
Expected: 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/web-search-service.ts test/web-search-service.test.ts
git commit -m "feat: add Tavily WebSearchService"
```

---

### Task 4: SessionService — Session CRUD

**Files:**
- Create: `src/services/session-service.ts`
- Test: `test/session-service.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase, resetDatabaseInstance } from '../src/services/db.js';
import { runMigrations } from '../src/services/migrations/runner.js';
import { SessionService } from '../src/services/session-service.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const TEST_DB_DIR = path.join(process.cwd(), 'test-temp-sessions');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'index.db');

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    const db = new Database(TEST_DB_PATH);
    runMigrations(db);
    service = new SessionService(db);
  });

  afterEach(() => {
    service = null!;
    closeDatabase();
    resetDatabaseInstance();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('creates a session with default title', () => {
    const session = service.createSession();
    expect(session.title).toBe('New Chat');
    expect(session.messageCount).toBe(0);
    expect(session.id).toBeTruthy();
  });

  it('creates a session with custom title', () => {
    const session = service.createSession('Custom Title');
    expect(session.title).toBe('Custom Title');
  });

  it('lists sessions sorted by updatedAt descending', () => {
    const s1 = service.createSession('First');
    const s2 = service.createSession('Second');
    const sessions = service.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe(s2.id); // most recent first
    expect(sessions[1].id).toBe(s1.id);
  });

  it('gets a session by id', () => {
    const created = service.createSession('Test');
    const fetched = service.getSession(created.id);
    expect(fetched).toBeTruthy();
    expect(fetched!.title).toBe('Test');
  });

  it('returns null for non-existent session', () => {
    expect(service.getSession('nonexistent')).toBeNull();
  });

  it('updates session title', () => {
    const created = service.createSession('Old');
    service.updateSession(created.id, { title: 'New' });
    const updated = service.getSession(created.id);
    expect(updated!.title).toBe('New');
  });

  it('deletes a session', () => {
    const created = service.createSession('Delete Me');
    service.deleteSession(created.id);
    expect(service.getSession(created.id)).toBeNull();
  });

  it('adds a message and updates messageCount', () => {
    const session = service.createSession();
    const msg = service.addMessage(session.id, { role: 'user', content: 'Hello' });
    expect(msg.id).toBeTruthy();
    expect(msg.role).toBe('user');

    const updated = service.getSession(session.id);
    expect(updated!.messageCount).toBe(1);
  });

  it('gets messages for a session', () => {
    const session = service.createSession();
    service.addMessage(session.id, { role: 'user', content: 'Hi' });
    service.addMessage(session.id, { role: 'assistant', content: 'Hello!' });
    const messages = service.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hi');
    expect(messages[1].content).toBe('Hello!');
  });

  it('auto-generates title from first message', () => {
    const session = service.createSession();
    service.setAutoTitle(session.id, 'This is a long user message that should become the session title');
    const updated = service.getSession(session.id);
    expect(updated!.title).toBe('This is a long user message that should become th...');
  });

  it('persists sessions across service instances', () => {
    const db = getDatabase();
    const s1 = service.createSession('Persist Me');
    service.addMessage(s1.id, { role: 'user', content: 'Hello' });
    const s2 = new SessionService(db);
    const sessions = s2.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Persist Me');
  });
});
```

- [ ] **Step 2: Write SessionService implementation**

```typescript
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { logger } from './logger.js';

const log = logger.forService('session-service');

export interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tools_json: string | null;
  citations_json: string | null;
  web_results_json: string | null;
  uploaded_files_json: string | null;
  tokens_used_json: string | null;
  model: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolsConfig?: Record<string, unknown>;
  citations?: unknown[];
  webResults?: unknown[];
  uploadedFiles?: unknown[];
  tokensUsed?: { prompt: number; completion: number; total: number };
  model?: string;
  createdAt: string;
}

export type AddMessageInput = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolsConfig?: Record<string, unknown>;
  citations?: unknown[];
  webResults?: unknown[];
  uploadedFiles?: unknown[];
  tokensUsed?: { prompt: number; completion: number; total: number };
  model?: string;
};

const MAX_TITLE_LENGTH = 60;

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  };
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    toolsConfig: row.tools_json ? JSON.parse(row.tools_json) : undefined,
    citations: row.citations_json ? JSON.parse(row.citations_json) : undefined,
    webResults: row.web_results_json ? JSON.parse(row.web_results_json) : undefined,
    uploadedFiles: row.uploaded_files_json ? JSON.parse(row.uploaded_files_json) : undefined,
    tokensUsed: row.tokens_used_json ? JSON.parse(row.tokens_used_json) : undefined,
    model: row.model || undefined,
    createdAt: row.created_at,
  };
}

export class SessionService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    log.info('SessionService initialized');
  }

  createSession(title?: string): Session {
    const id = uuid();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'INSERT INTO sessions (id, title, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, 0)'
    );
    stmt.run(id, title || 'New Chat', now, now);
    log.info('Session created', { sessionId: id, title: title || 'New Chat' });
    return this.getSession(id)!;
  }

  listSessions(): Session[] {
    const rows = this.db.prepare(
      'SELECT * FROM sessions ORDER BY updated_at DESC'
    ).all() as SessionRow[];
    log.debug('Listed sessions', { count: rows.length });
    return rows.map(rowToSession);
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) return null;
    return rowToSession(row);
  }

  updateSession(id: string, data: { title?: string }): Session | null {
    if (data.title !== undefined) {
      const now = new Date().toISOString();
      this.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(data.title, now, id);
      log.info('Session updated', { sessionId: id, title: data.title });
    }
    return this.getSession(id);
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    log.info('Session deleted', { sessionId: id });
  }

  addMessage(sessionId: string, input: AddMessageInput): ChatMessage {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, tools_json, citations_json, web_results_json, uploaded_files_json, tokens_used_json, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      sessionId,
      input.role,
      input.content,
      input.toolsConfig ? JSON.stringify(input.toolsConfig) : null,
      input.citations ? JSON.stringify(input.citations) : null,
      input.webResults ? JSON.stringify(input.webResults) : null,
      input.uploadedFiles ? JSON.stringify(input.uploadedFiles) : null,
      input.tokensUsed ? JSON.stringify(input.tokensUsed) : null,
      input.model || null,
      now,
    );
    this.db.prepare('UPDATE sessions SET updated_at = ?, message_count = message_count + 1 WHERE id = ?').run(now, sessionId);
    log.debug('Message added', { sessionId, role: input.role, messageId: result.lastInsertRowid });
    const row = this.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid) as ChatMessageRow;
    return rowToMessage(row);
  }

  getMessages(sessionId: string): ChatMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId) as ChatMessageRow[];
    log.debug('Retrieved messages', { sessionId, count: rows.length });
    return rows.map(rowToMessage);
  }

  setAutoTitle(sessionId: string, firstMessage: string): void {
    const trimmed = firstMessage.trim();
    if (!trimmed) return;
    const title = trimmed.length > MAX_TITLE_LENGTH
      ? trimmed.substring(0, MAX_TITLE_LENGTH) + '...'
      : trimmed;
    this.updateSession(sessionId, { title });
    log.info('Session auto-titled', { sessionId, title });
  }
}
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run test/session-service.test.ts`
Expected: 11 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/session-service.ts test/session-service.test.ts
git commit -m "feat: add SessionService with CRUD and auto-title"
```

---

### Task 5: ChatService — chat orchestration

**Files:**
- Create: `src/services/chat-service.ts`
- Test: `test/chat-service.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase, resetDatabaseInstance } from '../src/services/db.js';
import { runMigrations } from '../src/services/migrations/runner.js';
import { SessionService } from '../src/services/session-service.js';
import { ChatService } from '../src/services/chat-service.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const TEST_DB_DIR = path.join(process.cwd(), 'test-temp-chat');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'index.db');

describe('ChatService', () => {
  let db: Database.Database;
  let sessionService: SessionService;
  let chatService: ChatService;
  let mockProvider: any;

  beforeEach(() => {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    db = new Database(TEST_DB_PATH);
    runMigrations(db);
    sessionService = new SessionService(db);
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        content: 'Test response',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'mock-model',
      }),
      chatStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'delta', content: 'Test ' };
        yield { type: 'delta', content: 'response' };
        yield { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, model: 'mock-model' };
      }),
    };
    chatService = new ChatService(db, mockProvider, sessionService);
  });

  afterEach(() => {
    chatService = null!;
    sessionService = null!;
    closeDatabase();
    resetDatabaseInstance();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('sends a simple chat message without tools', async () => {
    const session = sessionService.createSession();
    const response = await chatService.sendMessage(session.id, 'Hello');
    expect(response.content).toBe('Test response');
    expect(response.tokensUsed).toEqual({ prompt: 10, completion: 5, total: 15 });

    const messages = sessionService.getMessages(session.id);
    expect(messages).toHaveLength(2); // user + assistant
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Test response');
  });

  it('auto-generates session title from first message', async () => {
    const session = sessionService.createSession();
    await chatService.sendMessage(session.id, 'This is a long first message that should become the title automatically');
    const updated = sessionService.getSession(session.id);
    expect(updated!.title).toBe('This is a long first message that should become th...');
  });

  it('does not override existing session title', async () => {
    const session = sessionService.createSession('My Custom Title');
    await chatService.sendMessage(session.id, 'Hello');
    const updated = sessionService.getSession(session.id);
    expect(updated!.title).toBe('My Custom Title');
  });

  it('streams chat message', async () => {
    const session = sessionService.createSession();
    const chunks: string[] = [];
    let doneContent = '';

    await chatService.sendStream(session.id, 'Hi', {}, (chunk) => {
      if (chunk.type === 'delta') chunks.push(chunk.content!);
      if (chunk.type === 'done') doneContent = chunk.content!;
    });

    expect(chunks).toEqual(['Test ', 'response']);
    expect(doneContent).toBe('Test response');

    const messages = sessionService.getMessages(session.id);
    expect(messages).toHaveLength(2);
  });

  it('cancels streaming mid-way', async () => {
    const session = sessionService.createSession();
    const controller = new AbortController();
    const chunks: string[] = [];

    const promise = chatService.sendStream(session.id, 'Hi', {}, (chunk) => {
      if (chunk.type === 'delta') chunks.push(chunk.content!);
    }, controller.signal);

    controller.abort();

    await expect(promise).resolves.toBeUndefined();
  });

  it('includes KB search results when tool enabled', async () => {
    // Mock the retriever to return citations
    const mockRetriever = vi.fn().mockResolvedValue([
      { chunk: { content: 'Doc content', documentTitle: 'Test Doc', documentId: 'doc1' }, fusedScore: 0.9 }
    ]);
    chatService = new ChatService(db, mockProvider, sessionService, mockRetriever, undefined);

    const session = sessionService.createSession();
    await chatService.sendMessage(session.id, 'What is in my docs?', { kbEnabled: true });

    expect(mockRetriever).toHaveBeenCalled();
    const messages = sessionService.getMessages(session.id);
    const assistantMsg = messages[1];
    expect(assistantMsg.citations).toBeDefined();
    expect(assistantMsg.citations).toHaveLength(1);
  });

  it('includes web search results when tool enabled', async () => {
    const mockWebSearch = {
      search: vi.fn().mockResolvedValue([
        { title: 'Web Result', url: 'https://example.com', content: 'Web content' },
      ]),
    };
    chatService = new ChatService(db, mockProvider, sessionService, undefined, mockWebSearch);

    const session = sessionService.createSession();
    await chatService.sendMessage(session.id, 'Search something', { webEnabled: true });

    expect(mockWebSearch.search).toHaveBeenCalled();
    const messages = sessionService.getMessages(session.id);
    const assistantMsg = messages[1];
    expect(assistantMsg.webResults).toBeDefined();
    expect(assistantMsg.webResults).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Write ChatService implementation**

```typescript
import Database from 'better-sqlite3';
import { logger } from './logger.js';
import { SessionService, AddMessageInput } from './session-service.js';
import type { ChatTools, UploadedFileData } from '../shared/types.js';
import type { LlmProvider, StreamChunk, ChatMessage as ProviderChatMessage, TokenUsage } from './providers/types.js';

const log = logger.forService('chat-service');

type Citation = {
  documentTitle: string;
  documentId: string;
  chunkIndex: number;
  excerpt: string;
};

type WebSearchResult = {
  title: string;
  url: string;
  content: string;
};

type HybridSearchResult = {
  chunk: { content: string; documentTitle: string; documentId: string };
  fusedScore: number;
};

type ChatResult = {
  content: string;
  tokensUsed?: TokenUsage;
  model?: string;
  citations?: Citation[];
  webResults?: WebSearchResult[];
};

export class ChatService {
  private db: Database.Database;
  private llmProvider: LlmProvider;
  private sessionService: SessionService;
  private retriever?: (query: string) => Promise<HybridSearchResult[]>;
  private webSearchService?: { search: (query: string) => Promise<WebSearchResult[]> };
  private systemPrompt: string;

  constructor(
    db: Database.Database,
    llmProvider: LlmProvider,
    sessionService: SessionService,
    retriever?: (query: string) => Promise<HybridSearchResult[]>,
    webSearchService?: { search: (query: string) => Promise<WebSearchResult[]> },
    systemPrompt?: string,
  ) {
    this.db = db;
    this.llmProvider = llmProvider;
    this.sessionService = sessionService;
    this.retriever = retriever;
    this.webSearchService = webSearchService;
    this.systemPrompt = systemPrompt || 'You are a helpful AI assistant. Answer the user\'s question concisely and accurately.';
    log.info('ChatService initialized', { hasRetriever: !!retriever, hasWebSearch: !!webSearchService });
  }

  async sendMessage(
    sessionId: string,
    text: string,
    tools?: ChatTools,
  ): Promise<ChatResult> {
    const start = Date.now();
    log.info('Chat message', { sessionId, textLength: text.length, tools: tools ? { kbEnabled: !!tools.kbEnabled, webEnabled: !!tools.webEnabled, fileCount: tools.files?.length } : {} });

    const userMessage: AddMessageInput = {
      role: 'user',
      content: text,
      toolsConfig: tools ? { kbEnabled: !!tools.kbEnabled, webEnabled: !!tools.webEnabled, fileCount: tools.files?.length || 0 } : undefined,
    };
    this.sessionService.addMessage(sessionId, userMessage);

    const citations = tools?.kbEnabled ? await this.searchKnowledgeBase(text) : [];
    const webResults = tools?.webEnabled ? await this.searchWeb(text) : [];
    const fileContents = tools?.files?.map(f => ({ name: f.name, content: f.content })) || [];

    const messages = this.buildPrompt(text, citations, webResults, fileContents);
    const history = this.sessionService.getMessages(sessionId);
    const recentHistory = history.slice(-6, -1); // last 3 exchanges (skip current user msg)
    for (const h of recentHistory) {
      messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
    }
    messages.push({ role: 'user', content: text });

    try {
      const response = await this.llmProvider.chat(messages, {});
      const duration = Date.now() - start;

      const assistantMsg: AddMessageInput = {
        role: 'assistant',
        content: response.content,
        tokensUsed: response.usage ? { prompt: response.usage.prompt_tokens || 0, completion: response.usage.completion_tokens || 0, total: response.usage.total_tokens || 0 } : undefined,
        model: response.model || undefined,
        citations: citations.length > 0 ? citations : undefined,
        webResults: webResults.length > 0 ? webResults : undefined,
        uploadedFiles: tools?.files?.map(f => ({ name: f.name, type: f.type, size: f.content.length })) || undefined,
      };
      this.sessionService.addMessage(sessionId, assistantMsg);

      this.autoTitle(sessionId, text);

      log.info('Chat response generated', { durationMs: duration, contentLength: response.content.length, tokens: response.usage?.total_tokens });

      return {
        content: response.content,
        tokensUsed: assistantMsg.tokensUsed,
        model: response.model || undefined,
        citations,
        webResults,
      };
    } catch (err) {
      const duration = Date.now() - start;
      log.error('Chat response failed', { durationMs: duration, error: String(err) });
      throw err;
    }
  }

  async sendStream(
    sessionId: string,
    text: string,
    tools: ChatTools = {},
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    log.info('Chat stream starting', { sessionId, textLength: text.length });

    const userMessage: AddMessageInput = {
      role: 'user',
      content: text,
      toolsConfig: { kbEnabled: !!tools.kbEnabled, webEnabled: !!tools.webEnabled, fileCount: tools.files?.length || 0 },
    };
    this.sessionService.addMessage(sessionId, userMessage);

    const citations = tools.kbEnabled ? await this.searchKnowledgeBase(text) : [];
    const webResults = tools.webEnabled ? await this.searchWeb(text) : [];
    const fileContents = tools.files?.map(f => ({ name: f.name, content: f.content })) || [];

    const messages = this.buildPrompt(text, citations, webResults, fileContents);
    const history = this.sessionService.getMessages(sessionId);
    const recentHistory = history.slice(-6, -1);
    for (const h of recentHistory) {
      messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
    }
    messages.push({ role: 'user', content: text });

    let fullContent = '';
    let lastUsage: any;

    try {
      const stream = this.llmProvider.chatStream(messages, { signal });

      for await (const chunk of stream) {
        if (chunk.type === 'delta') {
          fullContent += chunk.content || '';
          onChunk(chunk);
        } else if (chunk.type === 'done') {
          lastUsage = chunk.usage;
          const assistantMsg: AddMessageInput = {
            role: 'assistant',
            content: fullContent,
            tokensUsed: lastUsage ? { prompt: lastUsage.prompt_tokens || 0, completion: lastUsage.completion_tokens || 0, total: lastUsage.total_tokens || 0 } : undefined,
            model: chunk.model || undefined,
            citations: citations.length > 0 ? citations : undefined,
            webResults: webResults.length > 0 ? webResults : undefined,
            uploadedFiles: tools.files?.map(f => ({ name: f.name, type: f.type, size: f.content.length })) || undefined,
          };
          this.sessionService.addMessage(sessionId, assistantMsg);
          this.autoTitle(sessionId, text);
          onChunk({ type: 'done', content: fullContent, usage: lastUsage, model: chunk.model });
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        log.debug('Chat stream cancelled', { sessionId });
        if (fullContent) {
          const assistantMsg: AddMessageInput = {
            role: 'assistant',
            content: fullContent + '\n\n*[cancelled]*',
            citations: citations.length > 0 ? citations : undefined,
            webResults: webResults.length > 0 ? webResults : undefined,
          };
          this.sessionService.addMessage(sessionId, assistantMsg);
        }
        return;
      }
      log.error('Chat stream error', { sessionId, error: String(err) });
      throw err;
    }
  }

  private async searchKnowledgeBase(query: string): Promise<Citation[]> {
    if (!this.retriever) return [];
    try {
      const results = await this.retriever(query);
      log.info('KB search for chat', { queryLength: query.length, resultCount: results.length });
      return results.map(r => ({
        documentTitle: r.chunk.documentTitle,
        documentId: r.chunk.documentId,
        chunkIndex: 0,
        excerpt: r.chunk.content.substring(0, 200),
      }));
    } catch (err) {
      log.error('KB search failed in chat', { error: String(err) });
      return [];
    }
  }

  private async searchWeb(query: string): Promise<WebSearchResult[]> {
    if (!this.webSearchService) return [];
    try {
      return await this.webSearchService.search(query);
    } catch (err) {
      log.error('Web search failed in chat', { error: String(err) });
      return [];
    }
  }

  private buildPrompt(
    text: string,
    citations: Citation[],
    webResults: WebSearchResult[],
    fileContents: { name: string; content: string }[],
  ): ProviderChatMessage[] {
    const parts: string[] = [this.systemPrompt];

    if (citations.length > 0) {
      parts.push('\n\n## Knowledge Base Results\nAnswer based on these document excerpts. Cite the document title for each claim.');
      for (const c of citations) {
        parts.push(`\n[${c.documentTitle}]: ${c.excerpt}`);
      }
    }

    if (webResults.length > 0) {
      parts.push('\n\n## Web Search Results\nUse these search results to answer. Include source URLs.');
      for (const r of webResults) {
        parts.push(`\n[${r.title}](${r.url}): ${r.content}`);
      }
    }

    if (fileContents.length > 0) {
      parts.push('\n\n## Uploaded Files\nThe user uploaded the following files. Answer based on their content.');
      for (const f of fileContents) {
        parts.push(`\n--- File: ${f.name} ---\n${f.content}`);
      }
    }

    return [{ role: 'system', content: parts.join('\n') }];
  }

  private autoTitle(sessionId: string, text: string): void {
    const session = this.sessionService.getSession(sessionId);
    if (session && session.title === 'New Chat' && text.trim()) {
      this.sessionService.setAutoTitle(sessionId, text);
    }
  }
}
```

> When implementing, import `Citation`, `WebSearchResult`, and `HybridSearchResult` from `src/shared/types.ts` and `src/services/retriever.ts` instead of redefining them locally. The inline types above are for illustration only.

- [ ] **Step 3: Run the test**

Run: `npm rebuild better-sqlite3 && npx vitest run test/chat-service.test.ts`
Expected: 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/chat-service.ts test/chat-service.test.ts
git commit -m "feat: add ChatService with tool orchestration and streaming"
```

---

### Task 6: IPC handlers + main.ts + preload wiring

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/preload.ts`

- [ ] **Step 1: Add session and chat handlers to ipc-handlers.ts**

```typescript
// Inside registerIpcHandlers, after existing handlers:

// --- Session IPC Handlers ---
ipcMain.handle(IPC_CHANNELS.SESSIONS_LIST, async () => {
  log.info('IPC: sessions:list');
  return sessionService.listSessions();
});

ipcMain.handle(IPC_CHANNELS.SESSIONS_CREATE, async (_event, title?: string) => {
  log.info('IPC: sessions:create');
  return sessionService.createSession(title);
});

ipcMain.handle(IPC_CHANNELS.SESSIONS_GET, async (_event, id: string) => {
  log.debug('IPC: sessions:get', { sessionId: id });
  return sessionService.getSession(id);
});

ipcMain.handle(IPC_CHANNELS.SESSIONS_UPDATE, async (_event, id: string, data: { title?: string }) => {
  log.info('IPC: sessions:update', { sessionId: id });
  return sessionService.updateSession(id, data);
});

ipcMain.handle(IPC_CHANNELS.SESSIONS_DELETE, async (_event, id: string) => {
  log.info('IPC: sessions:delete', { sessionId: id });
  sessionService.deleteSession(id);
});

// --- Chat IPC Handlers ---
const activeChatStreams = new Map<string, AbortController>();

ipcMain.handle(IPC_CHANNELS.CHAT_SEND, async (_event, request: { sessionId: string; text: string; tools?: ChatTools }) => {
  log.info('IPC: chat:send', { sessionId: request.sessionId, textLength: request.text.length });
  return chatService.sendMessage(request.sessionId, request.text, request.tools);
});

ipcMain.handle(IPC_CHANNELS.CHAT_SEND_STREAM, async (event, request: { sessionId: string; text: string; tools?: ChatTools; requestId: string }) => {
  log.info('IPC: chat:send-stream', { sessionId: request.sessionId, requestId: request.requestId, textLength: request.text.length });
  const controller = new AbortController();
  activeChatStreams.set(request.requestId, controller);

  try {
    await chatService.sendStream(
      request.sessionId,
      request.text,
      request.tools,
      (chunk) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send(IPC_CHANNELS.CHAT_STREAM_CHUNK, { requestId: request.requestId, ...chunk });
      },
      controller.signal,
    );
  } finally {
    activeChatStreams.delete(request.requestId);
    if (!event.sender.isDestroyed()) {
      // stream-done already sent in the stream loop
    }
  }
});

ipcMain.handle(IPC_CHANNELS.CHAT_CANCEL, async (_event, requestId: string) => {
  log.debug('IPC: chat:cancel', { requestId });
  const controller = activeChatStreams.get(requestId);
  if (controller) {
    controller.abort();
    activeChatStreams.delete(requestId);
  }
});
```

- [ ] **Step 2: Wire services in main.ts**

In `src/main/main.ts`, after existing service initialization, add:

```typescript
import { SessionService } from '../services/session-service.js';
import { ChatService } from '../services/chat-service.js';
import { WebSearchService } from '../services/web-search-service.js';
import { hybridSearch } from '../services/retriever.js';
import { embed } from '../services/embedding-service.js';

// After db init and migration:
const sessionService = new SessionService(db);

const webSearchService = config.tavilyApiKey
  ? new WebSearchService({ apiKey: config.tavilyApiKey })
  : undefined;

const chatService = new ChatService(
  db,
  llmProvider, // reuse the same provider created earlier
  sessionService,
  (query: string) => hybridSearch(db, query, embed),
  webSearchService || undefined,
  settingsService.getLlmSettings()?.systemPrompt || undefined,
);
```

Also in main.ts, update the `Services` interface and construction to include the new services, and pass them to `registerIpcHandlers`.

- [ ] **Step 3: Add chat and sessions to preload API**

In `src/preload/preload.ts`:

```typescript
import { IPC_CHANNELS } from '../shared/types.js';

// Inside the main contextBridge.exposeInMainWorld block:

sessions: {
  list: () => ipcRenderer.invoke(IPC_CHANNELS.SESSIONS_LIST),
  create: (title?: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSIONS_CREATE, title),
  get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSIONS_GET, id),
  update: (id: string, data: { title?: string }) => ipcRenderer.invoke(IPC_CHANNELS.SESSIONS_UPDATE, id, data),
  delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSIONS_DELETE, id),
},

chat: {
  send: (req: { sessionId: string; text: string; tools?: ChatTools }) =>
    ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, req),
  sendStream: (req: { sessionId: string; text: string; tools?: ChatTools; requestId: string }) => {
    ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND_STREAM, req);
  },
  cancel: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_CANCEL, requestId),
  onStreamChunk: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM_CHUNK, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM_CHUNK, handler);
  },
  onStreamDone: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM_DONE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM_DONE, handler);
  },
},
```

- [ ] **Step 4: Update preload type declarations in renderer/types.d.ts**

Add to the existing `KnowledgeBaseAPI` interface:

```typescript
sessions: {
  list: () => Promise<import('../shared/types.js').Session[]>;
  create: (title?: string) => Promise<import('../shared/types.js').Session>;
  get: (id: string) => Promise<import('../shared/types.js').Session | null>;
  update: (id: string, data: { title?: string }) => Promise<import('../shared/types.js').Session | null>;
  delete: (id: string) => Promise<void>;
};

chat: {
  send: (req: { sessionId: string; text: string; tools?: import('../shared/types.js').ChatTools }) => Promise<any>;
  sendStream: (req: { sessionId: string; text: string; tools?: import('../shared/types.js').ChatTools; requestId: string }) => void;
  cancel: (requestId: string) => void;
  onStreamChunk: (callback: (data: any) => void) => () => void;
  onStreamDone: (callback: (data: any) => void) => () => void;
};
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/main.ts src/preload/preload.ts src/renderer/types.d.ts
git commit -m "feat: wire session and chat IPC handlers, preload, and main.ts"
```

---

### Task 7: Env config — TAVILY_API_KEY

**Files:**
- Modify: `src/services/env-config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update env-config.ts**

Add `TAVILY_API_KEY` to the config load:

```typescript
export interface EnvConfig {
  nvidiaApiKey: string;
  nvidiaModelName: string;
  nvidiaBaseUrl: string;
  tavilyApiKey: string;
}

export function loadEnvConfig(): EnvConfig {
  dotenv.config();
  return {
    nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
    nvidiaModelName: process.env.NVIDIA_MODEL_NAME || 'google/gemma-2-2b-it',
    nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    tavilyApiKey: process.env.TAVILY_API_KEY || '',
  };
}
```

- [ ] **Step 2: Update .env.example**

Append to the existing `.env.example` (do not replace existing NVIDIA keys):

```bash
# Tavily Web Search API
# Get your key at https://tavily.com
TAVILY_API_KEY=your-tavily-key-here
```

- [ ] **Step 3: Commit**

```bash
git add src/services/env-config.ts .env.example
git commit -m "feat: add TAVILY_API_KEY to env config"
```

---

### Task 8: Chat UI components — ChatInput, SessionList, ChatView

**Files:**
- Create: `src/renderer/components/ChatInput.tsx`
- Create: `src/renderer/components/SessionList.tsx`
- Create: `src/renderer/components/ChatView.tsx`

- [ ] **Step 1: Create ChatInput component**

```typescript
import React, { useState, useRef, useCallback, useEffect } from 'react';

interface ChatInputProps {
  onSend: (text: string, tools: { kbEnabled: boolean; webEnabled: boolean; files?: { name: string; content: string; type: string }[] }) => void;
  isStreaming: boolean;
  onCancel: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isStreaming, onCancel }) => {
  const [text, setText] = useState('');
  const [kbEnabled, setKbEnabled] = useState(false);
  const [webEnabled, setWebEnabled] = useState(false);
  const [files, setFiles] = useState<{ name: string; content: string; type: string }[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!text.trim() && files.length === 0) return;
    onSend(text.trim(), { kbEnabled, webEnabled, files: files.length > 0 ? files : undefined });
    setText('');
    setFiles([]);
  }, [text, kbEnabled, webEnabled, files, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFilePick = useCallback(async () => {
    if (typeof window !== 'undefined' && (window as any).knowledgeBase?.documents?.import) {
      // Use Electron dialog for file pick
      const result = await (window as any).knowledgeBase?.app?.pickFiles?.();
      if (result?.filePaths?.length) {
        for (const fp of result.filePaths) {
          // Read via IPC — for simplicity, use the documents:import path
          // In practice, add a dedicated IPC for reading file content
          const content = await (window as any).knowledgeBase?.documents?.getContent?.(fp);
          if (content) {
            const name = fp.split(/[\\/]/).pop() || 'file';
            setFiles(prev => [...prev, { name, content, type: name.endsWith('.md') ? 'md' : 'txt' }]);
          }
        }
      }
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div className="chat-input-container">
      {files.length > 0 && (
        <div className="chat-input-files">
          {files.map((f, i) => (
            <span key={i} className="file-chip">
              {f.name} <button onClick={() => removeFile(i)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input-tools">
        <button
          className={`tool-toggle ${kbEnabled ? 'active' : ''}`}
          onClick={() => setKbEnabled(!kbEnabled)}
          title="Search Knowledge Base"
        >
          KB
        </button>
        <button
          className={`tool-toggle ${webEnabled ? 'active' : ''}`}
          onClick={() => setWebEnabled(!webEnabled)}
          title="Search Web"
        >
          Web
        </button>
        <button
          className="tool-toggle"
          onClick={handleFilePick}
          title="Upload File"
        >
          📎
        </button>
      </div>
      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isStreaming}
          rows={2}
        />
        {isStreaming ? (
          <button className="cancel-btn" onClick={onCancel}>Cancel</button>
        ) : (
          <button className="send-btn" onClick={handleSend} disabled={!text.trim() && files.length === 0}>Send</button>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Create SessionList component**

```typescript
import React from 'react';

interface Session {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface SessionListProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions, activeSessionId, onSelect, onCreate, onRename, onDelete,
}) => {
  return (
    <div className="session-list">
      <button className="new-chat-btn" onClick={onCreate}>+ New Chat</button>
      <div className="session-items">
        {sessions.map(s => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="session-title">{s.title}</span>
            <span className="session-meta">{s.messageCount} messages</span>
            <div className="session-actions">
              <button onClick={e => { e.stopPropagation(); const t = prompt('New title:', s.title); if (t) onRename(s.id, t); }}>✎</button>
              <button onClick={e => { e.stopPropagation(); if (confirm('Delete this session?')) onDelete(s.id); }}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Create ChatView component**

```typescript
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SessionList } from './SessionList.js';
import { ChatInput } from './ChatInput.js';

const API = () => (window as any).knowledgeBase;

interface Message {
  id: number | string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: any[];
  webResults?: any[];
  tokensUsed?: { prompt: number; completion: number; total: number };
  model?: string;
  createdAt: string;
}

export const ChatView: React.FC = () => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const streamChunkUnsub = useRef<(() => void) | null>(null);
  const streamDoneUnsub = useRef<(() => void) | null>(null);

  const loadSessions = useCallback(async () => {
    const list = await API().sessions.list();
    setSessions(list);
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    const session = await API().sessions.get(sessionId);
    if (session) {
      setActiveSessionId(sessionId);
      // Load messages via getSession — includes messages in the response
      // For actual messages, we need a dedicated messages endpoint
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    // Load messages — we need to add this to SessionService
    // For now, rely on session service messages retrieval
    async function load() {
      const kb = API();
      if (kb.sessions?.getMessages) {
        const msgs = await kb.sessions.getMessages(activeSessionId);
        setMessages(msgs || []);
      }
    }
    load();
  }, [activeSessionId]);

  const handleSend = useCallback(async (text: string, tools: any) => {
    if (!activeSessionId) return;
    const requestId = crypto.randomUUID();

    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      sessionId: activeSessionId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingContent('');

    const unsubChunk = API().chat.onStreamChunk((data: any) => {
      if (data.requestId === requestId) {
        setStreamingContent(prev => prev + (data.content || ''));
      }
    });
    streamChunkUnsub.current = unsubChunk;

    const unsubDone = API().chat.onStreamDone((data: any) => {
      if (data.requestId === requestId) {
        setIsStreaming(false);
        const assistantMsg: Message = {
          id: `temp-${Date.now()}`,
          sessionId: activeSessionId,
          role: 'assistant',
          content: data.content || streamingContent,
          citations: data.citations,
          webResults: data.webResults,
          tokensUsed: data.tokensUsed,
          model: data.model,
          createdAt: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        setStreamingContent('');
        loadSessions();
      }
    });
    streamDoneUnsub.current = unsubDone;

    API().chat.sendStream({
      sessionId: activeSessionId,
      text,
      tools,
      requestId,
    });
  }, [activeSessionId, streamingContent, loadSessions]);

  const handleCancel = useCallback(() => {
    API().chat.cancel('current');
    setIsStreaming(false);
  }, []);

  const handleCreateSession = useCallback(async () => {
    const session = await API().sessions.create();
    setSessions(prev => [session, ...prev]);
    setActiveSessionId(session.id);
    setMessages([]);
  }, []);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    await API().sessions.update(id, { title });
    loadSessions();
  }, [loadSessions]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await API().sessions.delete(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }, [activeSessionId]);

  return (
    <div className="chat-view">
      <SessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSessionId}
        onCreate={handleCreateSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
      />
      <div className="chat-main">
        <div className="chat-messages">
          {!activeSessionId && (
            <div className="chat-empty">Select a session or create a new chat</div>
          )}
          {messages.map(m => (
            <div key={m.id} className={`chat-message ${m.role}`}>
              <div className="message-bubble">
                {m.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                ) : (
                  <div>{m.content}</div>
                )}
                {m.citations && m.citations.length > 0 && (
                  <div className="message-citations">
                    {m.citations.map((c, i) => (
                      <div key={i} className="citation-chip">📄 {c.documentTitle}</div>
                    ))}
                  </div>
                )}
                {m.webResults && m.webResults.length > 0 && (
                  <div className="message-web-results">
                    {m.webResults.map((r, i) => (
                      <a key={i} href={r.url} target="_blank" className="web-source-link">🔗 {r.title}</a>
                    ))}
                  </div>
                )}
                {m.tokensUsed && (
                  <div className="message-tokens">{m.tokensUsed.total} tokens</div>
                )}
              </div>
            </div>
          ))}
          {isStreaming && (
            <div className="chat-message assistant">
              <div className="message-bubble streaming">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                <span className="streaming-cursor">▊</span>
              </div>
            </div>
          )}
        </div>
        <ChatInput
          onSend={handleSend}
          isStreaming={isStreaming}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ChatInput.tsx src/renderer/components/SessionList.tsx src/renderer/components/ChatView.tsx
git commit -m "feat: add ChatInput, SessionList, ChatView UI components"
```

---

### Task 9: App.tsx restructure — two-view navigation

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add view navigation and conditional rendering**

In `src/renderer/App.tsx`, wrap the existing KB UI and new ChatView in a tabbed container:

```typescript
import React, { useState } from 'react';
import { ChatView } from './components/ChatView.js';

type View = 'chat' | 'knowledge-base';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('chat');

  return (
    <div className="app">
      <div className="app-header">
        <div className="app-nav">
          <button
            className={`nav-tab ${activeView === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveView('chat')}
          >
            Chat
          </button>
          <button
            className={`nav-tab ${activeView === 'knowledge-base' ? 'active' : ''}`}
            onClick={() => setActiveView('knowledge-base')}
          >
            Knowledge Base
          </button>
        </div>
        <div className="app-header-right">
          <SettingsButton />
          <ResetButton />
        </div>
      </div>

      {activeView === 'chat' ? (
        <ChatView />
      ) : (
        <div className="knowledge-base-view">
          {/* Existing KB UI: DocumentList, DocumentDetail, ImportPanel, etc. */}
          {/* Import from existing App.tsx content */}
        </div>
      )}

      <StatusBar />
    </div>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: 0 errors
Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: add two-view navigation (Chat | Knowledge Base)"
```

---

### Task 10: getMessages IPC for session messages

**Files:**
- Modify: `src/services/session-service.ts` (add getMessages IPC handler)
- Modify: `src/main/ipc-handlers.ts` (add handler)

- [ ] **Step 1: Add sessions:get-messages IPC channel**

In `src/shared/types.ts`:
```typescript
SESSIONS_GET_MESSAGES: 'sessions:get-messages',
```

In `src/main/ipc-handlers.ts`:
```typescript
ipcMain.handle(IPC_CHANNELS.SESSIONS_GET_MESSAGES, async (_event, sessionId: string) => {
  log.debug('IPC: sessions:get-messages', { sessionId });
  return sessionService.getMessages(sessionId);
});
```

In `src/preload/preload.ts`:
```typescript
getMessages: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSIONS_GET_MESSAGES, sessionId),
```

In `src/renderer/types.d.ts`:
```typescript
getMessages: (sessionId: string) => Promise<import('../shared/types.js').ChatMessageData[]>;
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts src/main/ipc-handlers.ts src/preload/preload.ts src/renderer/types.d.ts
git commit -m "feat: add sessions:get-messages IPC for loading chat history"
```

---

### Task 11: CSS styles for Chat View

**Files:**
- Modify: `src/renderer/index.html` (add style block)

- [ ] **Step 1: Add Chat View styles**

Add inside the existing `<style>` tag in `index.html`:

```css
/* Chat View */
.chat-view { display: flex; height: calc(100vh - 80px); }
.session-list { width: 240px; background: #111122; border-right: 1px solid #2a2a4e; display: flex; flex-direction: column; overflow-y: auto; }
.new-chat-btn { margin: 8px; padding: 8px; background: #533483; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.session-items { flex: 1; overflow-y: auto; }
.session-item { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #1a1a3e; }
.session-item:hover { background: #1a1a3e; }
.session-item.active { background: #2a2a4e; border-left: 3px solid #533483; }
.session-title { display: block; color: #e0e0f0; font-size: 13px; }
.session-meta { display: block; color: #8888aa; font-size: 11px; }
.session-actions { display: none; gap: 4px; margin-top: 4px; }
.session-item:hover .session-actions { display: flex; }
.session-actions button { background: none; border: none; color: #8888aa; cursor: pointer; padding: 2px 4px; }
.session-actions button:hover { color: #fff; }

.chat-main { flex: 1; display: flex; flex-direction: column; }
.chat-messages { flex: 1; overflow-y: auto; padding: 16px; }
.chat-empty { text-align: center; color: #6666aa; margin-top: 40px; font-size: 14px; }
.chat-message { margin-bottom: 16px; display: flex; }
.chat-message.user { justify-content: flex-end; }
.chat-message.assistant { justify-content: flex-start; }
.message-bubble { max-width: 70%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; }
.chat-message.user .message-bubble { background: #2a1a4e; color: #e0d0ff; border-bottom-right-radius: 4px; }
.chat-message.assistant .message-bubble { background: #1a1a2e; color: #d0d0f0; border-bottom-left-radius: 4px; }
.message-bubble.streaming { border: 1px solid #533483; }
.streaming-cursor { animation: blink 1s step-end infinite; color: #ffcc88; }
.message-citations { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
.citation-chip { background: #2a2a4e; color: #8888cc; padding: 3px 8px; border-radius: 4px; font-size: 11px; }
.message-web-results { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
.web-source-link { color: #88bbff; font-size: 12px; text-decoration: none; }
.web-source-link:hover { text-decoration: underline; }
.message-tokens { margin-top: 4px; color: #6666aa; font-size: 11px; }

.chat-input-container { border-top: 1px solid #2a2a4e; padding: 8px 16px; background: #0d0d1a; }
.chat-input-files { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.file-chip { background: #1a1a3e; color: #8888cc; padding: 3px 8px; border-radius: 4px; font-size: 12px; display: flex; align-items: center; gap: 4px; }
.file-chip button { background: none; border: none; color: #8888cc; cursor: pointer; }
.chat-input-tools { display: flex; gap: 6px; margin-bottom: 6px; }
.tool-toggle { background: #1a1a3e; color: #8888aa; border: 1px solid #2a2a4e; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.tool-toggle.active { background: #533483; color: #fff; border-color: #7550b0; }
.chat-input-row { display: flex; gap: 8px; align-items: flex-end; }
.chat-input-row textarea { flex: 1; background: #1a1a2e; color: #e0e0f0; border: 1px solid #2a2a4e; border-radius: 8px; padding: 8px 12px; font-size: 14px; resize: none; font-family: inherit; }
.chat-input-row textarea:disabled { opacity: 0.5; }
.send-btn, .cancel-btn { padding: 8px 16px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; white-space: nowrap; }
.send-btn { background: #533483; color: #fff; }
.send-btn:disabled { opacity: 0.4; cursor: default; }
.cancel-btn { background: #8b3030; color: #ffaaaa; }

/* App Nav */
.app-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; background: #0a0a1a; border-bottom: 1px solid #2a2a4e; }
.app-nav { display: flex; gap: 4px; }
.nav-tab { background: none; color: #8888aa; border: none; padding: 6px 16px; cursor: pointer; font-size: 14px; border-radius: 6px; }
.nav-tab.active { background: #1a1a3e; color: #e0e0f0; }
.nav-tab:hover { color: #e0e0f0; }
.app-header-right { display: flex; gap: 8px; align-items: center; }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: add chat view CSS styles and app navigation styles"
```

---

### Task 12: Verify end-to-end

- [ ] **Step 1: TypeScript check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Init check**

Run: `bash init.sh`
Expected: "Init complete. All checks passed."

- [ ] **Step 4: Run existing tests**

Run: `npm test`
Expected: All existing tests still PASS. New tests for sessions, chat, web search also PASS.

- [ ] **Step 5: Update session-handoff.md**

Append entry for the chat pivot implementation with modified/new files and feature status.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: complete chat pivot - sessions, chat, web search, file upload tools"
```
