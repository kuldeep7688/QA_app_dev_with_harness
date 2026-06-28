import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const log = logger.forService('PersistenceService');

export class PersistenceService {
  private dataDir: string;
  private documentsDir: string;
  private indexDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.documentsDir = path.join(dataDir, 'documents');
    this.indexDir = path.join(dataDir, 'index');
    
    log.info('Initializing persistence service', {
      dataDir,
      documentsDir: this.documentsDir,
      indexDir: this.indexDir,
    });
    
    this.ensureDirectories();
  }

  private ensureDirectories() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.documentsDir, { recursive: true });
    fs.mkdirSync(this.indexDir, { recursive: true });
  }

  /** Read a JSON file, returning null if it doesn't exist. */
  readJson<T>(relativePath: string): T | null {
    const fullPath = path.join(this.dataDir, relativePath);
    if (!fs.existsSync(fullPath)) {
      log.debug('JSON file not found', { relativePath });
      return null;
    }
    
    try {
      const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      log.debug('JSON file read', { relativePath, size: fs.statSync(fullPath).size });
      return content;
    } catch (error) {
      log.error('Failed to read JSON file', {
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Write a JSON file atomically. */
  writeJson<T>(relativePath: string, data: T): void {
    const fullPath = path.join(this.dataDir, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    
    try {
      const json = JSON.stringify(data, null, 2);
      fs.writeFileSync(fullPath, json, 'utf-8');
      log.debug('JSON file written', {
        relativePath,
        size: json.length,
      });
    } catch (error) {
      log.error('Failed to write JSON file', {
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Read a text file. */
  readText(relativePath: string): string | null {
    const fullPath = path.join(this.dataDir, relativePath);
    if (!fs.existsSync(fullPath)) {
      log.debug('Text file not found', { relativePath });
      return null;
    }
    
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      log.debug('Text file read', {
        relativePath,
        size: content.length,
      });
      return content;
    } catch (error) {
      log.error('Failed to read text file', {
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Write a text file. */
  writeText(relativePath: string, content: string): void {
    const fullPath = path.join(this.dataDir, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    
    try {
      fs.writeFileSync(fullPath, content, 'utf-8');
      log.debug('Text file written', {
        relativePath,
        size: content.length,
      });
    } catch (error) {
      log.error('Failed to write text file', {
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Copy a file into the documents directory. */
  copyFileToDocuments(sourcePath: string, filename: string): string {
    const destPath = path.join(this.documentsDir, filename);
    fs.mkdirSync(this.documentsDir, { recursive: true });
    
    try {
      fs.copyFileSync(sourcePath, destPath);
      const stats = fs.statSync(destPath);
      log.info('File copied to documents directory', {
        sourcePath,
        destPath,
        size: stats.size,
      });
      return destPath;
    } catch (error) {
      log.error('Failed to copy file', {
        sourcePath,
        destPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Delete a file from the documents directory. */
  deleteFromDocuments(filename: string): void {
    const filePath = path.join(this.documentsDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        log.info('File deleted from documents directory', { filename, filePath });
      } catch (error) {
        log.error('Failed to delete file', {
          filename,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } else {
      log.debug('File not found for deletion', { filename, filePath });
    }
  }

  /** List all files in a directory. */
  listFiles(relativePath: string): string[] {
    const fullPath = path.join(this.dataDir, relativePath);
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath);
  }

  /** Check if a file exists. */
  exists(relativePath: string): boolean {
    return fs.existsSync(path.join(this.dataDir, relativePath));
  }

  /** Get the data directory path. */
  getDataDir(): string {
    return this.dataDir;
  }

  /** Get the documents directory path. */
  getDocumentsDir(): string {
    return this.documentsDir;
  }

  /** Get the index directory path. */
  getIndexDir(): string {
    return this.indexDir;
  }

  /** Remove all data and re-create directory structure. */
  resetAll(): void {
    log.warn('Resetting all data', { dataDir: this.dataDir });
    try {
      // Delete all files in documents directory
      if (fs.existsSync(this.documentsDir)) {
        this.removeDirectoryContents(this.documentsDir);
        log.info('Documents directory cleared', { documentsDir: this.documentsDir });
      }
      
      // Delete all files in index directory (except the database files)
      if (fs.existsSync(this.indexDir)) {
        this.removeDirectoryContents(this.indexDir);
        log.info('Index directory cleared', { indexDir: this.indexDir });
      }
      
      // Re-ensure directories exist
      this.ensureDirectories();
      
      log.info('Data directory reset complete', { dataDir: this.dataDir });
    } catch (error) {
      log.error('Failed to reset data directory', {
        dataDir: this.dataDir,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Recursively remove directory contents (helper for resetAll) */
  private removeDirectoryContents(dirPath: string): void {
    if (!fs.existsSync(dirPath)) return;
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      // Skip .fuse_hidden files - they'll be cleaned up by the filesystem
      if (entry.name.startsWith('.fuse_hidden')) {
        log.debug('Skipping FUSE hidden file', { path: fullPath });
        continue;
      }
      
      // Skip database files - we'll clear the data but keep the schema
      if (entry.name === 'index.db' || entry.name.startsWith('index.db-')) {
        log.debug('Skipping database file', { path: fullPath });
        continue;
      }
      
      try {
        if (entry.isDirectory()) {
          this.removeDirectoryContents(fullPath);
          fs.rmdirSync(fullPath);
        } else {
          fs.unlinkSync(fullPath);
        }
      } catch (error) {
        // Log but continue - some files might be temporarily locked
        log.warn('Failed to remove entry during reset', {
          path: fullPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
