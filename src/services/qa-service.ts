import type Database from 'better-sqlite3';
import { QAResponse, QAHistory, Citation, FeedbackEntry } from '../shared/types';
import { logger } from './logger';
import { hybridSearch, debugSearch, DebugSearchResult } from './retriever';
import { isVectorExtensionLoaded } from './db';

const log = logger.forService('QaService');

/** Mock Q&A patterns keyed to document content keywords. */
const MOCK_PATTERNS: Array<{
  keywords: string[];
  answer: string;
}> = [
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

export class QaService {
  private db: Database.Database;
  private embedFn: (text: string) => Promise<Float32Array>;

  constructor(db: Database.Database, embedFn: (text: string) => Promise<Float32Array>) {
    this.db = db;
    this.embedFn = embedFn;
  }

  /** Ask a question and get a grounded answer with citations. */
  async ask(question: string): Promise<QAResponse> {
    log.info('Processing question', { question: question.substring(0, 100) });

    // Run hybrid retrieval (BM25 + vector if available)
    const results = await hybridSearch(this.db, question, this.embedFn, {
      mode: isVectorExtensionLoaded() ? 'hybrid' : 'bm25',
      topK: 5,
    });

    // Get document metadata for citation titles
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

    // Derive overall confidence from fused score distribution
    const confidence = this.computeConfidence(results);

    log.info('Hybrid retrieval for question', {
      resultCount: results.length,
      citationCount: citations.length,
      confidence,
      topSource: results[0]?.sources ?? [],
      topFusedScore: results[0]?.fusedScore ?? 0,
    });

    // Generate answer from mock patterns or use fallback
    const answer = this.generateAnswer(question, citations);

    const response: QAResponse = {
      answer,
      citations,
      confidence,
      timestamp: new Date().toISOString(),
    };

    log.info('Question answered', {
      citationCount: citations.length,
      confidence,
      answerLength: answer.length,
    });

    // Save to history
    this.saveToHistory(question, response);

    return response;
  }

  /** Debug retrieval: returns raw BM25, vector, and fused lists without answer generation. */
  async retrieveDebug(question: string, opts?: { mode?: 'hybrid' | 'bm25' | 'vector' }): Promise<DebugSearchResult> {
    log.debug('Retrieval debug requested', { question: question.substring(0, 100), mode: opts?.mode });

    const results = await debugSearch(this.db, question, this.embedFn, {
      mode: opts?.mode ?? (isVectorExtensionLoaded() ? 'hybrid' : 'bm25'),
      topK: 5,
    });

    log.debug('Retrieval debug completed', {
      bm25Count: results.bm25Results.length,
      vectorCount: results.vectorResults.length,
      fusedCount: results.fusedResults.length,
    });

    return results;
  }

  /** Derive confidence from the fused score distribution of hybrid search results. */
  private computeConfidence(results: Array<{ fusedScore: number; sources: Array<'bm25' | 'vector'> }>): number {
    if (results.length === 0) return 0;

    const topScore = results[0].fusedScore;
    const gapToSecond = results.length > 1 ? topScore - results[1].fusedScore : topScore;
    const hasBothSources = results[0].sources.length > 1;

    // Map RRF fused scores (~0.008 to ~0.033) to 0-1 confidence
    let c = topScore * 30;
    if (hasBothSources) c += 0.15;
    if (gapToSecond > 0.005) c += 0.1;
    if (results.length > 1 && results[0].sources.length > 1 && results[1].sources.length > 1) c += 0.05;

    return parseFloat(Math.min(1, c).toFixed(2));
  }

  /** Get the Q&A history. */
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

  /** Clear all Q&A history. */
  clearHistory(): void {
    this.db.prepare('DELETE FROM qa_history').run();
    log.info('Q&A history cleared');
  }

  private generateAnswer(question: string, citations: Citation[]): string {
    const questionLower = question.toLowerCase();
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

  /** Submit feedback for a Q&A response. */
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

  /** Get all feedback entries. */
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

  private saveToHistory(question: string, response: QAResponse): void {
    this.db.prepare(`
      INSERT INTO qa_history (ts, question, answer, confidence, citations_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(response.timestamp, question, response.answer, response.confidence, JSON.stringify(response.citations));
  }
}
