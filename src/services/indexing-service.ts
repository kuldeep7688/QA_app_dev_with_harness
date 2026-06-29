import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { Chunk, Document, AppStatus } from '../shared/types';
import { PersistenceService } from './persistence-service';
import { logger } from './logger';
import { isVectorExtensionLoaded } from './db';
import { embedBatch } from './embedding-service';

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
      
      // Insert chunks into SQLite and generate embeddings in a transaction
      await this.indexChunksWithEmbeddings(chunks);
      
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
      
      // Insert chunks into SQLite and generate embeddings
      await this.indexChunksWithEmbeddings(chunks);
      
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
      vectorEnabled: isVectorExtensionLoaded(),
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

  /**
   * Rebuild embeddings for all chunks. Idempotent — deletes existing vector rows first.
   * Emits progress via the optional callback.
   */
  async rebuildEmbeddings(onProgress?: (processed: number, total: number) => void): Promise<AppStatus> {
    if (!isVectorExtensionLoaded()) {
      log.warn('Cannot rebuild embeddings: vector extension not loaded');
      return this.getStatus();
    }

    const allChunks = this.getAllChunks();
    const total = allChunks.length;

    if (total === 0) {
      log.info('No chunks to re-embed');
      onProgress?.(0, 0);
      return this.getStatus();
    }

    log.info('Rebuilding embeddings for all chunks', { total });

    // Clear existing vector rows
    this.db.prepare('DELETE FROM chunks_vec').run();
    this.db.prepare('UPDATE chunks SET embedded_at = NULL').run();
    log.info('Cleared existing embeddings', { total });

    // Process in batches with progress
    const BATCH_SIZE = 32;
    let processed = 0;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.content);
      const embeddings = await embedBatch(texts);

      this.db.transaction(() => {
        const insertVec = this.db.prepare('INSERT INTO chunks_vec (embedding) VALUES (?)');
        const updateEmbedded = this.db.prepare('UPDATE chunks SET embedded_at = ?, vec_rowid = ? WHERE id = ?');
        const now = new Date().toISOString();

        for (let j = 0; j < batch.length; j++) {
          const info = insertVec.run(embeddings[j]);
          const vecRowid = Number(info.lastInsertRowid);
          updateEmbedded.run(now, vecRowid, batch[j].id);
        }
      })();

      processed += batch.length;
      onProgress?.(processed, total);
    }

    log.info('Embedding rebuild complete', { total, processed });
    return this.getStatus();
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

  /**
   * Insert chunks into SQLite and generate embeddings.
   * Uses transaction for atomicity. Skips embeddings if vector extension not loaded.
   */
  private async indexChunksWithEmbeddings(chunks: Chunk[]): Promise<void> {
    const startTime = Date.now();
    const vectorEnabled = isVectorExtensionLoaded();
    
    // Step 1: Insert chunks into chunks table (triggers populate chunks_fts automatically)
    const insertedRowids = this.db.transaction(() => {
      const insertChunk = this.db.prepare(`
        INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const rowids: number[] = [];
      for (const chunk of chunks) {
        const info = insertChunk.run(
          chunk.id,
          chunk.documentId,
          chunk.index,
          chunk.content,
          parseInt(chunk.metadata.charCount, 10),
          parseInt(chunk.metadata.wordCount, 10),
          null // embedded_at is NULL initially
        );
        rowids.push(Number(info.lastInsertRowid));
      }
      
      return rowids;
    })();
    
    log.debug('Chunks inserted into SQLite', {
      chunkCount: chunks.length,
      durationMs: Date.now() - startTime,
    });
    
    // Step 2: Generate embeddings and insert into chunks_vec (if vector extension loaded)
    if (vectorEnabled) {
      const embeddingStartTime = Date.now();
      
      // Generate embeddings for all chunks
      const texts = chunks.map(c => c.content);
      const embeddings = await embedBatch(texts);
      
      const embeddingGenTime = Date.now() - embeddingStartTime;
      
      log.info('Embeddings generated', {
        chunkCount: chunks.length,
        durationMs: embeddingGenTime,
        throughputTextsPerSec: Math.round((chunks.length / embeddingGenTime) * 1000),
      });
      
      // Insert embeddings into chunks_vec and update embedded_at
      const insertStartTime = Date.now();
      
      this.db.transaction(() => {
        // Insert embeddings (let sqlite-vec auto-assign rowids)
        const insertEmbedding = this.db.prepare(`
          INSERT INTO chunks_vec (embedding)
          VALUES (?)
        `);
        
        const updateEmbeddedAt = this.db.prepare(`
          UPDATE chunks SET embedded_at = ?, vec_rowid = ? WHERE rowid = ?
        `);
        
        const now = new Date().toISOString();
        
        // Insert embeddings and collect their rowids
        const vecRowids: number[] = [];
        for (let i = 0; i < embeddings.length; i++) {
          const embedding = embeddings[i];
          const info = insertEmbedding.run(embedding);
          vecRowids.push(Number(info.lastInsertRowid));
        }
        
        // Update embedded_at and vec_rowid for corresponding chunks
        for (let i = 0; i < insertedRowids.length; i++) {
          const chunkRowid = insertedRowids[i];
          const vecRowid = vecRowids[i];
          updateEmbeddedAt.run(now, vecRowid, chunkRowid);
        }
      })();
      
      log.info('Embeddings inserted into chunks_vec', {
        chunkCount: embeddings.length,
        insertDurationMs: Date.now() - insertStartTime,
        totalDurationMs: Date.now() - startTime,
      });
    } else {
      log.warn('Vector extension not loaded, skipping embedding generation', {
        chunkCount: chunks.length,
      });
    }
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
