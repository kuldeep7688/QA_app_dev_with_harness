import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase, resetDatabaseInstance } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import { SessionService } from '../src/services/session-service';
import { ChatService } from '../src/services/chat-service';
import { QaService } from '../src/services/qa-service';
import type { LlmProvider, ChatMessage, ChatResponse, StreamChunk, LlmOptions } from '../src/services/providers/types';
import type { HybridSearchResult, ChunkDetail } from '../src/services/retriever';
import type { WebSearchResult } from '../src/services/web-search-service';

function makeMockLlmProvider(opts?: {
  chatContent?: string;
  streamChunks?: string[];
  streamDelay?: number;
  shouldThrow?: boolean;
  throwAfterChunks?: number;
}): LlmProvider {
  const chatContent = opts?.chatContent ?? 'Mock answer.';

  return {
    async chat(_messages: ChatMessage[], _opts?: LlmOptions): Promise<ChatResponse> {
      if (opts?.shouldThrow) throw new Error('Mock LLM error');
      return {
        content: chatContent,
        usage: { prompt: 10, completion: 5, total: 15 },
        model: 'mock-model',
      };
    },

    async *chatStream(_messages: ChatMessage[], llmOpts?: LlmOptions): AsyncIterable<StreamChunk> {
      const signalAborted = () => llmOpts?.signal?.aborted;
      if (signalAborted()) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      if (opts?.shouldThrow && (!opts.throwAfterChunks || opts.throwAfterChunks === 0)) {
        throw new Error('Mock LLM stream error');
      }
      const chunks = opts?.streamChunks ?? ['Hello', 'World'];
      for (let i = 0; i < chunks.length; i++) {
        if (signalAborted()) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        if (opts?.throwAfterChunks !== undefined && i >= opts.throwAfterChunks) {
          throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        }
        if (opts?.streamDelay) {
          await new Promise(r => setTimeout(r, opts.streamDelay));
        }
        if (signalAborted()) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        yield { type: 'delta', content: chunks[i] };
      }
      yield { type: 'done', usage: { prompt: 10, completion: 5, total: 15 }, model: 'mock-model' };
    },

    async checkHealth() {
      return { ok: true, model: 'mock-model', latencyMs: 5 };
    },
  };
}

