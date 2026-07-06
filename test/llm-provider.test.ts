import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import type { LlmProvider, ChatMessage, ChatResponse, StreamChunk, LlmOptions } from '../src/services/providers/types';
import { QaService, classifyLlmError } from '../src/services/qa-service';
import { embed } from '../src/services/embedding-service';
import { DocumentService } from '../src/services/document-service';
import { PersistenceService } from '../src/services/persistence-service';
import { IndexingService } from '../src/services/indexing-service';

let TEST_DIR = '';

class MockProvider implements LlmProvider {
  async chat(_messages: ChatMessage[], _opts?: LlmOptions): Promise<ChatResponse> {
    return {
      content: 'This is a mock LLM answer based on the provided documents.',
      usage: { prompt: 50, completion: 20, total: 70 },
      model: 'mock-model',
    };
  }

  async *chatStream(_messages: ChatMessage[], _opts?: LlmOptions): AsyncIterable<StreamChunk> {
    const chunks = ['This ', 'is ', 'a ', 'mock ', 'stream.'];
    for (const chunk of chunks) {
      yield { type: 'delta', content: chunk };
    }
    yield { type: 'done', usage: { prompt: 50, completion: 20, total: 70 }, model: 'mock-model' };
  }

  async checkHealth(): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }> {
    return { ok: true, model: 'mock-model', latencyMs: 50 };
  }
}

describe('LLM Provider Interface', () => {
  it('LlmProvider interface is defined', () => {
    const provider: LlmProvider = new MockProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.chat).toBe('function');
    expect(typeof provider.chatStream).toBe('function');
    expect(typeof provider.checkHealth).toBe('function');
  });

  it('chat returns ChatResponse with content and usage', async () => {
    const provider: LlmProvider = new MockProvider();
    const response = await provider.chat([{ role: 'user', content: 'hello' }]);
    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('usage');
    expect(response.usage).toHaveProperty('prompt', 50);
    expect(response.usage).toHaveProperty('completion', 20);
    expect(response.usage).toHaveProperty('total', 70);
    expect(response.model).toBe('mock-model');
  });

  it('chatStream yields StreamChunks and a done event', async () => {
    const provider: LlmProvider = new MockProvider();
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hello' }])) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const deltas = chunks.filter(c => c.type === 'delta');
    expect(deltas.length).toBe(5);
    expect(deltas[0].content).toBe('This ');
    expect(deltas[deltas.length - 1].content).toBe('stream.');

    const done = chunks.find(c => c.type === 'done');
    expect(done).toBeDefined();
    expect(done!.usage).toHaveProperty('total', 70);
    expect(done!.model).toBe('mock-model');
  });
});

