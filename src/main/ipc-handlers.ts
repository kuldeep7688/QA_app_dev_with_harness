import { IpcMain, dialog, BrowserWindow } from 'electron';
import { DocumentService } from '../services/document-service';
import { IndexingService } from '../services/indexing-service';
import { QaService } from '../services/qa-service';
import { PersistenceService } from '../services/persistence-service';
import { SettingsService } from '../services/settings-service';
import { IPC_CHANNELS } from '../shared/types';
import { logger } from '../services/logger';
import { clearAllData } from '../services/db';
import type { LlmProvider } from '../services/providers/types';
import type { StreamChunk } from '../services/providers/types';

const log = logger.forService('IPC');

export interface Services {
  documentService: DocumentService;
  indexingService: IndexingService;
  qaService: QaService;
  persistenceService: PersistenceService;
  settingsService: SettingsService;
  llmProvider?: LlmProvider | null;
}

const activeStreams = new Map<string, AbortController>();

export function registerIpcHandlers(ipcMain: IpcMain, services: Services) {
  const { documentService, indexingService, qaService, persistenceService, settingsService } = services;

  // Document operations
  ipcMain.handle(IPC_CHANNELS.LIST_DOCUMENTS, async () => {
    log.debug('IPC received', { channel: IPC_CHANNELS.LIST_DOCUMENTS });
    return documentService.listDocuments();
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_DOCUMENT, async (_event, filePath: string) => {
    log.info('IPC received', { channel: IPC_CHANNELS.IMPORT_DOCUMENT, filePath });
    return documentService.importDocument(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.GET_DOCUMENT, async (_event, id: string) => {
    log.debug('IPC received', { channel: IPC_CHANNELS.GET_DOCUMENT, id });
    return documentService.getDocument(id);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_DOCUMENT, async (_event, id: string) => {
    log.info('IPC received', { channel: IPC_CHANNELS.DELETE_DOCUMENT, id });
    return documentService.deleteDocument(id);
  });

  // Document content retrieval
  ipcMain.handle(IPC_CHANNELS.GET_DOCUMENT_CONTENT, async (_event, id: string) => {
    log.debug('IPC received', { channel: IPC_CHANNELS.GET_DOCUMENT_CONTENT, id });
    return documentService.getDocumentContent(id);
  });

  // Indexing
  ipcMain.handle(IPC_CHANNELS.START_INDEXING, async (_event, documentId?: string) => {
    log.info('IPC received', { channel: IPC_CHANNELS.START_INDEXING, documentId });
    return indexingService.startIndexing(documentId);
  });

  ipcMain.handle(IPC_CHANNELS.GET_INDEXING_STATUS, async () => {
    log.debug('IPC received', { channel: IPC_CHANNELS.GET_INDEXING_STATUS });
    return indexingService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.GET_CHUNKS, async (_event, documentId: string) => {
    log.debug('IPC received', { channel: IPC_CHANNELS.GET_CHUNKS, documentId });
    return indexingService.getChunksForDocument(documentId);
  });

  // Q&A
  ipcMain.handle(IPC_CHANNELS.ASK_QUESTION, async (_event, question: string) => {
    log.info('IPC received', { channel: IPC_CHANNELS.ASK_QUESTION, question: question.substring(0, 100) });
    return qaService.ask(question);
  });

  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async () => {
    log.debug('IPC received', { channel: IPC_CHANNELS.GET_HISTORY });
    return qaService.getHistory();
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_HISTORY, async () => {
    log.info('IPC received', { channel: IPC_CHANNELS.CLEAR_HISTORY });
    return qaService.clearHistory();
  });

  // Streaming Q&A
  ipcMain.handle(IPC_CHANNELS.ASK_QUESTION_STREAM, async (event, question: string) => {
    log.info('IPC received', { channel: IPC_CHANNELS.ASK_QUESTION_STREAM, question: question.substring(0, 100) });
    const requestId = crypto.randomUUID();
    const win = BrowserWindow.fromWebContents(event.sender);

    if (!win) {
      return { requestId, error: 'Window not available' };
    }

    const controller = new AbortController();
    activeStreams.set(requestId, controller);

    const onChunk = (chunk: StreamChunk) => {
      if (win.isDestroyed()) return;
      win.webContents.send(IPC_CHANNELS.STREAM_CHUNK, { requestId, chunk });
    };

    qaService.askStream(question, onChunk, controller.signal)
      .then((response) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.STREAM_DONE, { requestId, response });
        }
      })
      .catch((error: unknown) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.STREAM_DONE, {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })
      .finally(() => {
        activeStreams.delete(requestId);
      });

    return requestId;
  });

  // Cancel streaming
  ipcMain.handle(IPC_CHANNELS.CANCEL_QUESTION, async (_event, requestId: string) => {
    log.info('IPC received', { channel: IPC_CHANNELS.CANCEL_QUESTION, requestId });
    const controller = activeStreams.get(requestId);
    if (controller) {
      controller.abort();
      activeStreams.delete(requestId);
      return { cancelled: true };
    }
    return { cancelled: false };
  });

  // Retrieval debug
  ipcMain.handle(IPC_CHANNELS.RETRIEVE_DEBUG, async (_event, question: string, opts?: { mode?: 'hybrid' | 'bm25' | 'vector' }) => {
    log.debug('IPC received', { channel: IPC_CHANNELS.RETRIEVE_DEBUG, question: question.substring(0, 100), mode: opts?.mode });
    return qaService.retrieveDebug(question, opts);
  });

  // Feedback
  ipcMain.handle(IPC_CHANNELS.SUBMIT_FEEDBACK, async (_event, responseTimestamp: string, question: string, rating: 'positive' | 'negative') => {
    log.info('IPC received', { channel: IPC_CHANNELS.SUBMIT_FEEDBACK, rating, question: question.substring(0, 100) });
    return qaService.submitFeedback(responseTimestamp, question, rating);
  });

  ipcMain.handle(IPC_CHANNELS.LIST_FEEDBACK, async () => {
    log.debug('IPC received', { channel: IPC_CHANNELS.LIST_FEEDBACK });
    return qaService.getFeedback();
  });

  // Dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_OPEN_DIALOG, async (event) => {
    log.debug('SHOW_OPEN_DIALOG handler called');
    const window = BrowserWindow.fromWebContents(event.sender);
    
    if (!window) {
      log.error('Could not find window for dialog');
      return null;
    }
    
    try {
      log.debug('Opening file dialog');
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        filters: [
          { name: 'Documents', extensions: ['txt', 'md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        log.debug('File dialog canceled by user');
        return null;
      }
      
      log.info('File selected', { filePath: result.filePaths[0] });
      return result.filePaths[0];
    } catch (error) {
      log.error('Error showing open dialog', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });

  // Rebuild embeddings
  ipcMain.handle(IPC_CHANNELS.REBUILD_EMBEDDINGS, async (event) => {
    log.info('IPC received', { channel: IPC_CHANNELS.REBUILD_EMBEDDINGS });
    const win = BrowserWindow.fromWebContents(event.sender);
    const sendProgress = (processed: number, total: number) => {
      win?.webContents.send(IPC_CHANNELS.INDEXING_PROGRESS, { processed, total });
    };
    return indexingService.rebuildEmbeddings(sendProgress);
  });

  // LLM health check
  ipcMain.handle(IPC_CHANNELS.LLM_HEALTH, async () => {
    log.info('IPC received', { channel: IPC_CHANNELS.LLM_HEALTH });

    if (!services.llmProvider) {
      return { ok: false, error: 'LLM not configured. Add your NVIDIA API key to .env', latencyMs: 0 };
    }

    try {
      const result = await services.llmProvider.checkHealth();
      return result;
    } catch (error: unknown) {
      log.error('LLM health check error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: 'LLM service unavailable. Check your connection.' };
    }
  });

  // Settings
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    log.debug('IPC received', { channel: IPC_CHANNELS.GET_SETTINGS });
    return settingsService.get();
  });

  ipcMain.handle(IPC_CHANNELS.SET_SETTINGS, async (_event, partial: Partial<import('../shared/types').RetrievalSettings>) => {
    log.info('IPC received', { channel: IPC_CHANNELS.SET_SETTINGS, partial });
    return settingsService.set(partial);
  });

  // LLM Settings
  ipcMain.handle(IPC_CHANNELS.LLM_SETTINGS_GET, async () => {
    log.debug('IPC received', { channel: IPC_CHANNELS.LLM_SETTINGS_GET });
    return settingsService.getLlmSettings();
  });

  ipcMain.handle(IPC_CHANNELS.LLM_SETTINGS_SET, async (_event, partial: Partial<import('../shared/types').LlmSettings>) => {
    log.info('IPC received', { channel: IPC_CHANNELS.LLM_SETTINGS_SET, partial });
    return settingsService.setLlmSettings(partial);
  });

  // App reset
  ipcMain.handle(IPC_CHANNELS.RESET_DATA, async () => {
    log.info('IPC received', { channel: IPC_CHANNELS.RESET_DATA });
    
    // Clear all data from database tables (keeps schema intact)
    clearAllData();
    log.info('Database tables cleared');
    
    // Clear filesystem data (documents and index files, but not database files)
    persistenceService.resetAll();
    log.info('Filesystem data cleared');
  });

  const registeredChannels = Object.values(IPC_CHANNELS);
  log.info('IPC handlers registered', { channels: registeredChannels, count: registeredChannels.length });
}
