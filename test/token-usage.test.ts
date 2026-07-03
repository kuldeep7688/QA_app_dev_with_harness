import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase, resetDatabaseInstance } from '../src/services/db';
import { runMigrations } from '../src/services/migrations/runner';
import type { LlmProvider, ChatMessage, ChatResponse, StreamChunk, LlmOptions } from '../src/services/providers/types';
import { QaService } from '../src/services/qa-service';
import { embed } from '../src/services/embedding-service';
import { DocumentService } from '../src/services/document-service';
import { PersistenceService } from '../src/services/persistence-service';
import { IndexingService } from '../src/services/indexing-service';

class FixedUsageProvider implements LlmProvider {
  private usage: { prompt: number; completion: number; total: number };

  constructor(usage: { prompt: number; completion: number; total: number }) {
    this.usage = usage;
  }

  async chat(_messages: ChatMessage[], _opts?: LlmOptions): Promise<ChatResponse> {
    return {
      content: 'Mock answer based on provided documents.',
      usage: this.usage,
      model: 'mock-model',
    };
  }

  async *chatStream(_messages: ChatMessage[], _opts?: LlmOptions): AsyncIterable<StreamChunk> {
    yield { type: 'delta', content: 'Mock stream answer.' };
    yield { type: 'done', usage: this.usage, model: 'mock-model' };
  }

  async checkHealth(): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }> {
    return { ok: true, model: 'mock-model', latencyMs: 50 };
  }
}

describe('Token Usage Tracking', () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-test-'));
    db = initDatabase(testDir);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseInstance();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should store token usage in qa_history and reconstruct on retrieval', async () => {
    const docService = new DocumentService(new PersistenceService(testDir), db);
    const indexingService = new IndexingService(new PersistenceService(testDir), db);

    const samplePath = path.join(testDir, 'test.txt');
    fs.writeFileSync(samplePath, 'The system architecture uses layered design patterns for clear separation of concerns.');
    const doc = await docService.importDocument(samplePath);
    await indexingService.startIndexing(doc.id);

    const provider = new FixedUsageProvider({ prompt: 150, completion: 42, total: 192 });
    const qa = new QaService(db, embed, undefined, provider);

    const response = await qa.ask('What is the architecture?');

    expect(response.tokensUsed).toEqual({ prompt: 150, completion: 42, total: 192 });
    expect(response.modelUsed).toBe('mock-model');

    const history = qa.getHistory();
    expect(history.length).toBe(1);
    expect(history[0].question).toBe('What is the architecture?');
    expect(history[0].response.tokensUsed).toEqual({ prompt: 150, completion: 42, total: 192 });
    expect(history[0].response.modelUsed).toBe('mock-model');
  });

  it('should round-trip token usage through askStream and history', async () => {
    const docService = new DocumentService(new PersistenceService(testDir), db);
    const indexingService = new IndexingService(new PersistenceService(testDir), db);

    const samplePath = path.join(testDir, 'stream-test.txt');
    fs.writeFileSync(samplePath, 'Streaming delivers tokens one by one for real-time display.');
    const doc = await docService.importDocument(samplePath);
    await indexingService.startIndexing(doc.id);

    const provider = new FixedUsageProvider({ prompt: 60, completion: 18, total: 78 });
    const qa = new QaService(db, embed, undefined, provider);

    const result = await qa.askStream('How does streaming work?', () => {});

    expect(result.tokensUsed).toEqual({ prompt: 60, completion: 18, total: 78 });
    expect(result.modelUsed).toBe('mock-model');

    const history = qa.getHistory();
    expect(history.length).toBe(1);
    expect(history[0].response.tokensUsed).toEqual({ prompt: 60, completion: 18, total: 78 });
    expect(history[0].response.modelUsed).toBe('mock-model');
  });

  it('should preserve different token counts across multiple entries', async () => {
    const docService = new DocumentService(new PersistenceService(testDir), db);
    const indexingService = new IndexingService(new PersistenceService(testDir), db);

    const samplePath = path.join(testDir, 'multi-test.txt');
    fs.writeFileSync(samplePath, 'Multiple questions with varying token usage across the session.');
    const doc = await docService.importDocument(samplePath);
    await indexingService.startIndexing(doc.id);

    // Ask question 1 with 100 tokens
    const qa1 = new QaService(db, embed, undefined, new FixedUsageProvider({ prompt: 60, completion: 40, total: 100 }));
    await qa1.ask('First question?');
    const history1 = qa1.getHistory();
    expect(history1[0].response.tokensUsed?.total).toBe(100);

    // Ask question 2 with 250 tokens
    const qa2 = new QaService(db, embed, undefined, new FixedUsageProvider({ prompt: 150, completion: 100, total: 250 }));
    await qa2.ask('Second question?');
    const history2 = qa2.getHistory();
    expect(history2.length).toBe(2);

    // Both should have correct individual token counts
    const firstResponse = history2.find(h => h.question === 'First question?')!;
    expect(firstResponse.response.tokensUsed?.total).toBe(100);

    const secondResponse = history2.find(h => h.question === 'Second question?')!;
    expect(secondResponse.response.tokensUsed?.total).toBe(250);
  });

  it('should handle entries without token usage gracefully', async () => {
    const qa = new QaService(db, embed);

    // Seed a history entry without token usage (no LLM provider)
    const samplePath = path.join(testDir, 'no-token-test.txt');
    fs.writeFileSync(samplePath, 'A document about testing scenarios without LLM configuration.');
    const docService = new DocumentService(new PersistenceService(testDir), db);
    const indexingService = new IndexingService(new PersistenceService(testDir), db);
    const doc = await docService.importDocument(samplePath);
    await indexingService.startIndexing(doc.id);

    const response = await qa.ask('No LLM?');
    expect(response.tokensUsed).toBeUndefined();
    expect(response.modelUsed).toBeUndefined();

    const history = qa.getHistory();
    expect(history[0].response.tokensUsed).toBeUndefined();
    expect(history[0].response.modelUsed).toBeUndefined();
  });
});
