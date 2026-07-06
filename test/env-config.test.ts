import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

describe('env-config', () => {
  let originalEnvContent: string | null = null;

  beforeAll(() => {
    // Save any existing .env so we can restore it after tests
    try { originalEnvContent = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { originalEnvContent = null; }
  });

  afterAll(() => {
    // Restore the original .env if it existed
    if (originalEnvContent !== null) {
      fs.writeFileSync(ENV_PATH, originalEnvContent, 'utf-8');
    } else {
      try { fs.unlinkSync(ENV_PATH); } catch { /* nothing to clean */ }
    }
  });

  beforeEach(() => {
    try { fs.unlinkSync(ENV_PATH); } catch { /* ok */ }
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_MODEL_NAME;
    delete process.env.NVIDIA_BASE_URL;
    vi.resetModules();
  });

  it('sets llmEnabled=false when no .env file exists', async () => {
    const mod = await import('../src/services/env-config');
    const config = mod.loadEnvConfig();
    expect(config.llmEnabled).toBe(false);
    expect(config.nvidiaApiKey).toBe('');
    expect(config.modelName).toBe('google/gemma-2-2b-it');
    expect(config.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
  });

  it('reads values from .env file', async () => {
    fs.writeFileSync(ENV_PATH, [
      'NVIDIA_API_KEY=nvapi-test-key-123',
      'NVIDIA_MODEL_NAME=custom/model',
      'NVIDIA_BASE_URL=https://custom.url/v1',
    ].join('\n'), 'utf-8');

    const mod = await import('../src/services/env-config');
    const config = mod.loadEnvConfig();

    expect(config.llmEnabled).toBe(true);
    expect(config.nvidiaApiKey).toBe('nvapi-test-key-123');
    expect(config.modelName).toBe('custom/model');
    expect(config.baseUrl).toBe('https://custom.url/v1');
  });

  it('isLLMEnabled returns false when key is missing', async () => {
    const mod = await import('../src/services/env-config');
    expect(mod.isLLMEnabled()).toBe(false);
  });

  it('uses defaults for missing optional values', async () => {
    fs.writeFileSync(ENV_PATH, 'NVIDIA_API_KEY=nvapi-minimal', 'utf-8');

    const mod = await import('../src/services/env-config');
    const config = mod.loadEnvConfig();

    expect(config.llmEnabled).toBe(true);
    expect(config.nvidiaApiKey).toBe('nvapi-minimal');
    expect(config.modelName).toBe('google/gemma-2-2b-it');
    expect(config.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
  });

  it('getEnvConfig returns cached config without re-reading', async () => {
    fs.writeFileSync(ENV_PATH, 'NVIDIA_API_KEY=nvapi-cached', 'utf-8');

    const mod = await import('../src/services/env-config');
    const config1 = mod.loadEnvConfig();
    expect(config1.nvidiaApiKey).toBe('nvapi-cached');

    fs.unlinkSync(ENV_PATH);
    const config2 = mod.getEnvConfig();
    expect(config2.nvidiaApiKey).toBe('nvapi-cached');
  });
});
