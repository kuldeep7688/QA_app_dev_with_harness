import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PersistenceService } from '../src/services/persistence-service';
import { SettingsService } from '../src/services/settings-service';

describe('Settings Service', () => {
  const tempRoot = path.join(os.tmpdir(), 'kb-settings-test-' + Date.now());
  const dataDir = path.join(tempRoot, 'data');

  beforeAll(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('should return default settings on first launch', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);
    const defaults = settings.get();

    expect(defaults.retrievalMode).toBe('hybrid');
    expect(defaults.topK).toBe(5);
    expect(defaults.topN).toBe(20);
    expect(defaults.rrfK).toBe(60);
    expect(defaults.embeddingsEnabled).toBe(true);
    expect(persistence.exists('settings.json')).toBe(true);
  });

  it('should persist settings to disk and load across instances', () => {
    const persistence = new PersistenceService(dataDir);
    const settings2 = new SettingsService(persistence);
    const fromDisk = settings2.get();

    expect(fromDisk.retrievalMode).toBe('hybrid');
    expect(fromDisk.topK).toBe(5);
  });

  it('should update settings and return new values', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);

    const updated = settings.set({ retrievalMode: 'bm25', topK: 3, rrfK: 30 });
    expect(updated.retrievalMode).toBe('bm25');
    expect(updated.topK).toBe(3);
    expect(updated.rrfK).toBe(30);
    expect(updated.topN).toBe(20);
    expect(updated.embeddingsEnabled).toBe(true);
  });

  it('should load updated settings from disk', () => {
    const persistence = new PersistenceService(dataDir);
    const settings3 = new SettingsService(persistence);
    const reloaded = settings3.get();

    expect(reloaded.retrievalMode).toBe('bm25');
    expect(reloaded.topK).toBe(3);
    expect(reloaded.rrfK).toBe(30);
  });

  it('should return cached values without re-reading', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);

    const cached = settings.get();
    expect(cached.retrievalMode).toBe('bm25');
    expect(cached.topK).toBe(3);
  });

  it('should reject invalid values', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);

    const beforeInvalid = settings.get();

    const afterInvalidMode = settings.set({ retrievalMode: 'invalid' as any });
    expect(afterInvalidMode.retrievalMode).toBe(beforeInvalid.retrievalMode);

    const afterInvalidTopK = settings.set({ topK: -1 });
    expect(afterInvalidTopK.topK).toBe(beforeInvalid.topK);

    const afterInvalidTopN = settings.set({ topN: 0 });
    expect(afterInvalidTopN.topN).toBe(beforeInvalid.topN);

    const afterInvalidRrfK = settings.set({ rrfK: -5 });
    expect(afterInvalidRrfK.rrfK).toBe(beforeInvalid.rrfK);

    const afterInvalidFloat = settings.set({ topK: 3.5 });
    expect(afterInvalidFloat.topK).toBe(beforeInvalid.topK);

    const afterInvalidBool = settings.set({ embeddingsEnabled: 'yes' as any });
    expect(afterInvalidBool.embeddingsEnabled).toBe(beforeInvalid.embeddingsEnabled);
  });

  it('should preserve other values on partial update', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);

    settings.set({ retrievalMode: 'hybrid', topK: 5, topN: 20, rrfK: 60, embeddingsEnabled: true });
    const partial = settings.set({ topK: 10 });

    expect(partial.retrievalMode).toBe('hybrid');
    expect(partial.topN).toBe(20);
    expect(partial.topK).toBe(10);
  });

  it('should return fresh copy from getDefaults', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);

    const defaults2 = settings.getDefaults();
    expect(defaults2.retrievalMode).toBe('hybrid');
    expect(defaults2.topK).toBe(5);

    defaults2.topK = 999;
    expect(settings.get().topK).not.toBe(999);
  });

  it('should fall back to defaults when settings.json is corrupted', () => {
    const persistence = new PersistenceService(dataDir);
    fs.writeFileSync(path.join(dataDir, 'settings.json'), '{invalid json}', 'utf-8');

    const settings4 = new SettingsService(persistence);
    const afterCorrupt = settings4.get();
    expect(afterCorrupt.retrievalMode).toBe('hybrid');
  });

  it('should return default LLM settings on first launch', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);
    const defaults = settings.getLlmSettings();

    expect(defaults.modelName).toBe('');
    expect(defaults.temperature).toBe(0.3);
    expect(defaults.maxTokens).toBe(1024);
    expect(defaults.streamEnabled).toBe(true);
    expect(defaults.systemPrompt).toBe('');
  });

  it('should update LLM settings and return new values', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);
    const updated = settings.setLlmSettings({ temperature: 0.5, maxTokens: 2048, streamEnabled: false });

    expect(updated.temperature).toBe(0.5);
    expect(updated.maxTokens).toBe(2048);
    expect(updated.streamEnabled).toBe(false);
  });

  it('should clamp temperature > 1.0 to 1.0', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);
    const updated = settings.setLlmSettings({ temperature: 5.0 });

    expect(updated.temperature).toBe(1.0);
  });

  it('should reject invalid LLM settings', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);
    const before = settings.getLlmSettings();

    const afterNegTemp = settings.setLlmSettings({ temperature: -1 });
    expect(afterNegTemp.temperature).toBe(before.temperature);

    const afterBadTokens = settings.setLlmSettings({ maxTokens: 0 });
    expect(afterBadTokens.maxTokens).toBe(before.maxTokens);

    const afterFloatTokens = settings.setLlmSettings({ maxTokens: 500.5 });
    expect(afterFloatTokens.maxTokens).toBe(before.maxTokens);

    const afterBadStream = settings.setLlmSettings({ streamEnabled: 'yes' as any });
    expect(afterBadStream.streamEnabled).toBe(before.streamEnabled);
  });

  it('should persist LLM settings alongside retrieval settings', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);
    settings.setLlmSettings({ modelName: 'custom-model', temperature: 0.7 });

    const fresh = new SettingsService(persistence);
    const loaded = fresh.getLlmSettings();
    expect(loaded.modelName).toBe('custom-model');
    expect(loaded.temperature).toBe(0.7);
  });

  it('should preserve modelName setting on partial update', () => {
    const persistence = new PersistenceService(dataDir);
    const settings = new SettingsService(persistence);
    settings.setLlmSettings({ modelName: 'my-model', temperature: 0.5 });
    const partial = settings.setLlmSettings({ temperature: 0.9 });

    expect(partial.modelName).toBe('my-model');
    expect(partial.temperature).toBe(0.9);
  });
});
