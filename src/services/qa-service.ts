import type Database from 'better-sqlite3';
import { QAResponse, QAHistory, Citation, FeedbackEntry } from '../shared/types';
import { PersistenceService } from './persistence-service';
import { IndexingService } from './indexing-service';
import { logger } from './logger';

const log = logger.forService('QaService');

/** Mock Q&A patterns keyed to document content keywords. */
const MOCK_PATTERNS: Array<{
  keywords: string[];
  answer: string;
  excerpt: string;
}> = [
  {
    keywords: ['design', 'architecture', 'pattern'],
    answer: 'The system uses a layered architecture with clear boundaries between the main process, preload scripts, and renderer. Each layer communicates through typed IPC channels, and the services layer handles business logic independently of the UI.',
    excerpt: 'The system uses a layered architecture with clear boundaries',
  },
  {
    keywords: ['import', 'document', 'file'],
    answer: 'Documents are imported by copying the source file to the local data directory. The system extracts text content and creates metadata including title, filename, size, and import timestamp. After import, documents can be indexed for search.',
    excerpt: 'Documents are imported by copying the source file',
  },
  {
    keywords: ['index', 'chunk', 'search'],
    answer: 'The indexing pipeline splits documents into chunks of approximately 500 characters at paragraph boundaries. Each chunk includes metadata like character count and word count. The index enables grounded Q&A with citations pointing to specific document sections.',
    excerpt: 'The indexing pipeline splits documents into chunks',
  },
  {
    keywords: ['retrieval', 'search', 'query'],
    answer: 'Retrieval works by matching query keywords against indexed chunks. The system ranks chunks by keyword overlap and returns the most relevant excerpts as citations alongside the generated answer.',
    excerpt: 'Retrieval works by matching query keywords against indexed chunks',
  },
  {
    keywords: ['meeting', 'notes', 'summary'],
    answer: 'The meeting summary indicates that the team discussed implementing a retrieval-augmented generation pipeline. Key decisions included using local chunk storage and citation-based verification to ensure answer accuracy.',
    excerpt: 'The team discussed implementing a retrieval-augmented generation pipeline',
  },
];

export class QaService {
  private indexingService: IndexingService;
  private db: Database.Database;

  constructor(persistence: PersistenceService, db: Database.Database, indexingService?: IndexingService) {
    this.db = db;
    this.indexingService = indexingService ?? new IndexingService(persistence, db);
  }

  /** Ask a question and get a grounded answer with citations. */
  async ask(question: string): Promise<QAResponse> {
    log.info('Processing question', { question: question.substring(0, 100) });
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));

    const chunks = this.indexingService.getAllChunks();
    const citations: Citation[] = [];

    log.debug('Retrieving chunks for Q&A', { totalChunks: chunks.length });

    if (chunks.length > 0) {
      // Find relevant chunks using keyword matching
      const questionWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const scored = chunks.map(chunk => {
        const contentLower = chunk.content.toLowerCase();
        const score = questionWords.reduce(
          (acc, word) => acc + (contentLower.includes(word) ? 1 : 0),
          0
        );
        return { chunk, score };
      });

      // Take top 2 relevant chunks as citations
      const relevant = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      // Get document metadata for citations from SQLite
      const docs = this.db.prepare('SELECT id, title FROM documents').all() as Array<{ id: string; title: string }>;

      // Calculate normalized confidence scores (0-1 range)
      const maxScore = Math.max(...relevant.map(r => r.score), 1);

      for (const { chunk, score } of relevant) {
        const doc = docs.find(d => d.id === chunk.documentId);
        const normalizedScore = score / maxScore; // Normalize to 0-1
        citations.push({
          documentId: chunk.documentId,
          documentTitle: doc?.title ?? 'Unknown Document',
          chunkIndex: chunk.index,
          excerpt: chunk.content.substring(0, 200),
          confidence: parseFloat(normalizedScore.toFixed(2)), // Round to 2 decimals
        });
      }
      
      log.debug('Generated citations', {
        citationCount: citations.length,
        documentIds: citations.map(c => c.documentId),
      });
    }

    // Generate answer from mock patterns or use fallback
    const answer = this.generateAnswer(question, citations);

    const response: QAResponse = {
      answer,
      citations,
      confidence: citations.length > 0 ? 0.85 : 0.3,
      timestamp: new Date().toISOString(),
    };

    log.info('Question answered', {
      citationCount: citations.length,
      confidence: response.confidence,
      answerLength: answer.length,
    });

    // Save to history
    this.saveToHistory(question, response);

    return response;
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
    // Match against mock patterns
    const questionLower = question.toLowerCase();
    for (const pattern of MOCK_PATTERNS) {
      if (pattern.keywords.some(kw => questionLower.includes(kw))) {
        if (citations.length > 0) {
          return `${pattern.answer} Based on the document "${citations[0].documentTitle}", ${citations[0].excerpt.substring(0, 100)}.`;
        }
        return pattern.answer;
      }
    }

    // Fallback answer
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
