import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { Chunk, Document, AppStatus } from '../shared/types';
import { PersistenceService } from './persistence-service';
import { logger } from './logger';

const log = logger.forService('IndexingService');

export class IndexingService {
  private persistence: PersistenceService;
  private db: Database.Database;

  constructor(persistence: PersistenceService, db: Database.Database) {
    this.persistence = persistence;
    this.db = db;
  }

  /** Start indexing documents. If documentId is provided, index only that document. */
  async startIndexing(documentId?: string): Promise<AppStatus> {
    const status = this.getStatus();

    if (documentId) {
      log.info('Starting single document indexing', { documentId });
      
      // Index a single document
      const content = this.persistence.readText(`content/${documentId}.txt`);
      if (!content) {
        log.error('Content not found for document', { documentId });
        this.updateDocumentStatus(documentId, 'error', 0);
        return { ...status, indexStatus: 'error' };
      }
      
      const chunks = this.chunkDocument(documentId, content);
      
      // Insert chunks into SQLite in a transaction
      this.db.transaction(() => {
        const insertChunk = this.db.prepare(`
          INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const chunk of chunks) {
          insertChunk.run(
            chunk.id,
            chunk.documentId,
            chunk.index,
            chunk.content,
            parseInt(chunk.metadata.charCount, 10),
            parseInt(chunk.metadata.wordCount, 10),
            null // embedded_at is NULL initially
          );
        }
      })();
      
      log.info('Document chunked successfully', {
        documentId,
        chunkCount: chunks.length,
        avgChunkSize: Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length),
      });
      
      // Update document status and chunks count
      this.updateDocumentStatus(documentId, 'indexed', chunks.length);
      
      return this.getStatus();
    }

    // Index all documents that haven't been indexed yet
    const docs = this.db.prepare('SELECT * FROM documents WHERE status != ?').all('indexed') as any[];

    log.info('Starting bulk indexing', {
      totalDocuments: docs.length,
    });

    for (const docRow of docs) {
      const content = this.persistence.readText(`content/${docRow.id}.txt`);
      if (!content) {
        log.error('Content not found during bulk indexing', { documentId: docRow.id });
        this.updateDocumentStatus(docRow.id, 'error', 0);
        continue;
      }

      const chunks = this.chunkDocument(docRow.id, content);
      
      // Insert chunks into SQLite in a transaction
      this.db.transaction(() => {
        const insertChunk = this.db.prepare(`
          INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const chunk of chunks) {
          insertChunk.run(
            chunk.id,
            chunk.documentId,
            chunk.index,
            chunk.content,
            parseInt(chunk.metadata.charCount, 10),
            parseInt(chunk.metadata.wordCount, 10),
            null
          );
        }
      })();
      
      log.debug('Document indexed', {
        documentId: docRow.id,
        chunkCount: chunks.length,
      });
      
      // Update document status and chunks count
      this.updateDocumentStatus(docRow.id, 'indexed', chunks.length);
    }

    log.info('Bulk indexing completed');
    
    return this.getStatus();
  }

  /** Get current indexing status. */
  getStatus(): AppStatus {
    const totalDocs = this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    const indexedDocs = this.db.prepare('SELECT COUNT(*) as count FROM documents WHERE status = ?').get('indexed') as { count: number };

    const currentIndexed = indexedDocs.count;
    const totalDocuments = totalDocs.count;
    const isReady = currentIndexed === totalDocuments && totalDocuments > 0;

    log.debug('Indexing status queried', {
      totalDocuments,
      indexedCount: currentIndexed,
      isReady,
    });

    return {
      documentsLoaded: totalDocuments,
      indexStatus: isReady ? 'ready' : currentIndexed > 0 && currentIndexed < totalDocuments ? 'indexing' : totalDocuments === 0 ? 'idle' : 'idle',
      lastActivity: new Date().toISOString(),
      indexedCount: currentIndexed,
    };
  }

  /** Get all chunks for a document. */
  getChunksForDocument(documentId: string): Chunk[] {
    const rows = this.db.prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY idx').all(documentId) as any[];
    
    return rows.map(row => ({
      id: row.id,
      documentId: row.document_id,
      content: row.content,
      index: row.idx,
      metadata: {
        charCount: String(row.char_count),
        wordCount: String(row.word_count),
      },
    }));
  }

  /** Get all chunks across all documents. */
  getAllChunks(): Chunk[] {
    const rows = this.db.prepare('SELECT * FROM chunks ORDER BY document_id, idx').all() as any[];
    
    return rows.map(row => ({
      id: row.id,
      documentId: row.document_id,
      content: row.content,
      index: row.idx,
      metadata: {
        charCount: String(row.char_count),
        wordCount: String(row.word_count),
      },
    }));
  }

  /** Split a document into chunks of ~500 characters at paragraph boundaries. */
  private chunkDocument(documentId: string, content: string): Chunk[] {
    const CHUNK_SIZE = 500;
    const chunks: Chunk[] = [];

    // Split on double newlines (paragraphs)
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    let buffer = '';
    let chunkIndex = 0;

    for (const para of paragraphs) {
      if (buffer.length + para.length > CHUNK_SIZE && buffer.length > 0) {
        chunks.push(this.createChunk(documentId, chunkIndex++, buffer.trim()));
        buffer = para;
      } else {
        buffer += (buffer ? '\n\n' : '') + para;
      }
    }

    if (buffer.trim()) {
      chunks.push(this.createChunk(documentId, chunkIndex, buffer.trim()));
    }

    return chunks;
  }

  private createChunk(documentId: string, index: number, content: string): Chunk {
    return {
      id: uuidv4(),
      documentId,
      content,
      index,
      metadata: {
        charCount: String(content.length),
        wordCount: String(content.split(/\s+/).length),
      },
    };
  }

  /** Update document status in documents table */
  private updateDocumentStatus(documentId: string, status: Document['status'], _chunksCount: number): void {
    // Note: chunksCount is not stored in documents table, it's calculated via COUNT() when needed
    this.db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(status, documentId);
  }
}
