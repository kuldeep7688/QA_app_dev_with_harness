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
  modelUsed?: string;
  tokensUsed?: TokenUsage;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
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
  vectorEnabled: boolean;
  llmEnabled: boolean;
  llmStatus?: 'healthy' | 'unhealthy' | 'disabled';
  llmModel?: string;
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

  // LLM
  LLM_HEALTH: 'llm:health',
  ASK_QUESTION_STREAM: 'qa:ask-stream',
  STREAM_CHUNK: 'qa:stream-chunk',
  STREAM_DONE: 'qa:stream-done',
  CANCEL_QUESTION: 'qa:cancel',

  // Settings
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',

  // LLM Settings
  LLM_SETTINGS_GET: 'llm:settings:get',
  LLM_SETTINGS_SET: 'llm:settings:set',

  // App
  RESET_DATA: 'app:reset',
  READ_FILE: 'app:read-file',

  // Sessions
  SESSIONS_LIST: 'sessions:list',
  SESSIONS_CREATE: 'sessions:create',
  SESSIONS_GET: 'sessions:get',
  SESSIONS_GET_MESSAGES: 'sessions:get-messages',
  SESSIONS_UPDATE: 'sessions:update',
  SESSIONS_DELETE: 'sessions:delete',

  // Chat
  CHAT_SEND: 'chat:send',
  CHAT_SEND_STREAM: 'chat:send-stream',
  CHAT_CANCEL: 'chat:cancel',
  CHAT_STREAM_CHUNK: 'chat:stream-chunk',
  CHAT_STREAM_DONE: 'chat:stream-done',
} as const;

export interface RetrievalSettings {
  retrievalMode: 'hybrid' | 'bm25' | 'vector';
  topK: number;
  topN: number;
  rrfK: number;
  embeddingsEnabled: boolean;
}

export interface LlmSettings {
  modelName: string;
  temperature: number;
  maxTokens: number;
  streamEnabled: boolean;
  systemPrompt: string;
}

export interface FeedbackEntry {
  id: string;
  responseTimestamp: string;
  question: string;
  rating: 'positive' | 'negative';
  submittedAt: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface UploadedFileData {
  name: string;
  content: string;
  type: string;
}

export interface ChatTools {
  kbEnabled: boolean;
  webEnabled: boolean;
  files?: UploadedFileData[];
}

export interface ChatMessageData {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolsConfig?: ChatTools;
  citations?: Citation[];
  webResults?: Array<{ title: string; url: string; content: string }>;
  uploadedFiles?: Array<{ name: string; type: string; size: number }>;
  tokensUsed?: TokenUsage;
  model?: string;
  createdAt: string;
}
