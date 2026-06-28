import Database from 'better-sqlite3';
import * as path from 'path';
import { logger } from './logger';

const log = logger.forService('database');

let dbInstance: Database.Database | null = null;

/**
 * Initialize the SQLite database at <dataDir>/index.db
 * Sets WAL mode and enables foreign keys.
 * This is a singleton — calling multiple times returns the same instance.
 */
export function initDatabase(dataDir: string): Database.Database {
  if (dbInstance) {
    log.debug('Returning existing database instance', { dataDir });
    return dbInstance;
  }

  const dbPath = path.join(dataDir, 'index.db');
  
  log.info('Initializing SQLite database', { dbPath });

  try {
    dbInstance = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    const walResult = dbInstance.pragma('journal_mode = WAL');
    const walMode = Array.isArray(walResult) && walResult.length > 0 
      ? walResult[0].journal_mode 
      : 'unknown';
    
    // Enable foreign key constraints
    dbInstance.pragma('foreign_keys = ON');
    const fkEnabled = dbInstance.pragma('foreign_keys', { simple: true });
    
    // Get SQLite version
    const version = dbInstance.pragma('user_version', { simple: true });
    const sqliteVersion = dbInstance.prepare('SELECT sqlite_version()').pluck().get() as string;
    
    log.info('SQLite database initialized', {
      dbPath,
      sqliteVersion,
      walMode,
      foreignKeysEnabled: fkEnabled === 1,
      userVersion: version,
    });
    
    return dbInstance;
  } catch (error) {
    log.error('Failed to initialize database', {
      dbPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get the current database instance.
 * Throws if database has not been initialized.
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

/**
 * Close the database connection.
 * Used primarily in tests or during shutdown.
 */
export function closeDatabase(): void {
  if (dbInstance) {
    log.info('Closing database connection');
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Reset database instance (for testing).
 */
export function resetDatabaseInstance(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Clear all data from the database tables.
 * Keeps the schema intact, only deletes rows.
 */
export function clearAllData(): void {
  const db = getDatabase();
  
  log.info('Clearing all data from database tables');
  
  try {
    // Use a transaction for atomicity
    db.transaction(() => {
      // Delete from tables in order (respecting foreign key constraints)
      db.prepare('DELETE FROM feedback').run();
      db.prepare('DELETE FROM qa_history').run();
      db.prepare('DELETE FROM chunks_fts').run();  // FTS5 virtual table
      db.prepare('DELETE FROM chunks').run();
      db.prepare('DELETE FROM documents').run();
      
      log.info('All table data cleared successfully');
    })();
  } catch (error) {
    log.error('Failed to clear table data', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
