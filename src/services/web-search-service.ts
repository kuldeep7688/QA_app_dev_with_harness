import { logger } from './logger.js';

const log = logger.forService('web-search-service');

export interface WebSearchConfig {
  apiKey: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

export class WebSearchService {
  private apiKey: string;
  private baseUrl = 'https://api.tavily.com/search';

  constructor(config: WebSearchConfig) {
    this.apiKey = config.apiKey;
    log.info('WebSearchService initialized', { baseUrl: this.baseUrl, keyPresent: !!this.apiKey });
  }

  async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
    if (!query.trim()) return [];
    if (!this.apiKey) {
      log.warn('Web search disabled: no API key');
      return [];
    }

    const start = Date.now();
    log.info('Web search starting', { queryLength: query.length, maxResults });

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          include_answer: false,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
          log.error('Web search: invalid API key', { status });
          return [];
        }
        if (status === 429) {
          log.warn('Web search: rate limited', { status });
          return [];
        }
        log.error('Web search: API error', { status });
        return [];
      }

      const data = await response.json() as { results: Array<{ title: string; url: string; content: string }> };
      const results: WebSearchResult[] = (data.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
      }));

      const duration = Date.now() - start;
      if (results.length > 0) {
        log.info('Web search completed', { resultCount: results.length, durationMs: duration });
      } else {
        log.info('Web search: no results', { durationMs: duration });
      }

      return results;
    } catch (err) {
      const duration = Date.now() - start;
      log.error('Web search: network error', { durationMs: duration, error: String(err) });
      return [];
    }
  }
}
