import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { Document } from '../shared/types';
import { PersistenceService } from './persistence-service';
import { logger } from './logger';

const log = logger.forService('DocumentService');

export class DocumentService {
  private persistence: PersistenceService;
  private db: Database.Database;

  constructor(persistence: PersistenceService, db: Database.Database) {
    this.persistence = persistence;
    this.db = db;
  }

  /** List all imported documents. */
  listDocuments(): Document[] {
    const docs = this.db.prepare('SELECT * FROM documents ORDER BY imported_at DESC').all() as any[];
    log.debug('Listed documents', { count: docs.length });
    
    return docs.map(row => ({
      id: row.id,
      title: row.title,
      filename: row.filename,
      importedAt: row.imported_at,
      size: row.size,
      status: row.status as 'imported' | 'indexing' | 'indexed' | 'error',
      chunks: row.chunks ?? undefined,
      wordCount: row.word_count ?? undefined,
      lineCount: row.line_count ?? undefined,
      fileType: row.file_type ?? undefined,
    }));
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

    // Insert into SQLite
    this.db.prepare(`
      INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.id,
      doc.title,
      doc.filename,
      doc.size,
      doc.importedAt,
      doc.status,
      doc.wordCount,
      doc.lineCount,
      doc.fileType
    );

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
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    if (!row) {
      return null;
    }
    
    return {
      id: row.id,
      title: row.title,
      filename: row.filename,
      importedAt: row.imported_at,
      size: row.size,
      status: row.status as 'imported' | 'indexing' | 'indexed' | 'error',
      chunks: row.chunks ?? undefined,
      wordCount: row.word_count ?? undefined,
      lineCount: row.line_count ?? undefined,
      fileType: row.file_type ?? undefined,
    };
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
    const doc = this.getDocument(id);
    if (!doc) {
      log.warn('Document not found for update', { id });
      return null;
    }

    // Build UPDATE query dynamically based on provided fields
    const fields: string[] = [];
    const values: any[] = [];
    
    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.chunks !== undefined) {
      fields.push('chunks = ?');
      values.push(updates.chunks);
    }
    
    if (fields.length === 0) {
      return doc; // No updates
    }
    
    values.push(id); // Add id for WHERE clause
    
    this.db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    
    log.info('Document metadata updated', { id, fields: Object.keys(updates) });
    return this.getDocument(id);
  }

  /** Delete a document by ID. Removes content, chunks, and metadata. */
  deleteDocument(id: string): boolean {
    log.info('Starting document deletion', { id });
    
    const doc = this.getDocument(id);
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

    // Delete from SQLite (chunks will be CASCADE deleted automatically)
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    
    const remaining = this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    log.info('Document deleted successfully', { id, title: doc.title, remainingCount: remaining.count });
    return true;
  }

  /** Check whether the persistence layer has stored data. */
  hasPersistedData(): boolean {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    return count.count > 0;
  }
}
