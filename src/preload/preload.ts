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
  REBUILD_EMBEDDINGS: 'indexing:rebuild-embeddings',
  INDEXING_PROGRESS: 'indexing:progress',
  ASK_QUESTION: 'qa:ask',
  GET_HISTORY: 'qa:history',
  CLEAR_HISTORY: 'qa:clear-history',
  RETRIEVE_DEBUG: 'qa:retrieve-debug',
  SUBMIT_FEEDBACK: 'feedback:submit',
  LIST_FEEDBACK: 'feedback:list',
  GET_STATUS: 'app:status',
  SHOW_OPEN_DIALOG: 'dialog:show-open',
  RESET_DATA: 'app:reset',
  LLM_HEALTH: 'llm:health',
  ASK_QUESTION_STREAM: 'qa:ask-stream',
  STREAM_CHUNK: 'qa:stream-chunk',
  STREAM_DONE: 'qa:stream-done',
  CANCEL_QUESTION: 'qa:cancel',
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',
  LLM_SETTINGS_GET: 'llm:settings:get',
  LLM_SETTINGS_SET: 'llm:settings:set',
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
    rebuildEmbeddings: () => ipcRenderer.invoke(IPC_CHANNELS.REBUILD_EMBEDDINGS),
    onProgress: (callback: (data: { processed: number; total: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { processed: number; total: number }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.INDEXING_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.INDEXING_PROGRESS, handler);
    },
  },
  qa: {
    ask: (question: string) => ipcRenderer.invoke(IPC_CHANNELS.ASK_QUESTION, question),
    askStream: (question: string) => ipcRenderer.invoke(IPC_CHANNELS.ASK_QUESTION_STREAM, question),
    cancel: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_QUESTION, requestId),
    onStreamChunk: (callback: (data: { requestId: string; chunk: { type: string; content?: string; error?: string } }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; chunk: { type: string; content?: string; error?: string } }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.STREAM_CHUNK, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.STREAM_CHUNK, handler);
    },
    onStreamDone: (callback: (data: { requestId: string; response?: unknown; error?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; response?: unknown; error?: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.STREAM_DONE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.STREAM_DONE, handler);
    },
    history: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
    clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),
    retrieveDebug: (question: string, opts?: { mode?: 'hybrid' | 'bm25' | 'vector' }) =>
      ipcRenderer.invoke(IPC_CHANNELS.RETRIEVE_DEBUG, question, opts),
  },
  feedback: {
    submit: (responseTimestamp: string, question: string, rating: 'positive' | 'negative') =>
      ipcRenderer.invoke(IPC_CHANNELS.SUBMIT_FEEDBACK, responseTimestamp, question, rating),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_FEEDBACK),
  },
  app: {
    resetData: () => ipcRenderer.invoke(IPC_CHANNELS.RESET_DATA),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
    set: (partial: Partial<import('../shared/types').RetrievalSettings>) => ipcRenderer.invoke(IPC_CHANNELS.SET_SETTINGS, partial),
  },
  llmSettings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_SETTINGS_GET) as Promise<import('../shared/types').LlmSettings>,
    set: (partial: Partial<import('../shared/types').LlmSettings>) =>
      ipcRenderer.invoke(IPC_CHANNELS.LLM_SETTINGS_SET, partial) as Promise<import('../shared/types').LlmSettings>,
  },
  llm: {
    health: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_HEALTH),
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
