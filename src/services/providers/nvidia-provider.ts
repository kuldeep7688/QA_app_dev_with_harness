import OpenAI from 'openai';
import { getEnvConfig } from '../env-config';
import { logger } from '../logger';
import type { ChatMessage, ChatResponse, StreamChunk, LlmOptions, LlmProvider, TokenUsage } from './types';

/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const log = logger.forService('NvidiaProvider');

export class NvidiaProvider implements LlmProvider {
  private client: OpenAI;
  private defaultModel: string;
  private baseUrl: string;

  constructor() {
    const config = getEnvConfig();
    this.defaultModel = config.modelName;
    this.baseUrl = config.baseUrl;
    this.client = new OpenAI({
      apiKey: config.nvidiaApiKey,
      baseURL: config.baseUrl,
    });
    log.info('NVIDIA NIM provider initialized', {
      model: this.defaultModel,
      baseUrl: this.baseUrl,
    });
  }

  private sanitizeMessages(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const model = this.defaultModel.toLowerCase();
    const supportsSystemRole = !model.includes('gemma');

    if (supportsSystemRole) {
      return messages.map(m => ({ role: m.role, content: m.content }));
    }

    const result: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    let pendingSystem = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        pendingSystem = msg.content;
      } else if (msg.role === 'user') {
        if (pendingSystem) {
          result.push({
            role: 'user',
            content: pendingSystem + '\n\nQuestion: ' + msg.content,
          });
          pendingSystem = '';
        } else {
          result.push({ role: 'user', content: msg.content });
        }
      } else {
        if (pendingSystem) {
          result.push({ role: 'user', content: pendingSystem });
          pendingSystem = '';
        }
        result.push({ role: msg.role, content: msg.content });
      }
    }

    return result;
  }

  async chat(messages: ChatMessage[], opts?: LlmOptions): Promise<ChatResponse> {
    const model = opts?.model ?? this.defaultModel;

    log.debug('Sending chat request', {
      model,
      messageCount: messages.length,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
    });

    const completion = await this.client.chat.completions.create({
      model,
      messages: this.sanitizeMessages(messages),
      temperature: opts?.temperature ?? 0.3,
      top_p: 0.7,
      max_tokens: opts?.maxTokens ?? 1024,
      stream: false,
    }, {
      signal: opts?.signal,
    });

    const content = completion.choices[0]?.message?.content ?? '';
    const usage = completion.usage ? {
      prompt: completion.usage.prompt_tokens,
      completion: completion.usage.completion_tokens,
      total: completion.usage.total_tokens,
    } : undefined;

    log.info('Chat response received', {
      model,
      contentLength: content.length,
      usage: usage ? `${usage.prompt}p / ${usage.completion}c / ${usage.total}t` : 'unknown',
    });

    return { content, usage, model };
  }

  async *chatStream(messages: ChatMessage[], opts?: LlmOptions): AsyncIterable<StreamChunk> {
    const model = opts?.model ?? this.defaultModel;

    log.debug('Starting stream request', {
      model,
      messageCount: messages.length,
      temperature: opts?.temperature,
    });

    let fullContent = '';
    let usage: TokenUsage | undefined;
    let promptText = '';

    try {
      for (const msg of messages) {
        promptText += msg.content + '\n';
      }

      const stream = await this.client.chat.completions.create({
        model,
        messages: this.sanitizeMessages(messages),
        temperature: opts?.temperature ?? 0.3,
        top_p: 0.7,
        max_tokens: opts?.maxTokens ?? 1024,
        stream: true,
      }, {
        signal: opts?.signal,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          yield { type: 'delta', content: delta };
        }

        if (chunk.usage) {
          usage = {
            prompt: chunk.usage.prompt_tokens,
            completion: chunk.usage.completion_tokens,
            total: chunk.usage.total_tokens,
          };
        }
      }

      // Estimate token usage if the API didn't return it in stream
      if (!usage) {
        const completionTokens = estimateTokens(fullContent);
        const promptTokens = estimateTokens(promptText);
        usage = { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens };
        log.debug('Estimated token usage (API did not return usage in stream)', { prompt: usage.prompt, completion: usage.completion, total: usage.total });
      }

      yield {
        type: 'done',
        usage,
        model,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        log.debug('Stream aborted', { model });
        yield { type: 'error', error: 'Request cancelled' };
        return;
      }
      throw error;
    }
  }

  async checkHealth(): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }> {
    const startTime = Date.now();
    try {
      await this.client.chat.completions.create({
        model: this.defaultModel,
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 5,
        stream: false,
      });

      const latencyMs = Date.now() - startTime;
      log.info('LLM health check passed', { model: this.defaultModel, latencyMs });
      return { ok: true, model: this.defaultModel, latencyMs };
    } catch (error: unknown) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        log.error('LLM health check failed: invalid API key', { latencyMs });
        return { ok: false, error: 'Invalid API key. Check your .env file.', latencyMs };
      }
      if (errorMessage.includes('429')) {
        log.warn('LLM health check failed: rate limited', { latencyMs });
        return { ok: false, error: 'Rate limited by NVIDIA. Please wait.', latencyMs };
      }

      log.error('LLM health check failed', { error: errorMessage, latencyMs });
      return { ok: false, error: 'LLM service unavailable. Check your connection.', latencyMs };
    }
  }
}
