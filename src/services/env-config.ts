import * as dotenv from 'dotenv';
import * as path from 'path';
import { logger } from './logger';

const log = logger.forService('EnvConfig');

export interface EnvConfig {
  nvidiaApiKey: string;
  modelName: string;
  baseUrl: string;
  llmEnabled: boolean;
  tavilyApiKey: string;
}

let cached: EnvConfig | null = null;

export function loadEnvConfig(): EnvConfig {
  if (cached) return cached;

  const envPath = path.resolve(__dirname, '../../.env');
  const result = dotenv.config({ path: envPath });

  if (result.error) {
    log.warn('No .env file found — LLM features disabled', {
      searched: envPath,
    });
  }

  const nvidiaApiKey = process.env.NVIDIA_API_KEY || '';
  const modelName = process.env.NVIDIA_MODEL_NAME || 'google/gemma-2-2b-it';
  const baseUrl = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
  const llmEnabled = nvidiaApiKey.length > 0;
  const tavilyApiKey = process.env.TAVILY_API_KEY || '';

  if (!llmEnabled) {
    log.warn('NVIDIA_API_KEY not set — LLM features disabled');
  } else {
    log.info('LLM environment configured', {
      modelName,
      baseUrl,
      keyPresent: true,
      keyLength: nvidiaApiKey.length,
    });
  }

  if (tavilyApiKey) {
    log.info('Tavily API key configured', { keyPresent: true, keyLength: tavilyApiKey.length });
  } else {
    log.warn('TAVILY_API_KEY not set — web search disabled');
  }

  cached = { nvidiaApiKey, modelName, baseUrl, llmEnabled, tavilyApiKey };
  return cached;
}

export function getEnvConfig(): EnvConfig {
  if (!cached) return loadEnvConfig();
  return cached;
}

export function isLLMEnabled(): boolean {
  return getEnvConfig().llmEnabled;
}
