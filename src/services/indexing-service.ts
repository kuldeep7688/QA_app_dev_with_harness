import { v4 as uuidv4 } from 'uuid';
import { Chunk, Document, AppStatus } from '../shared/types';
import { PersistenceService } from './persistence-service';
import { logger } from './logger';

const log = logger.forService('IndexingService');

const INDEX_META = 'index-meta.json';
const CHUNKS_DIR = 'chunks';

export class IndexingService {
  private persistence: PersistenceService;

  constructor(persistence: PersistenceService) {
    this.persistence = persistence;
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
      this.persistence.writeJson(`${CHUNKS_DIR}/${documentId}.json`, chunks);
      
      log.info('Document chunked successfully', {
        documentId,
        chunkCount: chunks.length,
        avgChunkSize: Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length),
      });
      
      // Update document status and chunks count
      this.updateDocumentStatus(documentId, 'indexed', chunks.length);
      
      // Update index metadata
      const chunksMeta = this.persistence.readJson<Record<string, string[]>>(INDEX_META) ?? {};
      chunksMeta[documentId] = chunks.map(c => c.id);
      this.persistence.writeJson(INDEX_META, chunksMeta);
      
      return this.getStatus();
    }

    // Index all documents that haven't been indexed yet
    const docsMeta = this.persistence.readJson<Document[]>('documents-meta.json') ?? [];
    const chunksMeta = this.persistence.readJson<Record<string, string[]>>(INDEX_META) ?? {};

    log.info('Starting bulk indexing', {
      totalDocuments: docsMeta.length,
      alreadyIndexed: Object.keys(chunksMeta).length,
    });

    for (const doc of docsMeta) {
      if (chunksMeta[doc.id]) continue;

      const content = this.persistence.readText(`content/${doc.id}.txt`);
      if (!content) {
        log.error('Content not found during bulk indexing', { documentId: doc.id });
        this.updateDocumentStatus(doc.id, 'error', 0);
        continue;
      }

      const chunks = this.chunkDocument(doc.id, content);
      this.persistence.writeJson(`${CHUNKS_DIR}/${doc.id}.json`, chunks);
      chunksMeta[doc.id] = chunks.map(c => c.id);
      
      log.debug('Document indexed', {
        documentId: doc.id,
        chunkCount: chunks.length,
      });
      
      // Update document status and chunks count
      this.updateDocumentStatus(doc.id, 'indexed', chunks.length);
    }

    this.persistence.writeJson(INDEX_META, chunksMeta);
    log.info('Bulk indexing completed', { totalIndexed: Object.keys(chunksMeta).length });
    
    return this.getStatus();
  }

  /** Get current indexing status. */
  getStatus(): AppStatus {
    const docs = this.persistence.readJson<Document[]>('documents-meta.json') ?? [];
    const chunksMeta = this.persistence.readJson<Record<string, string[]>>(INDEX_META) ?? {};

    const currentIndexed = Object.keys(chunksMeta).length;
    const totalDocuments = docs.length;
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
    return this.persistence.readJson<Chunk[]>(`${CHUNKS_DIR}/${documentId}.json`) ?? [];
  }

  /** Get all chunks across all documents. */
  getAllChunks(): Chunk[] {
    const chunksMeta = this.persistence.readJson<Record<string, string[]>>(INDEX_META) ?? {};
    const allChunks: Chunk[] = [];

    for (const docId of Object.keys(chunksMeta)) {
      const chunks = this.getChunksForDocument(docId);
      allChunks.push(...chunks);
    }

    return allChunks;
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

  /** Update document status and chunks count in documents-meta.json */
  private updateDocumentStatus(documentId: string, status: Document['status'], chunksCount: number): void {
    const docsMeta = this.persistence.readJson<Document[]>('documents-meta.json') ?? [];
    const docIndex = docsMeta.findIndex(d => d.id === documentId);
    
    if (docIndex !== -1) {
      docsMeta[docIndex] = {
        ...docsMeta[docIndex],
        status,
        chunks: chunksCount,
      };
      this.persistence.writeJson('documents-meta.json', docsMeta);
    }
  }
}
