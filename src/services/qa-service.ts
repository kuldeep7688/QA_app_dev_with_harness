import type Database from 'better-sqlite3';
import { QAResponse, QAHistory, Citation, FeedbackEntry, RetrievalSettings } from '../shared/types';
import { logger } from './logger';
import { hybridSearch, debugSearch, DebugSearchResult } from './retriever';
import { isVectorExtensionLoaded } from './db';
import type { LlmProvider, ChatMessage, StreamChunk } from './providers/types';

const log = logger.forService('QaService');

const DEFAULT_SYSTEM_PROMPT = `Answer the question using ONLY the provided document excerpts below. Follow these rules:
1. Cite the source document title and chunk index after each claim.
2. If the provided documents do not contain enough information, say so clearly — do not make up information.
3. Be concise but thorough. Use markdown formatting for readability when appropriate.`;

export class QaService {
  private db: Database.Database;
  private embedFn: (text: string) => Promise<Float32Array>;
  private getSettings: () => RetrievalSettings;
  private llmProvider: LlmProvider | null;

  constructor(
    db: Database.Database,
    embedFn: (text: string) => Promise<Float32Array>,
    getSettings?: () => RetrievalSettings,
    llmProvider?: LlmProvider | null,
  ) {
    this.db = db;
    this.embedFn = embedFn;
    this.getSettings = getSettings ?? (() => ({
      retrievalMode: isVectorExtensionLoaded() ? 'hybrid' : 'bm25',
      topK: 5,
      topN: 20,
      rrfK: 60,
      embeddingsEnabled: true,
    }));
    this.llmProvider = llmProvider ?? null;
  }

