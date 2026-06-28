import { IpcMain, dialog, BrowserWindow } from 'electron';
import { DocumentService } from '../services/document-service';
import { IndexingService } from '../services/indexing-service';
import { QaService } from '../services/qa-service';
import { PersistenceService } from '../services/persistence-service';
import { IPC_CHANNELS } from '../shared/types';
import { logger } from '../services/logger';
import { clearAllData } from '../services/db';

const log = logger.forService('IPC');

export interface Services {
  documentService: DocumentService;
  indexingService: IndexingService;
  qaService: QaService;
  persistenceService: PersistenceService;
}

export function registerIpcHandlers(ipcMain: IpcMain, services: Services) {
  const { documentService, indexingService, qaService, persistenceService } = services;

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
