import Database from 'better-sqlite3';
import { logger } from './logger.js';
import { SessionService, AddMessageInput } from './session-service.js';
import type { ChatTools } from '../shared/types.js';
import type { Citation } from '../shared/types.js';
import type { LlmProvider, StreamChunk, ChatMessage as ProviderChatMessage, TokenUsage } from './providers/types.js';
import type { HybridSearchResult } from './retriever.js';
import type { WebSearchResult } from './web-search-service.js';

const log = logger.forService('chat-service');

type ChatResult = {
  content: string;
  tokensUsed?: TokenUsage;
  model?: string;
  citations?: Citation[];
  webResults?: WebSearchResult[];
};

export class ChatService {
  private db: Database.Database;
  private llmProvider: LlmProvider | null;
  private sessionService: SessionService;
  private retriever?: (query: string) => Promise<HybridSearchResult[]>;
  private webSearchService?: { search: (query: string) => Promise<WebSearchResult[]> };
  private systemPrompt: string;

  constructor(
    db: Database.Database,
    llmProvider: LlmProvider | null,
    sessionService: SessionService,
    retriever?: (query: string) => Promise<HybridSearchResult[]>,
    webSearchService?: { search: (query: string) => Promise<WebSearchResult[]> },
    systemPrompt?: string,
  ) {
    this.db = db;
    this.llmProvider = llmProvider;
    this.sessionService = sessionService;
    this.retriever = retriever;
    this.webSearchService = webSearchService;
    this.systemPrompt = systemPrompt || 'You are a helpful AI assistant. Answer the user\'s question concisely and accurately.';
    log.info('ChatService initialized', { hasRetriever: !!retriever, hasWebSearch: !!webSearchService });
  }

  async sendMessage(
    sessionId: string,
    text: string,
    tools: ChatTools = { kbEnabled: false, webEnabled: false },
  ): Promise<ChatResult> {
    const start = Date.now();
    log.info('Chat message', { sessionId, textLength: text.length, tools: tools ? { kbEnabled: !!tools.kbEnabled, webEnabled: !!tools.webEnabled, fileCount: tools.files?.length } : {} });

    const userMessage: AddMessageInput = {
      role: 'user',
      content: text,
      toolsConfig: { kbEnabled: tools.kbEnabled, webEnabled: tools.webEnabled, fileCount: tools.files?.length || 0 },
    };
    this.sessionService.addMessage(sessionId, userMessage);

    const citations = tools.kbEnabled ? await this.searchKnowledgeBase(text) : [];
    const webResults = tools.webEnabled ? await this.searchWeb(text) : [];
    const fileContents = tools.files?.map(f => ({ name: f.name, content: f.content })) || [];

    const messages = this.buildPrompt(text, citations, webResults, fileContents);
    const history = this.sessionService.getMessages(sessionId);
    const recentHistory = history.slice(-6, -1);
    for (const h of recentHistory) {
      messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
    }
    messages.push({ role: 'user', content: text });

    try {
      if (!this.llmProvider) {
        const duration = Date.now() - start;
        const fallbackContent = 'LLM not configured. Set your NVIDIA API key in the .env file and restart.';

        const assistantMsg: AddMessageInput = {
          role: 'assistant',
          content: fallbackContent,
        };
        this.sessionService.addMessage(sessionId, assistantMsg);
        this.autoTitle(sessionId, text);

        log.info('Chat response: LLM not configured', { durationMs: duration });
        return { content: fallbackContent };
      }

      const response = await this.llmProvider.chat(messages, {});
      const duration = Date.now() - start;

      const assistantMsg: AddMessageInput = {
        role: 'assistant',
        content: response.content,
        tokensUsed: response.usage ? { prompt: response.usage.prompt, completion: response.usage.completion, total: response.usage.total } : undefined,
        model: response.model || undefined,
        citations: citations.length > 0 ? citations : undefined,
        webResults: webResults.length > 0 ? webResults : undefined,
        uploadedFiles: tools.files?.map(f => ({ name: f.name, type: f.type, size: f.content.length })) || undefined,
      };
      this.sessionService.addMessage(sessionId, assistantMsg);

      this.autoTitle(sessionId, text);

      log.info('Chat response generated', { durationMs: duration, contentLength: response.content.length, tokens: response.usage?.total });

      return {
        content: response.content,
        tokensUsed: assistantMsg.tokensUsed,
        model: response.model || undefined,
        citations,
        webResults,
      };
    } catch (err) {
      const duration = Date.now() - start;
      log.error('Chat response failed', { durationMs: duration, error: String(err) });
      throw err;
    }
  }