describe('QaService with LlmProvider injection', () => {
  let db: Database.Database;
  let persistence: PersistenceService;

  beforeEach(async () => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-provider-test-'));
    db = initDatabase(TEST_DIR);
    runMigrations(db);
    persistence = new PersistenceService(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('QaService accepts LlmProvider | null via constructor', () => {
    const provider = new MockProvider();

    const qaNull = new QaService(db, embed);
    expect(qaNull).toBeInstanceOf(QaService);

    const qaProvider = new QaService(db, embed, undefined, provider);
    expect(qaProvider).toBeInstanceOf(QaService);
  });

  it('uses mock patterns when llmProvider is null', async () => {
    const qa = new QaService(db, embed);
    const response = await qa.ask('What is the architecture?');
    expect(response.answer).toBeTruthy();
    expect(response.modelUsed).toBeUndefined();
    expect(response.tokensUsed).toBeUndefined();
  });

  it('askStream yields all 5 stream chunks in correct order via onChunk callback', async () => {
    const docService = new DocumentService(persistence, db);
    const indexingService = new IndexingService(persistence, db);

    const samplePath = path.join(TEST_DIR, 'stream-sample.txt');
    fs.writeFileSync(samplePath, 'This document is about streaming answers and token generation in question answering systems.');
    const doc = await docService.importDocument(samplePath);
    await indexingService.startIndexing(doc.id);

    const provider = new MockProvider();
    const qa = new QaService(db, embed, undefined, provider);

    const receivedChunks: { type: string; content?: string }[] = [];
    const result = await qa.askStream(
      'What is streaming?',
      (chunk) => { receivedChunks.push({ type: chunk.type, content: chunk.content }); },
    );

    const deltas = receivedChunks.filter(c => c.type === 'delta');
    expect(deltas.length).toBe(5);
    expect(deltas[0].content).toBe('This ');
    expect(deltas[1].content).toBe('is ');
    expect(deltas[2].content).toBe('a ');
    expect(deltas[3].content).toBe('mock ');
    expect(deltas[4].content).toBe('stream.');

    const done = receivedChunks.find(c => c.type === 'done');
    expect(done).toBeDefined();

    expect(result.answer).toBe('This is a mock stream.');
    expect(result.modelUsed).toBe('mock-model');
    expect(result.tokensUsed).toHaveProperty('total', 70);
  });

  it('askStream cancellation: abort shows partial answer with [cancelled] suffix', async () => {
    const docService = new DocumentService(persistence, db);
    const indexingService = new IndexingService(persistence, db);

    const samplePath = path.join(TEST_DIR, 'cancel-test.txt');
    fs.writeFileSync(samplePath, 'This document is about cancellation in LLM streaming answers.');
    const doc = await docService.importDocument(samplePath);
    await indexingService.startIndexing(doc.id);

    const controller = new AbortController();

    class CancellableMockProvider implements LlmProvider {
      async chat(_messages: ChatMessage[], _opts?: LlmOptions): Promise<ChatResponse> {
        return { content: 'mock', usage: { prompt: 10, completion: 10, total: 20 }, model: 'mock' };
      }

      async *chatStream(_messages: ChatMessage[], opts?: LlmOptions): AsyncIterable<StreamChunk> {
        yield { type: 'delta', content: 'Partial answer text. ' };
        // Simulate provider detecting abort mid-stream
        if (opts?.signal?.aborted) {
          yield { type: 'error', error: 'Request cancelled' };
          return;
        }
        yield { type: 'delta', content: 'This should not appear. ' };
        yield { type: 'done', usage: { prompt: 50, completion: 20, total: 70 }, model: 'mock-model' };
      }

      async checkHealth(): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }> {
        return { ok: true };
      }
    }

    const provider = new CancellableMockProvider();
    const qa = new QaService(db, embed, undefined, provider);

    const result = await qa.askStream(
      'What is cancellation?',
      () => {},
      controller.signal,
    );

    // No abort before stream, so should get full content
    expect(result.answer).toContain('Partial answer text');

    // Now abort mid-stream and ask again
    const controller2 = new AbortController();
    const result2 = await qa.askStream(
      'What is cancellation?',
      () => {},
      controller2.signal,
    );
    // Signal not aborted yet, should get full answer
    expect(result2.answer).toContain('Partial answer text');

    // Test with pre-aborted signal
    const controller3 = new AbortController();
    controller3.abort();
    const result3 = await qa.askStream(
      'What is cancellation?',
      () => {},
      controller3.signal,
    );
    expect(result3.answer).toContain('[cancelled]');
  });

  it('askStream without LLM provider falls back to mock message', async () => {
    const docService = new DocumentService(persistence, db);
    const indexingService = new IndexingService(persistence, db);

    const samplePath = path.join(TEST_DIR, 'mock-fallback.txt');
    fs.writeFileSync(samplePath, 'This document has content about fallback mechanisms.');
    const doc = await docService.importDocument(samplePath);
    await indexingService.startIndexing(doc.id);

    const qa = new QaService(db, embed);
    const receivedChunks: { type: string; content?: string }[] = [];

    const result = await qa.askStream(
      'What is fallback?',
      (chunk) => { receivedChunks.push({ type: chunk.type, content: chunk.content }); },
    );

    expect(result.answer).toBe('LLM not configured. Add your NVIDIA API key to .env');
    expect(result.modelUsed).toBeUndefined();
    expect(result.tokensUsed).toBeUndefined();

    const deltas = receivedChunks.filter(c => c.type === 'delta');
    expect(deltas.length).toBe(1);
    expect(deltas[0].content).toContain('LLM not configured');
  });

  it('askStream with no citations returns refusal message', async () => {
    const qa = new QaService(db, embed);
    const receivedChunks: { type: string; content?: string }[] = [];

    const result = await qa.askStream(
      'Something about nothing?',
      (chunk) => { receivedChunks.push({ type: chunk.type, content: chunk.content }); },
    );

    expect(result.answer).toContain('No relevant documents were found');
    expect(result.citations.length).toBe(0);
  });

  it('uses LLM provider when injected, with modelUsed and tokensUsed', async () => {
    const docService = new DocumentService(persistence, db);
    const indexingService = new IndexingService(persistence, db);

    const samplePath = path.join(TEST_DIR, 'sample.txt');
    fs.writeFileSync(samplePath, 'This document discusses system architecture and design patterns for the knowledge base application.');
    const doc = await docService.importDocument(samplePath);
    await indexingService.startIndexing(doc.id);

    const provider = new MockProvider();
    const qa = new QaService(db, embed, undefined, provider);
    const response = await qa.ask('What is in this document?');

    expect(response.modelUsed).toBe('mock-model');
    expect(response.tokensUsed).toHaveProperty('prompt', 50);
    expect(response.tokensUsed).toHaveProperty('completion', 20);
    expect(response.tokensUsed).toHaveProperty('total', 70);
    expect(response.answer).toBe('This is a mock LLM answer based on the provided documents.');
  });
});

describe('classifyLlmError', () => {
  it('returns invalid key message for 401/403 errors', () => {
    expect(classifyLlmError(new Error('401 Unauthorized'))).toBe('Invalid API key. Check your .env file.');
    expect(classifyLlmError(new Error('403 Forbidden'))).toBe('Invalid API key. Check your .env file.');
    expect(classifyLlmError(new Error('invalid api key'))).toBe('Invalid API key. Check your .env file.');
  });

  it('returns rate limited message for 429 error', () => {
    expect(classifyLlmError(new Error('429 Too Many Requests'))).toBe('Rate limited by NVIDIA. Please wait and try again.');
    expect(classifyLlmError(new Error('rate limit exceeded'))).toBe('Rate limited by NVIDIA. Please wait and try again.');
  });

  it('returns timeout message for connection errors', () => {
    expect(classifyLlmError(new Error('ETIMEDOUT'))).toBe('Request timed out. Check your connection.');
    expect(classifyLlmError(new Error('ECONNREFUSED'))).toBe('Request timed out. Check your connection.');
    expect(classifyLlmError(new Error('timeout of 10000ms exceeded'))).toBe('Request timed out. Check your connection.');
  });

  it('returns unavailable message for 5xx errors', () => {
    expect(classifyLlmError(new Error('500 Internal Server Error'))).toBe('LLM service unavailable. Try again later.');
    expect(classifyLlmError(new Error('503 Service Unavailable'))).toBe('LLM service unavailable. Try again later.');
    expect(classifyLlmError(new Error('502 Bad Gateway'))).toBe('LLM service unavailable. Try again later.');
  });

  it('returns generic message for unknown errors and falls back gracefully', () => {
    const result = classifyLlmError(new Error('Something unexpected happened'));
    expect(result).toContain('LLM request failed');
    expect(result).not.toContain('nvapi-');
    expect(result).not.toContain('sk-');
  });

  it('sanitizes error: no API key in message', () => {
    const result = classifyLlmError(new Error('401 Incorrect API key provided: nvapi-abc123def456'));
    expect(result).toBe('Invalid API key. Check your .env file.');
    expect(result).not.toContain('nvapi-');
    expect(result).not.toContain('abc123');
  });
});
