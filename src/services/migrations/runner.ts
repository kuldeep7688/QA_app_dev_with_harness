import type Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger.js';

const log = logger.forService('migrations');

/**
 * Migration runner with schema_meta version tracking.
 * Runs migrations in order, skipping already applied ones.
 * Each migration runs in a transaction.
 */

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Initialize schema_meta table if it doesn't exist
 */
function initSchemaMeta(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  
  // Insert version 0 if not exists
  const stmt = db.prepare('INSERT OR IGNORE INTO schema_meta (key, value) VALUES (?, ?)');
  stmt.run('version', '0');
}

/**
 * Get current schema version from schema_meta table
 */
function getCurrentVersion(db: Database.Database): number {
  const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version') as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

/**
 * Set schema version in schema_meta table
 */
function setVersion(db: Database.Database, version: number): void {
  db.prepare('UPDATE schema_meta SET value = ? WHERE key = ?').run(version.toString(), 'version');
}

/**
 * Load all migration files from src/services/migrations/
 */
function loadMigrations(): Migration[] {
  const migrationsDir = join(__dirname, '.');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  const migrations: Migration[] = [];
  
  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      log.warn('Skipping invalid migration filename', { file });
      continue;
    }
    
    const version = parseInt(match[1], 10);
    const name = match[2];
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    
    migrations.push({ version, name, sql });
  }
  
  return migrations;
}

/**
 * Run all pending migrations in order
 */
export function runMigrations(db: Database.Database): void {
  log.info('Starting migration runner');
  
  // Initialize schema_meta table
  initSchemaMeta(db);
  
  const currentVersion = getCurrentVersion(db);
  log.info('Current schema version', { currentVersion });
  
  const migrations = loadMigrations();
  log.info('Loaded migrations', { count: migrations.length });
  
  let applied = 0;
  
  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      log.debug('Skipping already applied migration', { 
        version: migration.version, 
        name: migration.name 
      });
      continue;
    }
    
    log.info('Applying migration', { 
      version: migration.version, 
      name: migration.name 
    });
    
    try {
      // Run migration in transaction
      const transaction = db.transaction(() => {
        db.exec(migration.sql);
        setVersion(db, migration.version);
      });
      
      transaction();
      
      log.info('Migration applied successfully', { 
        version: migration.version, 
        name: migration.name 
      });
      applied++;
    } catch (error) {
      log.error('Migration failed', { 
        version: migration.version, 
        name: migration.name,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  
  const finalVersion = getCurrentVersion(db);
  log.info('Migration runner complete', { 
    appliedCount: applied,
    currentVersion: finalVersion
  });
}
