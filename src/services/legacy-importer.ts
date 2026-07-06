import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { Document, Chunk, QAHistory, FeedbackEntry } from '../shared/types';
import { logger } from './logger';

const log = logger.forService('legacy-importer');

/**
 * One-shot importer for legacy JSON files to SQLite.
 * 
 * Detects if index.db is missing and legacy JSON files exist, then:
 * 1. Imports all data in a single transaction
 * 2. Moves legacy files to <dataDir>/legacy/ backup directory
 * 
 * Legacy file structure:
 * - documents-meta.json: Array<Document>
 * - chunks/<doc-id>.json: Array<Chunk>
 * - qa-history.json: Array<QAHistory>
 * - feedback.json: Array<FeedbackEntry>
 */
export class LegacyImporter {
  /**
   * Check if legacy import should run.
   * 
   * @param dataDir - The data directory path
   * @param dbPath - Path to index.db
   * @returns true if index.db is missing AND at least one legacy JSON file exists
   */
  static shouldImport(dataDir: string, dbPath: string): boolean {
    // If index.db exists, no import needed
    if (fs.existsSync(dbPath)) {
      return false;
    }

    // Check for any legacy JSON file
    const legacyFiles = [
      'documents-meta.json',
      'qa-history.json',
      'feedback.json',
    ];

    const hasLegacyFiles = legacyFiles.some(file => 
      fs.existsSync(path.join(dataDir, file))
    );

    if (hasLegacyFiles) {
      log.info('Legacy JSON files detected, import will run', { dataDir, dbPath });
    }

    return hasLegacyFiles;
  }

  /**
   * Import all legacy JSON data into SQLite and move files to legacy/ backup.
   * 
   * @param db - SQLite database instance
   * @param dataDir - The data directory path
   */
  static importLegacyData(db: Database.Database, dataDir: string): void {
    log.info('Starting legacy JSON import', { dataDir });

    const stats = {
      documents: 0,
      chunks: 0,
      qaHistory: 0,
      feedback: 0,
    };

    // Import everything in a single transaction
    db.transaction(() => {
      // 1. Import documents
      const documentsPath = path.join(dataDir, 'documents-meta.json');
      if (fs.existsSync(documentsPath)) {
        const documents = JSON.parse(fs.readFileSync(documentsPath, 'utf-8')) as Document[];
        const insertDoc = db.prepare(`
          INSERT INTO documents (id, title, filename, size, imported_at, status, word_count, line_count, file_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const doc of documents) {
          insertDoc.run(
            doc.id,
            doc.title,
            doc.filename,
            doc.size,
            doc.importedAt,
            doc.status,
            doc.wordCount ?? null,
            doc.lineCount ?? null,
            doc.fileType ?? null
          );
          stats.documents++;
        }
        log.info('Imported documents', { count: stats.documents });
      }

      // 2. Import chunks from chunks/*.json files
      const chunksDir = path.join(dataDir, 'chunks');
      if (fs.existsSync(chunksDir)) {
        const chunkFiles = fs.readdirSync(chunksDir).filter(f => f.endsWith('.json'));
        const insertChunk = db.prepare(`
          INSERT INTO chunks (id, document_id, idx, content, char_count, word_count, embedded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const chunkFile of chunkFiles) {
          const chunks = JSON.parse(fs.readFileSync(path.join(chunksDir, chunkFile), 'utf-8')) as Chunk[];
          for (const chunk of chunks) {
            const charCount = parseInt(chunk.metadata.charCount ?? '0', 10);
            const wordCount = parseInt(chunk.metadata.wordCount ?? '0', 10);
            
            insertChunk.run(
              chunk.id,
              chunk.documentId,
              chunk.index,
              chunk.content,
              charCount,
              wordCount,
              null // embedded_at is NULL initially
            );
            stats.chunks++;
          }
        }
        log.info('Imported chunks', { count: stats.chunks });
      }

      // 3. Import Q&A history
      const qaHistoryPath = path.join(dataDir, 'qa-history.json');
      if (fs.existsSync(qaHistoryPath)) {
        const history = JSON.parse(fs.readFileSync(qaHistoryPath, 'utf-8')) as QAHistory[];
        const insertQA = db.prepare(`
          INSERT INTO qa_history (ts, question, answer, confidence, citations_json)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const entry of history) {
          insertQA.run(
            entry.response.timestamp,
            entry.question,
            entry.response.answer,
            entry.response.confidence,
            JSON.stringify(entry.response.citations)
          );
          stats.qaHistory++;
        }
        log.info('Imported Q&A history', { count: stats.qaHistory });
      }

      // 4. Import feedback
      const feedbackPath = path.join(dataDir, 'feedback.json');
      if (fs.existsSync(feedbackPath)) {
        const feedback = JSON.parse(fs.readFileSync(feedbackPath, 'utf-8')) as FeedbackEntry[];
        const insertFeedback = db.prepare(`
          INSERT INTO feedback (id, response_ts, question, rating, comment, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const entry of feedback) {
          insertFeedback.run(
            entry.id,
            entry.responseTimestamp,
            entry.question,
            entry.rating,
            null, // comment field doesn't exist in legacy
            entry.submittedAt
          );
          stats.feedback++;
        }
        log.info('Imported feedback', { count: stats.feedback });
      }
    })();

    log.info('Legacy import transaction complete', stats);

    // Move legacy files to backup directory
    this.moveLegacyFiles(dataDir);
  }

  /**
   * Move legacy JSON files to <dataDir>/legacy/ backup directory.
   * 
   * @param dataDir - The data directory path
   */
  private static moveLegacyFiles(dataDir: string): void {
    const legacyDir = path.join(dataDir, 'legacy');
    
    // Create legacy directory if it doesn't exist
    if (!fs.existsSync(legacyDir)) {
      fs.mkdirSync(legacyDir, { recursive: true });
      log.info('Created legacy backup directory', { legacyDir });
    }

    const filesToMove = [
      'documents-meta.json',
      'qa-history.json',
      'feedback.json',
      'index-meta.json', // Also move index metadata if exists
    ];

    let movedCount = 0;
    for (const file of filesToMove) {
      const srcPath = path.join(dataDir, file);
      const destPath = path.join(legacyDir, file);
      
      if (fs.existsSync(srcPath)) {
        fs.renameSync(srcPath, destPath);
        log.info('Moved legacy file to backup', { file, destPath });
        movedCount++;
      }
    }

    // Move chunks/ directory if exists
    const chunksDir = path.join(dataDir, 'chunks');
    const legacyChunksDir = path.join(legacyDir, 'chunks');
    
    if (fs.existsSync(chunksDir)) {
      fs.renameSync(chunksDir, legacyChunksDir);
      log.info('Moved legacy chunks directory to backup', { destPath: legacyChunksDir });
      movedCount++;
    }

    log.info('Legacy files moved to backup', { movedCount, legacyDir });
  }
}
