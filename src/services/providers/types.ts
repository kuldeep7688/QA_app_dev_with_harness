export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  content: string;
  usage?: TokenUsage;
  model?: string;
}

export interface StreamChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;
  usage?: TokenUsage;
  model?: string;
  error?: string;
}

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  systemPrompt?: string;
}

export interface LlmProvider {
  chat(messages: ChatMessage[], opts?: LlmOptions): Promise<ChatResponse>;
  chatStream(messages: ChatMessage[], opts?: LlmOptions): AsyncIterable<StreamChunk>;
  checkHealth(): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }>;
}
