import { contextBridge, ipcRenderer } from 'electron';

console.log('[Preload] Script started');

// Inline IPC channels to avoid module resolution issues in preload context
const IPC_CHANNELS = {
  LIST_DOCUMENTS: 'documents:list',
  IMPORT_DOCUMENT: 'documents:import',
  GET_DOCUMENT: 'documents:get',
  GET_DOCUMENT_CONTENT: 'documents:get-content',
  DELETE_DOCUMENT: 'documents:delete',
  START_INDEXING: 'indexing:start',
  GET_INDEXING_STATUS: 'indexing:status',
  GET_CHUNKS: 'indexing:chunks',
  ASK_QUESTION: 'qa:ask',
  GET_HISTORY: 'qa:history',
  CLEAR_HISTORY: 'qa:clear-history',
  SUBMIT_FEEDBACK: 'feedback:submit',
  LIST_FEEDBACK: 'feedback:list',
  GET_STATUS: 'app:status',
  SHOW_OPEN_DIALOG: 'dialog:show-open',
} as const;

console.log('[Preload] IPC_CHANNELS:', IPC_CHANNELS);

const api = {
  documents: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_DOCUMENTS),
    import: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_DOCUMENT, filePath),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_DOCUMENT, id),
    getContent: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_DOCUMENT_CONTENT, id),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_DOCUMENT, id),
  },
  dialog: {
    showOpenDialog: () => {
      console.log('[Preload] showOpenDialog called, invoking:', IPC_CHANNELS.SHOW_OPEN_DIALOG);
      return ipcRenderer.invoke(IPC_CHANNELS.SHOW_OPEN_DIALOG);
    },
  },
  indexing: {
    start: (documentId?: string) => ipcRenderer.invoke(IPC_CHANNELS.START_INDEXING, documentId),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.GET_INDEXING_STATUS),
    chunks: (documentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_CHUNKS, documentId),
  },
  qa: {
    ask: (question: string) => ipcRenderer.invoke(IPC_CHANNELS.ASK_QUESTION, question),
    history: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
    clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),
  },
  feedback: {
    submit: (responseTimestamp: string, question: string, rating: 'positive' | 'negative') =>
      ipcRenderer.invoke(IPC_CHANNELS.SUBMIT_FEEDBACK, responseTimestamp, question, rating),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_FEEDBACK),
  },
};

console.log('[Preload] Exposing knowledgeBase API with dialog:', !!api.dialog);
console.log('[Preload] API keys:', Object.keys(api));

try {
  contextBridge.exposeInMainWorld('knowledgeBase', api);
  console.log('[Preload] ✅ Successfully exposed knowledgeBase to window');
  console.log('[Preload] Verification: api.dialog exists?', !!api.dialog);
  console.log('[Preload] Verification: api.dialog.showOpenDialog exists?', !!(api.dialog && api.dialog.showOpenDialog));
} catch (error) {
  console.error('[Preload] ❌ Failed to expose knowledgeBase:', error);
}
