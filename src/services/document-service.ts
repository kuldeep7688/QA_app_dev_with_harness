import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Document } from '../shared/types';
import { PersistenceService } from './persistence-service';
import { logger } from './logger';

const log = logger.forService('DocumentService');

const DOCUMENTS_META = 'documents-meta.json';

export class DocumentService {
  private persistence: PersistenceService;

  constructor(persistence: PersistenceService) {
    this.persistence = persistence;
  }

  /** List all imported documents. */
  listDocuments(): Document[] {
    const docs = this.persistence.readJson<Document[]>(DOCUMENTS_META);
    log.debug('Listed documents', { count: docs?.length ?? 0 });
    return docs ?? [];
  }

  /** Import a file from the given path. */
  importDocument(filePath: string): Document {
    log.info('Starting document import', { filePath });
    
    if (!fs.existsSync(filePath)) {
      log.error('File not found', { filePath });
      throw new Error(`File not found: ${filePath}`);
    }

    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const stats = fs.statSync(filePath);

    // Extract metadata
    const wordCount = content.trim().split(/\s+/).filter(word => word.length > 0).length;
    const lineCount = content.split('\n').length;
    const fileType = path.extname(filename).toLowerCase().replace('.', '') || 'txt';

    const doc: Document = {
      id: uuidv4(),
      title: filename.replace(/\.[^.]+$/, ''),
      filename,
      importedAt: new Date().toISOString(),
      size: stats.size,
      status: 'imported',
      wordCount,
      lineCount,
      fileType,
    };

    // Copy file to data directory
    this.persistence.copyFileToDocuments(filePath, filename);

    // Store content for indexing and viewing
    this.persistence.writeText(`content/${doc.id}.txt`, content);

    // Update metadata
    const docs = this.listDocuments();
    docs.push(doc);
    this.persistence.writeJson(DOCUMENTS_META, docs);

    log.info('Document imported successfully', {
      id: doc.id,
      title: doc.title,
      size: doc.size,
      wordCount: doc.wordCount,
      lineCount: doc.lineCount,
    });

    return doc;
  }

  /** Get a single document by ID. */
  getDocument(id: string): Document | null {
    const docs = this.listDocuments();
    return docs.find(d => d.id === id) ?? null;
  }

  /** Get the text content of a document. */
  getDocumentContent(id: string): string | null {
    const content = this.persistence.readText(`content/${id}.txt`);
    log.debug('Retrieved document content', {
      id,
      contentLength: content?.length ?? 0,
      found: !!content,
    });
    return content;
  }

  /** Update a document's metadata. */
  updateDocument(id: string, updates: Partial<Document>): Document | null {
    const docs = this.listDocuments();
    const index = docs.findIndex(d => d.id === id);
    if (index === -1) {
      log.warn('Document not found for update', { id });
      return null;
    }

    docs[index] = { ...docs[index], ...updates };
    this.persistence.writeJson(DOCUMENTS_META, docs);
    log.info('Document metadata updated', { id, fields: Object.keys(updates) });
    return docs[index];
  }

  /** Delete a document by ID. Removes content, chunks, and metadata. */
  deleteDocument(id: string): boolean {
    log.info('Starting document deletion', { id });
    
    const docs = this.listDocuments();
    const doc = docs.find(d => d.id === id);
    if (!doc) {
      log.warn('Document not found for deletion', { id });
      return false;
    }

    // Remove file from documents directory
    this.persistence.deleteFromDocuments(doc.filename);

    // Remove stored content
    const contentPath = path.join(this.persistence.getDataDir(), 'content', `${id}.txt`);
    if (fs.existsSync(contentPath)) {
      fs.unlinkSync(contentPath);
    }

    // Remove chunks if they exist
    const chunksPath = path.join(this.persistence.getDataDir(), 'chunks', `${id}.json`);
    if (fs.existsSync(chunksPath)) {
      fs.unlinkSync(chunksPath);
    }

    // Remove from index metadata
    const indexMeta = this.persistence.readJson<Record<string, string[]>>('index-meta.json');
    if (indexMeta && indexMeta[id]) {
      delete indexMeta[id];
      this.persistence.writeJson('index-meta.json', indexMeta);
    }

    // Update metadata
    const updated = docs.filter(d => d.id !== id);
    this.persistence.writeJson(DOCUMENTS_META, updated);
    
    log.info('Document deleted successfully', { id, title: doc.title, remainingCount: updated.length });
    return true;
  }

  /** Check whether the persistence layer has stored data. */
  hasPersistedData(): boolean {
    return this.persistence.exists(DOCUMENTS_META);
  }
}
