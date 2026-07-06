/// <reference types="react" />
/// <reference types="react-dom" />

declare global {
  interface Window {
    knowledgeBase: {
      documents: {
        list: () => Promise<import('../shared/types').Document[]>;
        import: (filePath: string) => Promise<import('../shared/types').Document>;
        get: (id: string) => Promise<import('../shared/types').Document | null>;
        getContent: (id: string) => Promise<string | null>;
        delete: (id: string) => Promise<boolean>;
      };
      indexing: {
        start: (documentId?: string) => Promise<import('../shared/types').AppStatus>;
        status: () => Promise<import('../shared/types').AppStatus>;
        chunks: (documentId: string) => Promise<import('../shared/types').Chunk[]>;
      };
      qa: {
        ask: (question: string) => Promise<import('../shared/types').QAResponse>;
        askStream: (question: string) => Promise<string>;
        cancel: (requestId: string) => Promise<{ cancelled: boolean }>;
        onStreamChunk: (callback: (data: { requestId: string; chunk: { type: string; content?: string; error?: string } }) => void) => () => void;
        onStreamDone: (callback: (data: { requestId: string; response?: import('../shared/types').QAResponse; error?: string }) => void) => () => void;
        history: () => Promise<import('../shared/types').QAHistory[]>;
        clearHistory: () => Promise<void>;
        retrieveDebug: (question: string, opts?: { mode?: 'hybrid' | 'bm25' | 'vector' }) => Promise<{
          bm25Results: Array<{ rowid: number; score: number; rank: number }>;
          vectorResults: Array<{ rowid: number; distance: number; rank: number }>;
          fusedResults: Array<unknown>;
        }>;
      };
      feedback: {
        submit: (responseTimestamp: string, question: string, rating: 'positive' | 'negative') => Promise<import('../shared/types').FeedbackEntry>;
        list: () => Promise<import('../shared/types').FeedbackEntry[]>;
      };
      dialog: {
        showOpenDialog: () => Promise<string | null>;
      };
      app: {
        resetData: () => Promise<void>;
        readFile: (filePath: string) => Promise<{ name: string; content: string; type: string } | null>;
      };
      settings: {
        get: () => Promise<import('../shared/types').RetrievalSettings>;
        set: (partial: Partial<import('../shared/types').RetrievalSettings>) => Promise<import('../shared/types').RetrievalSettings>;
      };
      llmSettings: {
        get: () => Promise<import('../shared/types').LlmSettings>;
        set: (partial: Partial<import('../shared/types').LlmSettings>) => Promise<import('../shared/types').LlmSettings>;
      };
      llm: {
        health: () => Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }>;
      };
      sessions: {
        list: () => Promise<import('../shared/types').Session[]>;
        create: (title?: string) => Promise<import('../shared/types').Session>;
        get: (id: string) => Promise<import('../shared/types').Session | null>;
        getMessages: (sessionId: string) => Promise<import('../shared/types').ChatMessageData[]>;
        update: (id: string, data: { title?: string }) => Promise<import('../shared/types').Session | null>;
        delete: (id: string) => Promise<void>;
      };
      chat: {
        send: (req: { sessionId: string; text: string; tools?: import('../shared/types').ChatTools }) => Promise<any>;
        sendStream: (req: { sessionId: string; text: string; tools?: import('../shared/types').ChatTools; requestId: string }) => void;
        cancel: (requestId: string) => void;
        onStreamChunk: (callback: (data: any) => void) => () => void;
        onStreamDone: (callback: (data: any) => void) => () => void;
      };
    };
  }
}

export {};
