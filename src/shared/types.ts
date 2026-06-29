/** Cross-boundary type definitions shared between main, preload, and renderer. */

export interface Document {
  id: string;
  title: string;
  filename: string;
  importedAt: string;
  size: number;
  status: 'imported' | 'indexing' | 'indexed' | 'error';
  chunks?: number;
  wordCount?: number;
  lineCount?: number;
  fileType?: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  metadata: Record<string, string>;
}

export interface Citation {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  excerpt: string;
  confidence: number;
  bm25Rank?: number;
  vectorRank?: number;
  sources: Array<'bm25' | 'vector'>;
}

export interface QAResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
  timestamp: string;
}

export interface QAHistory {
  question: string;
  response: QAResponse;
}

export interface AppStatus {
  documentsLoaded: number;
  indexStatus: 'idle' | 'indexing' | 'ready' | 'error';
  lastActivity: string;
  indexedCount: number;
  vectorEnabled: boolean; // Whether sqlite-vec extension loaded successfully
}

/** IPC channel names -- single source of truth. */
export const IPC_CHANNELS = {
  // Document operations
  LIST_DOCUMENTS: 'documents:list',
  IMPORT_DOCUMENT: 'documents:import',
  GET_DOCUMENT: 'documents:get',
  GET_DOCUMENT_CONTENT: 'documents:get-content',
  DELETE_DOCUMENT: 'documents:delete',

  // Indexing
  START_INDEXING: 'indexing:start',
  GET_INDEXING_STATUS: 'indexing:status',
  GET_CHUNKS: 'indexing:chunks',
  REBUILD_EMBEDDINGS: 'indexing:rebuild-embeddings',
  INDEXING_PROGRESS: 'indexing:progress',

  // Q&A
  ASK_QUESTION: 'qa:ask',
  GET_HISTORY: 'qa:history',
  CLEAR_HISTORY: 'qa:clear-history',
  RETRIEVE_DEBUG: 'qa:retrieve-debug',

  // App status
  GET_STATUS: 'app:status',

  // Feedback
  SUBMIT_FEEDBACK: 'feedback:submit',
  LIST_FEEDBACK: 'feedback:list',

  // Dialog
  SHOW_OPEN_DIALOG: 'dialog:show-open',

  // App
  RESET_DATA: 'app:reset',
} as const;

export interface FeedbackEntry {
  id: string;
  responseTimestamp: string;
  question: string;
  rating: 'positive' | 'negative';
  submittedAt: string;
}