  async ask(question: string): Promise<QAResponse> {
    log.info('Processing question', { question: question.substring(0, 100) });

    const settings = this.getSettings();

    const results = await hybridSearch(this.db, question, this.embedFn, {
      mode: isVectorExtensionLoaded() ? settings.retrievalMode : 'bm25',
      topK: settings.topK,
      topN: settings.topN,
      rrfK: settings.rrfK,
    });

    const docs = this.db.prepare('SELECT id, title FROM documents').all() as Array<{ id: string; title: string }>;

    const citations: Citation[] = results.map(r => {
      const doc = docs.find(d => d.id === r.chunk.documentId);
      return {
        documentId: r.chunk.documentId,
        documentTitle: doc?.title ?? 'Unknown Document',
        chunkIndex: r.chunk.idx,
        excerpt: r.chunk.content.substring(0, 200),
        confidence: parseFloat(Math.min(1, r.fusedScore * 30 + (r.sources.length > 1 ? 0.15 : 0)).toFixed(2)),
        bm25Rank: r.bm25Rank,
        vectorRank: r.vectorRank,
        sources: r.sources,
      };
    });

    const confidence = this.computeConfidence(results);

    log.info('Hybrid retrieval for question', {
      resultCount: results.length,
      citationCount: citations.length,
      confidence,
      topSource: results[0]?.sources ?? [],
      topFusedScore: results[0]?.fusedScore ?? 0,
    });

    let answer: string;
    let modelUsed: string | undefined;
    let tokensUsed: { prompt: number; completion: number; total: number } | undefined;

    if (this.llmProvider && citations.length > 0) {
      const messages = this.buildPrompt(question, citations);
      try {
        const chatResponse = await this.llmProvider.chat(messages, {
          temperature: 0.3,
          maxTokens: 1024,
        });
        answer = chatResponse.content;
        modelUsed = chatResponse.model;
        tokensUsed = chatResponse.usage;
      } catch (error: unknown) {
        log.error('LLM answer generation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        answer = this.generateMockAnswer(question, citations);
      }
    } else if (this.llmProvider && citations.length === 0) {
      answer = 'No relevant documents were found to answer your question. Please import and index documents containing relevant information.';
    } else {
      answer = this.generateMockAnswer(question, citations);
    }

    const response: QAResponse = {
      answer,
      citations,
      confidence,
      timestamp: new Date().toISOString(),
      modelUsed,
      tokensUsed,
    };

    log.info('Question answered', {
      citationCount: citations.length,
      confidence,
      answerLength: answer.length,
      modelUsed,
      tokensUsed: tokensUsed ? `${tokensUsed.prompt}p / ${tokensUsed.completion}c / ${tokensUsed.total}t` : undefined,
    });

    this.saveToHistory(question, response);

    return response;
  }

  async retrieveDebug(question: string, opts?: { mode?: 'hybrid' | 'bm25' | 'vector' }): Promise<DebugSearchResult> {
    log.debug('Retrieval debug requested', { question: question.substring(0, 100), mode: opts?.mode });

    const settings = this.getSettings();
    const mode = opts?.mode ?? (isVectorExtensionLoaded() ? settings.retrievalMode : 'bm25');

    const results = await debugSearch(this.db, question, this.embedFn, {
      mode,
      topK: settings.topK,
      topN: settings.topN,
      rrfK: settings.rrfK,
    });

    log.debug('Retrieval debug completed', {
      bm25Count: results.bm25Results.length,
      vectorCount: results.vectorResults.length,
      fusedCount: results.fusedResults.length,
    });

    return results;
  }

  private buildPrompt(question: string, citations: Citation[]): ChatMessage[] {
    const excerptBlocks = citations.map((c, i) =>
      `[Source ${i + 1}] ${c.documentTitle} (chunk ${c.chunkIndex}):\n${c.excerpt}`
    );

    const systemContent = `${DEFAULT_SYSTEM_PROMPT}\n\nBelow are the relevant document excerpts to use for answering:\n\n${excerptBlocks.join('\n\n')}`;

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: question },
    ];
  }

  private computeConfidence(results: Array<{ fusedScore: number; sources: Array<'bm25' | 'vector'> }>): number {
    if (results.length === 0) return 0;

    const topScore = results[0].fusedScore;
    const gapToSecond = results.length > 1 ? topScore - results[1].fusedScore : topScore;
    const hasBothSources = results[0].sources.length > 1;

    let c = topScore * 30;
    if (hasBothSources) c += 0.15;
    if (gapToSecond > 0.005) c += 0.1;
    if (results.length > 1 && results[0].sources.length > 1 && results[1].sources.length > 1) c += 0.05;

    return parseFloat(Math.min(1, c).toFixed(2));
  }

  getHistory(): QAHistory[] {
    const rows = this.db.prepare('SELECT * FROM qa_history ORDER BY ts DESC').all() as any[];

    const history: QAHistory[] = rows.map(row => ({
      question: row.question,
      response: {
        answer: row.answer,
        citations: JSON.parse(row.citations_json),
        confidence: row.confidence,
        timestamp: row.ts,
      },
    }));

    log.debug('Retrieved Q&A history', { entryCount: history.length });
    return history;
  }

  clearHistory(): void {
    this.db.prepare('DELETE FROM qa_history').run();
    log.info('Q&A history cleared');
  }

  private generateMockAnswer(question: string, citations: Citation[]): string {
    const questionLower = question.toLowerCase();
    const MOCK_PATTERNS: Array<{ keywords: string[]; answer: string }> = [
      {
        keywords: ['design', 'architecture', 'pattern'],
        answer: 'The system uses a layered architecture with clear boundaries between the main process, preload scripts, and renderer. Each layer communicates through typed IPC channels, and the services layer handles business logic independently of the UI.',
      },
      {
        keywords: ['import', 'document', 'file'],
        answer: 'Documents are imported by copying the source file to the local data directory. The system extracts text content and creates metadata including title, filename, size, and import timestamp. After import, documents can be indexed for search.',
      },
      {
        keywords: ['index', 'chunk', 'search'],
        answer: 'The indexing pipeline splits documents into chunks of approximately 500 characters at paragraph boundaries. Each chunk includes metadata like character count and word count. The index enables grounded Q&A with citations pointing to specific document sections.',
      },
      {
        keywords: ['retrieval', 'search', 'query'],
        answer: 'Retrieval works by matching query keywords against indexed chunks. The system ranks chunks by keyword overlap and returns the most relevant excerpts as citations alongside the generated answer.',
      },
      {
        keywords: ['meeting', 'notes', 'summary'],
        answer: 'The meeting summary indicates that the team discussed implementing a retrieval-augmented generation pipeline. Key decisions included using local chunk storage and citation-based verification to ensure answer accuracy.',
      },
    ];

    for (const pattern of MOCK_PATTERNS) {
      if (pattern.keywords.some(kw => questionLower.includes(kw))) {
        if (citations.length > 0) {
          return `${pattern.answer} Based on the document "${citations[0].documentTitle}", ${citations[0].excerpt.substring(0, 100)}.`;
        }
        return pattern.answer;
      }
    }

    if (citations.length > 0) {
      return `Based on the available documents, the most relevant information comes from "${citations[0].documentTitle}": ${citations[0].excerpt.substring(0, 150)}. However, a more specific answer would require additional context.`;
    }

    return 'No relevant documents have been indexed yet. Please import and index documents before asking questions.';
  }

  submitFeedback(responseTimestamp: string, question: string, rating: 'positive' | 'negative'): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: crypto.randomUUID(),
      responseTimestamp,
      question,
      rating,
      submittedAt: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO feedback (id, response_ts, question, rating, comment, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.responseTimestamp, entry.question, entry.rating, null, entry.submittedAt);

    log.info('Feedback submitted', {
      feedbackId: entry.id,
      rating,
      question: question.substring(0, 100),
    });

    return entry;
  }

  getFeedback(): FeedbackEntry[] {
    const rows = this.db.prepare('SELECT * FROM feedback ORDER BY submitted_at DESC').all() as any[];

    const feedback: FeedbackEntry[] = rows.map(row => ({
      id: row.id,
      responseTimestamp: row.response_ts,
      question: row.question,
      rating: row.rating as 'positive' | 'negative',
      submittedAt: row.submitted_at,
    }));

    log.debug('Retrieved feedback entries', { entryCount: feedback.length });
    return feedback;
  }

  async askStream(
    question: string,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<QAResponse> {
    log.info('Processing streaming question', { question: question.substring(0, 100) });

    const settings = this.getSettings();
    const results = await hybridSearch(this.db, question, this.embedFn, {
      mode: isVectorExtensionLoaded() ? settings.retrievalMode : 'bm25',
      topK: settings.topK,
      topN: settings.topN,
      rrfK: settings.rrfK,
    });

    const docs = this.db.prepare('SELECT id, title FROM documents').all() as Array<{ id: string; title: string }>;

    const citations: Citation[] = results.map(r => {
      const doc = docs.find(d => d.id === r.chunk.documentId);
      return {
        documentId: r.chunk.documentId,
        documentTitle: doc?.title ?? 'Unknown Document',
        chunkIndex: r.chunk.idx,
        excerpt: r.chunk.content.substring(0, 200),
        confidence: parseFloat(Math.min(1, r.fusedScore * 30 + (r.sources.length > 1 ? 0.15 : 0)).toFixed(2)),
        bm25Rank: r.bm25Rank,
        vectorRank: r.vectorRank,
        sources: r.sources,
      };
    });

    const confidence = this.computeConfidence(results);
    const timestamp = new Date().toISOString();

    log.info('Hybrid retrieval for streaming question', {
      resultCount: results.length,
      citationCount: citations.length,
      confidence,
    });

    if (citations.length === 0) {
      const answer = 'No relevant documents were found to answer your question. Please import and index documents containing relevant information.';
      onChunk({ type: 'delta', content: answer });
      const response: QAResponse = { answer, citations, confidence, timestamp };
      this.saveToHistory(question, response);
      return response;
    }

    if (!this.llmProvider) {
      const answer = 'LLM not configured. Add your NVIDIA API key to .env';
      onChunk({ type: 'delta', content: answer });
      const response: QAResponse = { answer, citations, confidence, timestamp };
      this.saveToHistory(question, response);
      return response;
    }

    const messages = this.buildPrompt(question, citations);
    let fullContent = '';
    let modelUsed: string | undefined;
    let tokensUsed: { prompt: number; completion: number; total: number } | undefined;

    try {
      for await (const chunk of this.llmProvider.chatStream(messages, { temperature: 0.3, maxTokens: 1024, signal })) {
        if (chunk.type === 'delta') {
          fullContent += chunk.content;
          onChunk(chunk);
        } else if (chunk.type === 'done') {
          modelUsed = chunk.model;
          tokensUsed = chunk.usage;
        } else if (chunk.type === 'error') {
          if (chunk.error === 'Request cancelled' || signal?.aborted) {
            const answer = fullContent ? `${fullContent}\n\n*[cancelled]*` : '*[cancelled]*';
            onChunk({ type: 'done', usage: undefined });
            const response: QAResponse = { answer, citations, confidence, timestamp };
            this.saveToHistory(question, response);
            return response;
          }
          log.error('Stream error chunk received', { error: chunk.error });
          onChunk({ type: 'error', error: classifyLlmError(new Error(chunk.error)) });
          const response: QAResponse = {
            answer: fullContent || classifyLlmError(new Error(chunk.error)),
            citations,
            confidence,
            timestamp,
            modelUsed,
            tokensUsed,
          };
          this.saveToHistory(question, response);
          return response;
        }
      }
    } catch (error: unknown) {
      if (signal?.aborted) {
        const answer = fullContent ? `${fullContent}\n\n*[cancelled]*` : '*[cancelled]*';
        onChunk({ type: 'done', usage: undefined });
        const response: QAResponse = { answer, citations, confidence, timestamp, modelUsed, tokensUsed };
        this.saveToHistory(question, response);
        return response;
      }
      const errorMsg = classifyLlmError(error);
      log.error('LLM stream failed', { error: error instanceof Error ? error.message : String(error) });
      onChunk({ type: 'error', error: errorMsg });
      const response: QAResponse = {
        answer: fullContent || errorMsg,
        citations,
        confidence,
        timestamp,
        modelUsed,
        tokensUsed,
      };
      this.saveToHistory(question, response);
      return response;
    }

    const answer = fullContent;
    const response: QAResponse = { answer, citations, confidence, timestamp, modelUsed, tokensUsed };

    log.info('Streaming question answered', {
      citationCount: citations.length,
      confidence,
      answerLength: answer.length,
      modelUsed,
      tokensUsed: tokensUsed ? `${tokensUsed.prompt}p / ${tokensUsed.completion}c / ${tokensUsed.total}t` : undefined,
    });

    this.saveToHistory(question, response);
    onChunk({ type: 'done', usage: tokensUsed, model: modelUsed });
    return response;
  }

  private saveToHistory(question: string, response: QAResponse): void {
    this.db.prepare(`
      INSERT INTO qa_history (ts, question, answer, confidence, citations_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(response.timestamp, question, response.answer, response.confidence, JSON.stringify(response.citations));
  }
}

export function classifyLlmError(error: unknown): string {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (msg.includes('401') || msg.includes('403') || msg.includes('invalid api key') || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return 'Invalid API key. Check your .env file.';
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Rate limited by NVIDIA. Please wait and try again.';
  }
  if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnrefused') || msg.includes('econnreset')) {
    return 'Request timed out. Check your connection.';
  }
  if (msg.includes('50') || msg.includes('service unavailable') || msg.includes('bad gateway') || msg.includes('service temporarily')) {
    return 'LLM service unavailable. Try again later.';
  }
  return `LLM request failed: ${error instanceof Error ? error.message.substring(0, 100) : String(error).substring(0, 100)}`;
}
