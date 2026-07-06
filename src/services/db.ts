import Database from 'better-sqlite3';
import * as path from 'path';
import { logger } from './logger';

const log = logger.forService('database');

let dbInstance: Database.Database | null = null;
let vectorExtensionLoaded = false;

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
    
    // Try to load sqlite-vec extension
    vectorExtensionLoaded = loadVectorExtension(dbInstance);
    
    log.info('SQLite database initialized', {
      dbPath,
      sqliteVersion,
      walMode,
      foreignKeysEnabled: fkEnabled === 1,
      userVersion: version,
      vectorExtensionLoaded,
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
    vectorExtensionLoaded = false;
  }
}

/**
 * Reset database instance (for testing).
 */
export function resetDatabaseInstance(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    vectorExtensionLoaded = false;
  }
}

/**
 * Load the sqlite-vec vector extension.
 * Returns true if loaded successfully, false otherwise.
 * Graceful fallback: if loading fails, app continues in BM25-only mode.
 */
function loadVectorExtension(db: Database.Database): boolean {
  try {
    // Attempt to load sqlite-vec extension
    // The extension provides vec0 virtual table for vector similarity search
    const sqliteVec = require('sqlite-vec');
    
    // Load the extension into the database
    sqliteVec.load(db);
    
    // Verify the extension loaded by checking for vec_version()
    const versionCheck = db.prepare('SELECT vec_version()').pluck().get();
    
    log.info('sqlite-vec extension loaded successfully', {
      vecVersion: versionCheck,
    });
    
    return true;
  } catch (error) {
    log.error('Failed to load sqlite-vec extension. Vector search disabled. App will run in BM25-only mode.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if vector extension is loaded and available.
 */
export function isVectorExtensionLoaded(): boolean {
  return vectorExtensionLoaded;
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
      db.prepare('DELETE FROM chat_messages').run();
      db.prepare('DELETE FROM sessions').run();
      db.prepare('DELETE FROM chunks_fts').run();  // FTS5 virtual table
      
      // Only clear chunks_vec if vector extension is loaded
      if (vectorExtensionLoaded) {
        try {
          db.prepare('DELETE FROM chunks_vec').run();
        } catch (error) {
          log.warn('Failed to clear chunks_vec table (may not exist)', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
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