  async sendStream(
    sessionId: string,
    text: string,
    tools: ChatTools = { kbEnabled: false, webEnabled: false },
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    log.info('Chat stream starting', { sessionId, textLength: text.length });

    const userMessage: AddMessageInput = {
      role: 'user',
      content: text,
      toolsConfig: { kbEnabled: tools.kbEnabled, webEnabled: tools.webEnabled, fileCount: tools.files?.length || 0 },
    };
    this.sessionService.addMessage(sessionId, userMessage);

    const citations = tools.kbEnabled ? await this.searchKnowledgeBase(text) : [];
    const webResults = tools.webEnabled ? await this.searchWeb(text) : [];
    const fileContents = tools.files?.map(f => ({ name: f.name, content: f.content })) || [];

    const messages = this.buildPrompt(text, citations, webResults, fileContents);
    const history = this.sessionService.getMessages(sessionId);
    const recentHistory = history.slice(-6, -1);
    for (const h of recentHistory) {
      messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
    }
    messages.push({ role: 'user', content: text });

    let fullContent = '';
    let lastUsage: any;

    try {
      if (!this.llmProvider) {
        const fallbackContent = 'LLM not configured. Set your NVIDIA API key in the .env file and restart.';
        const assistantMsg: AddMessageInput = {
          role: 'assistant',
          content: fallbackContent,
        };
        this.sessionService.addMessage(sessionId, assistantMsg);
        this.autoTitle(sessionId, text);
        onChunk({ type: 'delta', content: fallbackContent });
        onChunk({ type: 'done', content: fallbackContent });
        return;
      }

      const stream = this.llmProvider.chatStream(messages, { signal });

      for await (const chunk of stream) {
        if (chunk.type === 'delta') {
          fullContent += chunk.content || '';
          onChunk(chunk);
        } else if (chunk.type === 'done') {
          lastUsage = chunk.usage;
          const assistantMsg: AddMessageInput = {
            role: 'assistant',
            content: fullContent,
            tokensUsed: lastUsage ? { prompt: lastUsage.prompt, completion: lastUsage.completion, total: lastUsage.total } : undefined,
            model: chunk.model || undefined,
            citations: citations.length > 0 ? citations : undefined,
            webResults: webResults.length > 0 ? webResults : undefined,
            uploadedFiles: tools.files?.map(f => ({ name: f.name, type: f.type, size: f.content.length })) || undefined,
          };
          this.sessionService.addMessage(sessionId, assistantMsg);
          this.autoTitle(sessionId, text);
          onChunk({ type: 'done', content: fullContent, usage: lastUsage, model: chunk.model, citations, webResults } as any);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        log.debug('Chat stream cancelled', { sessionId });
        if (fullContent) {
          const assistantMsg: AddMessageInput = {
            role: 'assistant',
            content: fullContent + '\n\n*[cancelled]*',
            citations: citations.length > 0 ? citations : undefined,
            webResults: webResults.length > 0 ? webResults : undefined,
          };
          this.sessionService.addMessage(sessionId, assistantMsg);
        }
        return;
      }
      log.error('Chat stream error', { sessionId, error: String(err) });
      throw err;
    }
  }

  private async searchKnowledgeBase(query: string): Promise<Citation[]> {
    if (!this.retriever) return [];
    try {
      const results = await this.retriever(query);
      log.info('KB search for chat', { queryLength: query.length, resultCount: results.length });
      const getDocTitle = this.db.prepare('SELECT title FROM documents WHERE id = ?').pluck();
      return results.map(r => ({
        documentTitle: (getDocTitle.get(r.chunk.documentId) as string) || 'Unknown',
        documentId: r.chunk.documentId,
        chunkIndex: r.chunk.idx,
        excerpt: r.chunk.content.substring(0, 200),
        confidence: r.fusedScore,
        sources: r.sources,
      }));
    } catch (err) {
      log.error('KB search failed in chat', { error: String(err) });
      return [];
    }
  }

  private async searchWeb(query: string): Promise<WebSearchResult[]> {
    if (!this.webSearchService) return [];
    try {
      return await this.webSearchService.search(query);
    } catch (err) {
      log.error('Web search failed in chat', { error: String(err) });
      return [];
    }
  }

  private buildPrompt(
    _text: string,
    citations: Citation[],
    webResults: WebSearchResult[],
    fileContents: { name: string; content: string }[],
  ): ProviderChatMessage[] {
    const parts: string[] = [this.systemPrompt];

    if (citations.length > 0) {
      parts.push('\n\n## Knowledge Base Results\nAnswer based on these document excerpts. Cite the document title for each claim.');
      for (const c of citations) {
        parts.push(`\n[${c.documentTitle}]: ${c.excerpt}`);
      }
    }

    if (webResults.length > 0) {
      parts.push('\n\n## Web Search Results\nUse these search results to answer. Include source URLs.');
      for (const r of webResults) {
        parts.push(`\n[${r.title}](${r.url}): ${r.content}`);
      }
    }

    if (fileContents.length > 0) {
      parts.push('\n\n## Uploaded Files\nThe user uploaded the following files. Answer based on their content.');
      for (const f of fileContents) {
        parts.push(`\n--- File: ${f.name} ---\n${f.content}`);
      }
    }

    return [{ role: 'system', content: parts.join('\n') }];
  }

  private autoTitle(sessionId: string, text: string): void {
    const session = this.sessionService.getSession(sessionId);
    if (session && session.title === 'New Chat' && text.trim()) {
      this.sessionService.setAutoTitle(sessionId, text);
    }
  }
}
