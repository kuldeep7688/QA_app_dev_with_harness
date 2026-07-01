import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { DocumentService } from '../services/document-service';
import { QaService } from '../services/qa-service';
import { IndexingService } from '../services/indexing-service';
import { PersistenceService } from '../services/persistence-service';
import { SettingsService } from '../services/settings-service';
import { initDatabase } from '../services/db';
import { runMigrations } from '../services/migrations/runner';
import { LegacyImporter } from '../services/legacy-importer';
import { logger } from '../services/logger';
import { loadEnvConfig, isLLMEnabled } from '../services/env-config';
import { embed } from '../services/embedding-service';
import { NvidiaProvider } from '../services/providers/nvidia-provider';
import type { LlmProvider } from '../services/providers/types';

const log = logger.forService('Main');

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');
  const preloadExists = require('fs').existsSync(preloadPath);
  
  log.info('Creating window', {
    preloadPath,
    preloadExists,
    dirname: __dirname,
  });
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Knowledge Base',
  });

  log.info('Window created, loading renderer');
  
  // Listen for preload errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error('Failed to load renderer', { errorCode, errorDescription });
  });
  
  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    log.error('Preload script error', {
      preloadPath,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('Renderer finished loading');
  });

  // In development, load from Vite dev server or built renderer
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initializeServices() {
  // Load environment config before any services initialize
  loadEnvConfig();

  // Use project directory for data storage (easier for development)
  // In production, you might want to use app.getPath('userData') instead
  const dataDir = path.join(__dirname, '../../knowledge-base-data');
  const persistence = new PersistenceService(dataDir);
  
  // Initialize SQLite database
  log.info('Initializing database', { dataDir });
  const db = initDatabase(dataDir);
  
  // Run schema migrations
  log.info('Running schema migrations');
  runMigrations(db);
  
  // Check for legacy JSON import
  const dbPath = path.join(dataDir, 'index.db');
  if (LegacyImporter.shouldImport(dataDir, dbPath)) {
    log.info('Legacy JSON files detected, running one-time import');
    LegacyImporter.importLegacyData(db, dataDir);
    log.info('Legacy import completed successfully');
  }
  
  // Initialize settings service
  const settingsService = new SettingsService(persistence);

  // Initialize LLM provider if configured
  let llmProvider: LlmProvider | null = null;
  if (isLLMEnabled()) {
    try {
      llmProvider = new NvidiaProvider();
      log.info('LLM provider initialized');
    } catch (error) {
      log.error('Failed to initialize LLM provider', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Initialize services with database instance
  const documentService = new DocumentService(persistence, db);
  const indexingService = new IndexingService(persistence, db);
  const qaService = new QaService(db, embed, () => settingsService.get(), llmProvider);

  registerIpcHandlers(ipcMain, {
    documentService,
    indexingService,
    qaService,
    persistenceService: persistence,
    settingsService,
    llmProvider,
  });
}

app.whenReady().then(() => {
  initializeServices();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