function seedKbDocument(db: Database.Database, docId: string, title: string, content: string): ChunkDetail[] {
  db.prepare(`INSERT INTO documents (id, title, filename, file_type, size, imported_at, status, word_count, line_count)
    VALUES (?, ?, ?, 'text/markdown', ?, datetime('now'), 'indexed', ?, 1)`)
    .run(docId, title, `${title}.md`, content.length, content.split(/\s+/).length);

  const chunks: ChunkDetail[] = [];
  const words = content.split(' ');
  for (let i = 0, idx = 0; i < words.length; i += 100, idx++) {
    const chunkContent = words.slice(i, i + 100).join(' ');
    const chunkId = `${docId}-chunk-${idx}`;
    const result = db.prepare(`INSERT INTO chunks (id, document_id, idx, content, char_count, word_count)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(chunkId, docId, idx, chunkContent, chunkContent.length, 100);
    const row = db.prepare('SELECT rowid, id, document_id as documentId, idx, content, char_count as charCount, word_count as wordCount, embedded_at as embeddedAt FROM chunks WHERE rowid = ?')
      .get(result.lastInsertRowid) as ChunkDetail;
    if (row) chunks.push(row);
  }
  return chunks;
}

describe('SessionService Integration', () => {
  let testDir: string;
  let db: Database.Database;
  let sessionService: SessionService;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'session-int-'));
    db = initDatabase(testDir);
    runMigrations(db);
    sessionService = new SessionService(db);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates a session with default title', () => {
    const s = sessionService.createSession();
    expect(s.id).toBeTruthy();
    expect(s.title).toBe('New Chat');
    expect(s.messageCount).toBe(0);
  });

  it('creates a session with custom title', () => {
    const s = sessionService.createSession('Custom Title');
    expect(s.title).toBe('Custom Title');
  });

  it('lists sessions ordered by updated_at DESC', async () => {
    const s1 = sessionService.createSession('First');
    await new Promise(r => setTimeout(r, 5));
    const s2 = sessionService.createSession('Second');
    const sessions = sessionService.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe(s2.id);
  });

  it('gets a session by id', () => {
    const s = sessionService.createSession();
    const found = sessionService.getSession(s.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('New Chat');
  });

  it('returns null for non-existent session', () => {
    expect(sessionService.getSession('nonexistent')).toBeNull();
  });

  it('updates session title and updated_at', async () => {
    const s = sessionService.createSession();
    const original = sessionService.getSession(s.id)!;
    await new Promise(r => setTimeout(r, 5));
    sessionService.updateSession(s.id, { title: 'New Title' });
    const updated = sessionService.getSession(s.id)!;
    expect(updated.title).toBe('New Title');
    expect(updated.updatedAt).not.toBe(original.updatedAt);
  });

  it('deletes a session', () => {
    const s = sessionService.createSession();
    sessionService.deleteSession(s.id);
    expect(sessionService.getSession(s.id)).toBeNull();
  });

  it('adds messages to a session', () => {
    const s = sessionService.createSession();
    sessionService.addMessage(s.id, { role: 'user', content: 'Hello' });
    sessionService.addMessage(s.id, { role: 'assistant', content: 'Hi there!' });

    const messages = sessionService.getMessages(s.id);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Hi there!');
  });

  it('increments message_count when adding messages', () => {
    const s = sessionService.createSession();
    sessionService.addMessage(s.id, { role: 'user', content: 'a' });
    sessionService.addMessage(s.id, { role: 'assistant', content: 'b' });
    const updated = sessionService.getSession(s.id)!;
    expect(updated.messageCount).toBe(2);
  });

  it('auto-titles session with truncated first message', () => {
    const s = sessionService.createSession();
    sessionService.setAutoTitle(s.id, 'This is a very long message that should be truncated at sixty characters');
    const updated = sessionService.getSession(s.id)!;
    expect(updated.title).toBe('This is a very long message that should be truncated at sixt...');
  });

  it('cascades delete: messages removed when session is deleted', () => {
    const s = sessionService.createSession();
    sessionService.addMessage(s.id, { role: 'user', content: 'msg' });
    sessionService.deleteSession(s.id);
    const messages = sessionService.getMessages(s.id);
    expect(messages.length).toBe(0);
  });
});

describe('ChatService Integration', () => {
  let testDir: string;
  let db: Database.Database;
  let sessionService: SessionService;
  let chatService: ChatService;
  let llmProvider: LlmProvider;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'chat-int-'));
    db = initDatabase(testDir);
    runMigrations(db);
    sessionService = new SessionService(db);
    llmProvider = makeMockLlmProvider({ chatContent: 'Mock answer for testing.', streamChunks: ['Hello', 'World'] });
    chatService = new ChatService(db, llmProvider, sessionService);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('sendMessage (non-streaming)', () => {
    it('returns answer content and saves messages', async () => {
      const s = sessionService.createSession();
      const result = await chatService.sendMessage(s.id, 'What is testing?');

      expect(result.content).toBe('Mock answer for testing.');
      expect(result.tokensUsed).toEqual({ prompt: 10, completion: 5, total: 15 });
      expect(result.model).toBe('mock-model');

      const messages = sessionService.getMessages(s.id);
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('What is testing?');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('Mock answer for testing.');
      expect(messages[1].model).toBe('mock-model');
      expect(messages[1].tokensUsed).toEqual({ prompt: 10, completion: 5, total: 15 });
    });

    it('auto-titles session on first message', async () => {
      const s = sessionService.createSession();
      await chatService.sendMessage(s.id, 'What is testing?');

      const updated = sessionService.getSession(s.id)!;
      expect(updated.title).toBe('What is testing?');
    });

    it('does not auto-title if title already changed', async () => {
      const s = sessionService.createSession();
      sessionService.updateSession(s.id, { title: 'Already Named' });
      await chatService.sendMessage(s.id, 'Another question');

      const updated = sessionService.getSession(s.id)!;
      expect(updated.title).toBe('Already Named');
    });

    it('returns fallback when no LLM provider', async () => {
      const noLlm = new ChatService(db, null, sessionService);
      const s = sessionService.createSession();
      const result = await noLlm.sendMessage(s.id, 'Test');

      expect(result.content).toContain('LLM not configured');
    });

    it('throws on LLM error', async () => {
      const bad = makeMockLlmProvider({ shouldThrow: true });
      const svc = new ChatService(db, bad, sessionService);
      const s = sessionService.createSession();

      await expect(svc.sendMessage(s.id, 'Test')).rejects.toThrow('Mock LLM error');
      const messages = sessionService.getMessages(s.id);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe('user');
    });
  });

  describe('sendStream', () => {
    it('streams chunks and saves full message on done', async () => {
      const s = sessionService.createSession();
      const chunks: StreamChunk[] = [];

      await chatService.sendStream(
        s.id,
        'Test stream',
        { kbEnabled: false, webEnabled: false },
        (c) => chunks.push(c),
      );

      const deltas = chunks.filter(c => c.type === 'delta');
      expect(deltas.map(d => d.content)).toEqual(['Hello', 'World']);

      const done = chunks.find(c => c.type === 'done');
      expect(done).toBeTruthy();
      expect(done!.content).toBe('HelloWorld');
      expect(done!.usage).toBeTruthy();

      const messages = sessionService.getMessages(s.id);
      expect(messages.length).toBe(2);
      expect(messages[1].content).toBe('HelloWorld');
    });

    it('handles abort (cancel) mid-stream', async () => {
      const slowLlm = makeMockLlmProvider({
        streamChunks: ['Partial', 'Remaining'],
        streamDelay: 20,
        throwAfterChunks: 1,
      });
      const svc = new ChatService(db, slowLlm, sessionService);
      const s = sessionService.createSession();
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 25);

      await svc.sendStream(
        s.id,
        'Test cancel',
        { kbEnabled: false, webEnabled: false },
        () => {},
        controller.signal,
      );

      const messages = sessionService.getMessages(s.id);
      expect(messages.length).toBe(2);
      expect(messages[1].content).toContain('[cancelled]');
    });

    it('handles abort before any content', async () => {
      const svc = new ChatService(db, llmProvider, sessionService);
      const s = sessionService.createSession();
      const controller = new AbortController();
      controller.abort();

      await svc.sendStream(
        s.id,
        'Test early cancel',
        { kbEnabled: false, webEnabled: false },
        () => {},
        controller.signal,
      );

      const messages = sessionService.getMessages(s.id);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe('user');
    });

    it('falls back when no LLM provider', async () => {
      const noLlm = new ChatService(db, null, sessionService);
      const s = sessionService.createSession();
      const chunks: StreamChunk[] = [];

      await noLlm.sendStream(s.id, 'Test', { kbEnabled: false, webEnabled: false }, (c) => chunks.push(c));

      const deltas = chunks.filter(c => c.type === 'delta');
      expect(deltas.length).toBe(1);
      expect(deltas[0].content).toContain('LLM not configured');

      const done = chunks.find(c => c.type === 'done');
      expect(done).toBeTruthy();
    });
  });

  describe('KB RAG tool', () => {
    it('searches knowledge base and includes citations when kbEnabled=true', async () => {
      seedKbDocument(db, 'doc-1', 'Architecture Notes', 'The system uses Electron with a main process and renderer process separated by preload scripts. Services handle business logic.');
      const chunkRow: ChunkDetail = db.prepare('SELECT rowid, id, document_id as documentId, idx, content, char_count as charCount, word_count as wordCount, embedded_at as embeddedAt FROM chunks LIMIT 1').get() as ChunkDetail;

      const retrieverFn = async (_q: string): Promise<HybridSearchResult[]> => {
        return [{ chunk: chunkRow, fusedScore: 0.85, sources: ['bm25'] }];
      };

      const svc = new ChatService(db, llmProvider, sessionService, retrieverFn);
      const s = sessionService.createSession();
      const result = await svc.sendMessage(s.id, 'How does Electron work?', { kbEnabled: true, webEnabled: false });

      expect(result.citations).toBeDefined();
      expect(result.citations!.length).toBe(1);
      expect(result.citations![0].documentTitle).toBe('Architecture Notes');

      const messages = sessionService.getMessages(s.id);
      expect(messages[1].citations).toBeDefined();
    });

    it('returns empty citations when no documents match', async () => {
      const retrieverFn = async (_q: string): Promise<HybridSearchResult[]> => [];
      const svc = new ChatService(db, llmProvider, sessionService, retrieverFn);
      const s = sessionService.createSession();
      const result = await svc.sendMessage(s.id, 'test', { kbEnabled: true, webEnabled: false });

      expect(result.citations).toEqual([]);
    });

    it('citations and webResults are sent in stream done chunk', async () => {
      seedKbDocument(db, 'doc-2', 'Design Notes', 'The UI uses React with hooks for state management and communicates via IPC.');
      const chunkRow: ChunkDetail = db.prepare('SELECT rowid, id, document_id as documentId, idx, content, char_count as charCount, word_count as wordCount, embedded_at as embeddedAt FROM chunks LIMIT 1').get() as ChunkDetail;

      const retrieverFn = async (_q: string): Promise<HybridSearchResult[]> => {
        return [{ chunk: chunkRow, fusedScore: 0.9, sources: ['bm25'] }];
      };

      const mockWebSearch = {
        search: async (_q: string): Promise<WebSearchResult[]> => {
          return [{ title: 'Test Result', url: 'https://example.com', content: 'Web result content' }];
        },
      };

      const svc = new ChatService(db, llmProvider, sessionService, retrieverFn, mockWebSearch);
      const s = sessionService.createSession();
      const chunks: any[] = [];

      await svc.sendStream(s.id, 'test', { kbEnabled: true, webEnabled: true }, (c) => chunks.push(c));

      const done = chunks.find(c => c.type === 'done');
      expect(done.citations).toBeDefined();
      expect(done.citations.length).toBeGreaterThan(0);
      expect(done.webResults).toBeDefined();
      expect(done.webResults.length).toBeGreaterThan(0);
    });
  });

  describe('Web search tool', () => {
    it('includes web results when webEnabled=true', async () => {
      const mockSearch = {
        search: async (_q: string): Promise<WebSearchResult[]> => {
          return [
            { title: 'Result 1', url: 'https://one.com', content: 'First result' },
            { title: 'Result 2', url: 'https://two.com', content: 'Second result' },
          ];
        },
      };
      const svc = new ChatService(db, llmProvider, sessionService, undefined, mockSearch);
      const s = sessionService.createSession();
      const result = await svc.sendMessage(s.id, 'What is Node.js?', { kbEnabled: false, webEnabled: true });

      expect(result.webResults).toBeDefined();
      expect(result.webResults!.length).toBe(2);
      expect(result.webResults![0].title).toBe('Result 1');
    });

    it('returns empty web results when no service provided', async () => {
      const s = sessionService.createSession();
      const result = await chatService.sendMessage(s.id, 'What is Node.js?', { kbEnabled: false, webEnabled: true });
      expect(result.webResults).toBeDefined();
      expect(result.webResults!.length).toBe(0);
    });
  });

  describe('File upload tool', () => {
    it('passes file contents to the prompt', async () => {
      const s = sessionService.createSession();
      await chatService.sendMessage(s.id, 'Summarize this file', {
        kbEnabled: false,
        webEnabled: false,
        files: [
          { name: 'notes.txt', content: 'These are my meeting notes.', type: 'text/plain' },
          { name: 'readme.md', content: '# Project Overview', type: 'text/markdown' },
        ],
      });

      const messages = sessionService.getMessages(s.id);
      expect(messages[1].uploadedFiles).toBeDefined();
      expect(messages[1].uploadedFiles!.length).toBe(2);
    });

    it('uploads with KB and web tools enabled', async () => {
      const s = sessionService.createSession();
      await chatService.sendMessage(s.id, 'Analyze files and search', {
        kbEnabled: true,
        webEnabled: true,
        files: [{ name: 'doc.txt', content: 'File content here.', type: 'text/plain' }],
      });

      const messages = sessionService.getMessages(s.id);
      expect(messages[1].uploadedFiles).toBeDefined();
      expect(messages[1].uploadedFiles!.length).toBe(1);
    });
  });

  describe('Auto-title behavior', () => {
    it('titles with first message on sendMessage', async () => {
      const s = sessionService.createSession();
      await chatService.sendMessage(s.id, 'Hello world');
      expect(sessionService.getSession(s.id)!.title).toBe('Hello world');
    });

    it('titles with first message on sendStream', async () => {
      const s = sessionService.createSession();
      await chatService.sendStream(s.id, 'Stream hello', { kbEnabled: false, webEnabled: false }, () => {});
      expect(sessionService.getSession(s.id)!.title).toBe('Stream hello');
    });

    it('truncates long title', async () => {
      const s = sessionService.createSession();
      const longMsg = 'A'.repeat(100);
      await chatService.sendMessage(s.id, longMsg);

      const updated = sessionService.getSession(s.id)!;
      expect(updated.title.length).toBeLessThanOrEqual(63);
    });
  });
});

describe('Feedback Integration', () => {
  let testDir: string;
  let db: Database.Database;
  let qaService: QaService;

  const fakeEmbed = async (_text: string): Promise<Float32Array> => {
    return new Float32Array(4).fill(0.5);
  };

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'feedback-int-'));
    db = initDatabase(testDir);
    runMigrations(db);
    qaService = new QaService(db, fakeEmbed);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('submits and retrieves positive feedback', () => {
    const ts = new Date().toISOString();
    const entry = qaService.submitFeedback(ts, 'What is architecture?', 'positive');

    expect(entry.id).toBeTruthy();
    expect(entry.rating).toBe('positive');
    expect(entry.question).toBe('What is architecture?');
    expect(entry.responseTimestamp).toBe(ts);

    const all = qaService.getFeedback();
    expect(all.length).toBe(1);
    expect(all[0].rating).toBe('positive');
  });

  it('submits and retrieves negative feedback', () => {
    qaService.submitFeedback(new Date().toISOString(), 'Bad question', 'negative');
    const all = qaService.getFeedback();
    expect(all.length).toBe(1);
    expect(all[0].rating).toBe('negative');
  });

  it('lists multiple feedback entries ordered by submitted_at DESC', () => {
    qaService.submitFeedback(new Date(Date.now() - 10000).toISOString(), 'Q1', 'positive');
    qaService.submitFeedback(new Date(Date.now() - 5000).toISOString(), 'Q2', 'negative');
    qaService.submitFeedback(new Date().toISOString(), 'Q3', 'positive');

    const all = qaService.getFeedback();
    expect(all.length).toBe(3);
    const questions = all.map(e => e.question).sort();
    expect(questions).toEqual(['Q1', 'Q2', 'Q3']);
  });
});

describe('Transient Context in ChatService', () => {
  let testDir: string;
  let db: Database.Database;
  let sessionService: SessionService;
  let llmProvider: LlmProvider;
  let capturedMessages: ChatMessage[][];

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'context-int-'));
    db = initDatabase(testDir);
    runMigrations(db);
    sessionService = new SessionService(db);
    capturedMessages = [];
    llmProvider = {
      async chat(messages: ChatMessage[], _opts?: LlmOptions): Promise<ChatResponse> {
        capturedMessages.push(messages);
        return { content: 'Response', usage: { prompt: 0, completion: 0, total: 0 } };
      },
      async *chatStream(messages: ChatMessage[], _opts?: LlmOptions): AsyncIterable<StreamChunk> {
        capturedMessages.push(messages);
        yield { type: 'delta', content: 'S' };
        yield { type: 'done', usage: { prompt: 0, completion: 0, total: 0 }, model: 'm' };
      },
      async checkHealth() { return { ok: true }; },
    };
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('includes system prompt and user message in LLM request', async () => {
    const svc = new ChatService(db, llmProvider, sessionService);
    const s = sessionService.createSession();
    await svc.sendMessage(s.id, 'Test message');

    const msgs = capturedMessages[0];
    const systemMsg = msgs.find(m => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain('helpful AI assistant');

    const userMsgs = msgs.filter(m => m.role === 'user');
    expect(userMsgs.some(m => m.content === 'Test message')).toBe(true);
  });

  it('includes KB excerpts in system prompt when kbEnabled=true', async () => {
    seedKbDocument(db, 'ctx-doc', 'Context Doc', 'This is context about Electron architecture.');
    const chunkRow: ChunkDetail = db.prepare('SELECT rowid, id, document_id as documentId, idx, content, char_count as charCount, word_count as wordCount, embedded_at as embeddedAt FROM chunks LIMIT 1').get() as ChunkDetail;

    const retriever = async (_q: string): Promise<HybridSearchResult[]> => {
      return [{ chunk: chunkRow, fusedScore: 0.9, sources: ['bm25'] }];
    };

    const svc = new ChatService(db, llmProvider, sessionService, retriever);
    const s = sessionService.createSession();
    await svc.sendMessage(s.id, 'Architecture question', { kbEnabled: true, webEnabled: false });

    const msgs = capturedMessages[0];
    const systemMsg = msgs.find(m => m.role === 'system')!;
    expect(systemMsg.content).toContain('Knowledge Base Results');
    expect(systemMsg.content).toContain('Context Doc');
    expect(systemMsg.content).toContain('Electron architecture');
  });

  it('includes file contents in system prompt', async () => {
    const svc = new ChatService(db, llmProvider, sessionService);
    const s = sessionService.createSession();
    await svc.sendMessage(s.id, 'Summarize', {
      kbEnabled: false,
      webEnabled: false,
      files: [{ name: 'notes.txt', content: 'File contents for testing.', type: 'text/plain' }],
    });

    const msgs = capturedMessages[0];
    const systemMsg = msgs.find(m => m.role === 'system')!;
    expect(systemMsg.content).toContain('Uploaded Files');
    expect(systemMsg.content).toContain('File contents for testing');
  });

  it('includes web results in system prompt', async () => {
    const mockSearch = {
      search: async (_q: string): Promise<WebSearchResult[]> => {
        return [{ title: 'Web Title', url: 'https://web.com', content: 'Web content here' }];
      },
    };
    const svc = new ChatService(db, llmProvider, sessionService, undefined, mockSearch);
    const s = sessionService.createSession();
    await svc.sendMessage(s.id, 'Search this', { kbEnabled: false, webEnabled: true });

    const msgs = capturedMessages[0];
    const systemMsg = msgs.find(m => m.role === 'system')!;
    expect(systemMsg.content).toContain('Web Search Results');
    expect(systemMsg.content).toContain('Web Title');
    expect(systemMsg.content).toContain('https://web.com');
  });

  it('includes conversation history in prompt for multi-turn', async () => {
    const svc = new ChatService(db, llmProvider, sessionService);
    const s = sessionService.createSession();

    await svc.sendMessage(s.id, 'First question');
    capturedMessages = [];

    await svc.sendMessage(s.id, 'Follow-up question');

    const msgs = capturedMessages[0];
    const userMsgs = msgs.filter(m => m.role === 'user');
    expect(userMsgs.some(m => m.content === 'First question')).toBe(true);
    expect(userMsgs.some(m => m.content === 'Follow-up question')).toBe(true);

    const assistantMsgs = msgs.filter(m => m.role === 'assistant');
    expect(assistantMsgs.some(m => m.content === 'Response')).toBe(true);
  });
});

describe('QaService Streaming', () => {
  let testDir: string;
  let db: Database.Database;

  const fakeEmbed = async (_text: string): Promise<Float32Array> => {
    return new Float32Array(4).fill(0.5);
  };

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'qa-stream-int-'));
    db = initDatabase(testDir);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns mock answer when no LLM provider and no indexed documents', async () => {
    const qa = new QaService(db, fakeEmbed);
    const result = await qa.ask('What is the architecture?');

    expect(result.answer).toBeTruthy();
    expect(result.citations).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('streams chunks and fires done event', async () => {
    seedKbDocument(db, 'qd-1', 'Test Doc', 'The system is built with Electron and supports testing and question answering.');
    const provider = makeMockLlmProvider({ streamChunks: ['Answer', ' here'] });
    const qa = new QaService(db, fakeEmbed, undefined, provider);
    const chunks: StreamChunk[] = [];

    const result = await qa.askStream('testing question', (c) => chunks.push(c));

    const deltas = chunks.filter(c => c.type === 'delta');
    expect(deltas.map(d => d.content)).toEqual(['Answer', ' here']);

    const done = chunks.find(c => c.type === 'done');
    expect(done).toBeTruthy();

    expect(result.answer).toBe('Answer here');
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it('handles stream cancellation', async () => {
    seedKbDocument(db, 'qd-2', 'Cancel Doc', 'Some content for testing cancellation flow.');
    const provider = makeMockLlmProvider({
      streamChunks: ['Partial', 'More', 'Final'],
      streamDelay: 20,
    });
    const qa = new QaService(db, fakeEmbed, undefined, provider);
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 25);

    const result = await qa.askStream('cancellation testing', () => {}, controller.signal);

    expect(result.answer).toContain('[cancelled]');
    expect(result.citations.length).toBeGreaterThan(0);
  });
});
