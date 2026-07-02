# LLM Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime LLM settings (model name, temperature, max tokens, streaming toggle, custom system prompt) to the settings panel that override .env defaults.

**Architecture:** Extend shared types with `LlmSettings` interface, add `LlmSettings` methods to `SettingsService`, wire via new IPC channels through preload to renderer. QaService reads LLM settings via callback for model/temperature/maxTokens/systemPrompt overrides.

**Tech Stack:** TypeScript, Electron IPC, React

---

### Task 1: Add LlmSettings type and IPC channels to shared types

**Files:**
- Modify: `src/shared/types.ts:113-119`

- [ ] **Step 1: Add LlmSettings interface and IPC channels**

Add after `RetrievalSettings` interface, add IPC channels before `RESET_DATA`:

```typescript
export interface LlmSettings {
  modelName: string;
  temperature: number;
  maxTokens: number;
  streamEnabled: boolean;
  systemPrompt: string;
}
```

Add IPC channels to `IPC_CHANNELS`:
```typescript
  // LLM Settings
  LLM_SETTINGS_GET: 'llm:settings:get',
  LLM_SETTINGS_SET: 'llm:settings:set',
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(llm-settings): add LlmSettings interface and IPC channels"
```

---

### Task 2: Extend SettingsService with getLlmSettings/setLlmSettings

**Files:**
- Modify: `src/services/settings-service.ts`
- Test: `test/settings.test.ts`

- [ ] **Step 1: Add LlmSettings import and defaults**

Add to `settings-service.ts` imports:
```typescript
import type { LlmSettings } from '../shared/types';
```

Add after `VALID_MODES`:
```typescript
const LLM_DEFAULTS: LlmSettings = {
  modelName: '',
  temperature: 0.3,
  maxTokens: 1024,
  streamEnabled: true,
  systemPrompt: '',
};
```

- [ ] **Step 2: Add getLlmSettings method**

Add after `set()`:
```typescript
  getLlmSettings(): LlmSettings {
    const saved = this.persistence.readJson<Partial<LlmSettings & RetrievalSettings>>('settings.json');
    if (saved) {
      const validated = this.applyLlmDefaults(saved);
      log.debug('LLM settings loaded from disk', { modelName: validated.modelName || '(env default)' });
      return validated;
    }
    log.info('No settings file found, using LLM defaults');
    this.persistence.writeJson('settings.json', { ...DEFAULTS, ...LLM_DEFAULTS });
    return { ...LLM_DEFAULTS };
  }
```

- [ ] **Step 3: Add setLlmSettings method**

Add after `getLlmSettings()`:
```typescript
  setLlmSettings(partial: Partial<LlmSettings>): LlmSettings {
    const current = this.getLlmSettings();
    const merged: LlmSettings = {
      ...current,
      ...partial,
    };

    if (partial.temperature !== undefined) {
      if (typeof partial.temperature !== 'number' || partial.temperature < 0) {
        log.warn('Invalid temperature rejected', { invalidValue: partial.temperature });
        merged.temperature = current.temperature;
      } else if (partial.temperature > 1.0) {
        log.warn('Temperature clamped to 1.0', { originalValue: partial.temperature });
        merged.temperature = 1.0;
      }
    }

    if (partial.maxTokens !== undefined) {
      if (!Number.isInteger(partial.maxTokens) || partial.maxTokens < 1) {
        log.warn('Invalid maxTokens rejected', { invalidValue: partial.maxTokens });
        merged.maxTokens = current.maxTokens;
      }
    }

    if (partial.streamEnabled !== undefined && typeof partial.streamEnabled !== 'boolean') {
      log.warn('Invalid streamEnabled rejected', { invalidValue: partial.streamEnabled });
      merged.streamEnabled = current.streamEnabled;
    }

    const persisted = this.persistence.readJson<Record<string, unknown>>('settings.json') ?? {};
    this.persistence.writeJson('settings.json', { ...persisted, ...merged });

    log.info('LLM settings updated', {
      modelName: merged.modelName || '(env default)',
      temperature: merged.temperature,
      maxTokens: merged.maxTokens,
      streamEnabled: merged.streamEnabled,
      systemPromptLength: merged.systemPrompt.length,
    });

    return { ...merged };
  }
```

- [ ] **Step 4: Add applyLlmDefaults helper**

Add to SettingsService class:
```typescript
  private applyLlmDefaults(saved: Partial<LlmSettings>): LlmSettings {
    return {
      modelName: typeof saved.modelName === 'string' ? saved.modelName : LLM_DEFAULTS.modelName,
      temperature: typeof saved.temperature === 'number' && saved.temperature >= 0 ? Math.min(saved.temperature, 1.0) : LLM_DEFAULTS.temperature,
      maxTokens: typeof saved.maxTokens === 'number' && Number.isInteger(saved.maxTokens) && saved.maxTokens >= 1 ? saved.maxTokens : LLM_DEFAULTS.maxTokens,
      streamEnabled: typeof saved.streamEnabled === 'boolean' ? saved.streamEnabled : LLM_DEFAULTS.streamEnabled,
      systemPrompt: typeof saved.systemPrompt === 'string' ? saved.systemPrompt : LLM_DEFAULTS.systemPrompt,
    };
  }
```

- [ ] **Step 5: Write failing tests**

Add to `test/settings.test.ts` before the closing `});`:

```typescript
  it('should return default LLM settings on first launch', () => {
    const settings = new SettingsService(persistence);
    const defaults = settings.getLlmSettings();

    expect(defaults.modelName).toBe('');
    expect(defaults.temperature).toBe(0.3);
    expect(defaults.maxTokens).toBe(1024);
    expect(defaults.streamEnabled).toBe(true);
    expect(defaults.systemPrompt).toBe('');
  });

  it('should update LLM settings and return new values', () => {
    const settings = new SettingsService(persistence);
    const updated = settings.setLlmSettings({ temperature: 0.5, maxTokens: 2048, streamEnabled: false });

    expect(updated.temperature).toBe(0.5);
    expect(updated.maxTokens).toBe(2048);
    expect(updated.streamEnabled).toBe(false);
  });

  it('should clamp temperature > 1.0 to 1.0', () => {
    const settings = new SettingsService(persistence);
    const updated = settings.setLlmSettings({ temperature: 5.0 });

    expect(updated.temperature).toBe(1.0);
  });

  it('should reject invalid LLM settings', () => {
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
    const settings = new SettingsService(persistence);
    settings.setLlmSettings({ modelName: 'custom-model', temperature: 0.7 });

    const fresh = new SettingsService(persistence);
    const loaded = fresh.getLlmSettings();
    expect(loaded.modelName).toBe('custom-model');
    expect(loaded.temperature).toBe(0.7);
  });

  it('should preserve modelName setting on partial update', () => {
    const settings = new SettingsService(persistence);
    settings.setLlmSettings({ modelName: 'my-model', temperature: 0.5 });
    const partial = settings.setLlmSettings({ temperature: 0.9 });

    expect(partial.modelName).toBe('my-model');
    expect(partial.temperature).toBe(0.9);
  });
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run test/settings.test.ts`
Expected: 6 new tests fail (methods don't exist yet)

Note: If native module error, run `npm rebuild better-sqlite3` first.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run test/settings.test.ts`
Expected: All tests pass (old + new)

- [ ] **Step 8: Run full type check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 9: Commit**

```bash
git add src/services/settings-service.ts test/settings.test.ts
git commit -m "feat(llm-settings): add getLlmSettings/setLlmSettings to SettingsService"
```

---

### Task 3: Register IPC handlers for llm:settings:get/set

**Files:**
- Modify: `src/main/ipc-handlers.ts:220-229`

- [ ] **Step 1: Add IPC handlers after existing settings handlers**

Replace the settings section to add LLM settings handlers after the existing `SET_SETTINGS` handler:

```typescript
  // Settings
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    log.debug('IPC received', { channel: IPC_CHANNELS.GET_SETTINGS });
    return settingsService.get();
  });

  ipcMain.handle(IPC_CHANNELS.SET_SETTINGS, async (_event, partial: Partial<import('../shared/types').RetrievalSettings>) => {
    log.info('IPC received', { channel: IPC_CHANNELS.SET_SETTINGS, partial });
    return settingsService.set(partial);
  });

  // LLM Settings
  ipcMain.handle(IPC_CHANNELS.LLM_SETTINGS_GET, async () => {
    log.debug('IPC received', { channel: IPC_CHANNELS.LLM_SETTINGS_GET });
    return settingsService.getLlmSettings();
  });

  ipcMain.handle(IPC_CHANNELS.LLM_SETTINGS_SET, async (_event, partial: Partial<import('../shared/types').LlmSettings>) => {
    log.info('IPC received', { channel: IPC_CHANNELS.LLM_SETTINGS_SET, partial });
    return settingsService.setLlmSettings(partial);
  });
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(llm-settings): register llm:settings IPC handlers"
```

---

### Task 4: Update preload with llmSettings namespace

**Files:**
- Modify: `src/preload/preload.ts:89-95`

- [ ] **Step 1: Add IPC channels to preload const**

Add to `IPC_CHANNELS` const in preload:
```typescript
  LLM_SETTINGS_GET: 'llm:settings:get',
  LLM_SETTINGS_SET: 'llm:settings:set',
```

- [ ] **Step 2: Add llmSettings namespace to api object**

Add after the `settings` block:
```typescript
  llmSettings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_SETTINGS_GET) as Promise<import('../shared/types').LlmSettings>,
    set: (partial: Partial<import('../shared/types').LlmSettings>) =>
      ipcRenderer.invoke(IPC_CHANNELS.LLM_SETTINGS_SET, partial) as Promise<import('../shared/types').LlmSettings>,
  },
```

- [ ] **Step 3: Run build (Vite checks the preload compiles)**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/preload/preload.ts
git commit -m "feat(llm-settings): add llmSettings to preload"
```

---

### Task 5: Update renderer type declarations

**Files:**
- Modify: `src/renderer/types.d.ts:43-49`

- [ ] **Step 1: Add llmSettings to window.knowledgeBase type**

Add after the `settings` block:
```typescript
      llmSettings: {
        get: () => Promise<import('../shared/types').LlmSettings>;
        set: (partial: Partial<import('../shared/types').LlmSettings>) => Promise<import('../shared/types').LlmSettings>;
      };
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/types.d.ts
git commit -m "feat(llm-settings): add llmSettings to renderer type declarations"
```

---

### Task 6: Update QaService to accept and use getLlmSettings

**Files:**
- Modify: `src/services/qa-service.ts`

- [ ] **Step 1: Add LlmSettings import**

```typescript
import type { LlmSettings } from '../shared/types';
```

- [ ] **Step 2: Add getLlmSettings to constructor**

Add `getLlmSettings` parameter and field:
```typescript
  private getLlmSettings: () => LlmSettings;

  constructor(
    db: Database.Database,
    embedFn: (text: string) => Promise<Float32Array>,
    getSettings?: () => RetrievalSettings,
    llmProvider?: LlmProvider | null,
    getLlmSettings?: () => LlmSettings,
  ) {
    this.db = db;
    this.embedFn = embedFn;
    this.getSettings = getSettings ?? (() => ({
      retrievalMode: isVectorExtensionLoaded() ? 'hybrid' : 'bm25',
      topK: 5,
      topN: 20,
      rrfK: 60,
      embeddingsEnabled: true,
    }));
    this.getLlmSettings = getLlmSettings ?? (() => ({
      modelName: '',
      temperature: 0.3,
      maxTokens: 1024,
      streamEnabled: true,
      systemPrompt: '',
    }));
    this.llmProvider = llmProvider ?? null;
  }
```

- [ ] **Step 3: Update buildPrompt to use custom systemPrompt**

In `buildPrompt()`, read the llmSettings and use the custom prompt if set:

```typescript
  private buildPrompt(question: string, citations: Citation[]): ChatMessage[] {
    const llmSettings = this.getLlmSettings();
    const systemPrompt = llmSettings.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    const excerptBlocks = citations.map((c, i) =>
      `[Source ${i + 1}] ${c.documentTitle} (chunk ${c.chunkIndex}):\n${c.excerpt}`
    );

    const systemContent = `${systemPrompt}\n\nBelow are the relevant document excerpts to use for answering:\n\n${excerptBlocks.join('\n\n')}`;

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: question },
    ];
  }
```

- [ ] **Step 4: Update ask() to use LLM settings for provider options**

Replace the hardcoded `temperature: 0.3` and `maxTokens: 1024` in the `this.llmProvider.chat()` call:

```typescript
    if (this.llmProvider && citations.length > 0) {
      const messages = this.buildPrompt(question, citations);
      const llmSettings = this.getLlmSettings();
      try {
        const chatResponse = await this.llmProvider.chat(messages, {
          model: llmSettings.modelName || undefined,
          temperature: llmSettings.temperature,
          maxTokens: llmSettings.maxTokens,
        });
```

- [ ] **Step 5: Update askStream() to use LLM settings for provider options**

Replace hardcoded `temperature: 0.3, maxTokens: 1024` in the `this.llmProvider.chatStream()` call:

```typescript
      const llmSettings = this.getLlmSettings();
      for await (const chunk of this.llmProvider.chatStream(messages, {
        temperature: llmSettings.temperature,
        maxTokens: llmSettings.maxTokens,
        model: llmSettings.modelName || undefined,
        signal,
      })) {
```

- [ ] **Step 6: Run type check**

Run: `npm run check`
Expected: 0 errors (main.ts passes `() => settingsService.getLlmSettings()` - but wait, we need to update main.ts too)

- [ ] **Step 7: Commit**

```bash
git add src/services/qa-service.ts
git commit -m "feat(llm-settings): QaService reads LLM settings for model/temp/maxTokens/prompt"
```

---

### Task 7: Wire getLlmSettings into main.ts

**Files:**
- Modify: `src/main/main.ts:120`

- [ ] **Step 1: Pass getLlmSettings to QaService**

Update the QaService constructor call:
```typescript
  const qaService = new QaService(db, embed, () => settingsService.get(), llmProvider, () => settingsService.getLlmSettings());
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(llm-settings): wire getLlmSettings into QaService construction"
```

---

### Task 8: Update SettingsPanel UI with LLM settings section

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 1: Add LlmSettings type and extend component**

The SettingsPanel currently only manages RetrievalSettings. We need to load and save LlmSettings as well.

Import types at top:
```typescript
interface LlmSettings {
  modelName: string;
  temperature: number;
  maxTokens: number;
  streamEnabled: boolean;
  systemPrompt: string;
}
```

Add state, loading and saving for LLM settings:
```typescript
export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettingsState] = useState<RetrievalSettings | null>(null);
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      window.knowledgeBase.settings.get(),
      window.knowledgeBase.llmSettings.get(),
    ]).then(([ret, llm]) => {
      setSettingsState(ret);
      setLlmSettingsState(llm);
    });
  }, []);
```

Update handleSave:
```typescript
  const handleSave = async () => {
    if (!settings || !llmSettings) return;
    setSaving(true);
    try {
      const updated = await window.knowledgeBase.settings.set(settings as Partial<RetrievalSettings>);
      await window.knowledgeBase.llmSettings.set(llmSettings as Partial<LlmSettings>);
      setSettingsState(updated);
      onClose();
    } catch {
      setSaving(false);
    }
  };
```

Add LLM update helper:
```typescript
  const updateLlm = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => {
    if (!llmSettings) return;
    setLlmSettingsState({ ...llmSettings, [key]: value });
  };
```

- [ ] **Step 2: Add LLM settings UI section**

After the retrieval settings (before the save/cancel buttons), add:

```typescript
        <hr style={{ border: 'none', borderTop: '1px solid #0f3460', margin: '20px 0' }} />

        <h3 style={{ margin: '0 0 4px', color: '#e0e0e0', fontSize: '16px' }}>
          LLM Settings
        </h3>
        <p style={{ margin: '0 0 20px', color: '#666', fontSize: '12px' }}>
          Override .env defaults for the next question.
        </p>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Model Name (leave empty for env default)</label>
          <input
            type="text"
            value={llmSettings?.modelName ?? ''}
            onChange={(e) => updateLlm('modelName', e.target.value)}
            style={inputStyle}
            placeholder="google/gemma-2-2b-it"
          />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Temperature: {llmSettings?.temperature?.toFixed(2) ?? '0.30'}</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={llmSettings?.temperature ?? 0.3}
            onChange={(e) => updateLlm('temperature', parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#533483' }}
          />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Max Tokens</label>
          <input
            type="number"
            min={1}
            max={32768}
            value={llmSettings?.maxTokens ?? 1024}
            onChange={(e) => updateLlm('maxTokens', Math.max(1, parseInt(e.target.value) || 1))}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="streamEnabled"
            checked={llmSettings?.streamEnabled ?? true}
            onChange={(e) => updateLlm('streamEnabled', e.target.checked)}
            style={{ accentColor: '#533483' }}
          />
          <label htmlFor="streamEnabled" style={{ color: '#e0e0e0', fontSize: '13px' }}>
            Stream Answers
          </label>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>System Prompt (leave empty for default)</label>
          <textarea
            value={llmSettings?.systemPrompt ?? ''}
            onChange={(e) => updateLlm('systemPrompt', e.target.value)}
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Default: Answer using ONLY the provided document excerpts..."
          />
        </div>
```

Also update the title from "Retrieval Settings" to "Settings".

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds (287 modules)

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SettingsPanel.tsx
git commit -m "feat(llm-settings): add LLM settings section to SettingsPanel"
```

---

### Task 9: Run full test suite and verify

**Files:**
- None

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (all previous + 6 new LLM settings tests)

- [ ] **Step 2: Full build + check**

Run: `bash init.sh`
Expected: All checks pass

- [ ] **Step 3: Run cleanup scanner**

Run: `bash scripts/cleanup-scanner.sh`
Expected: CLEAN

---

### Task 10: Update feature_list.json and docs

**Files:**
- Modify: `feature_list.json`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PRODUCT.md`

- [ ] **Step 1: Update feature_list.json**

Change `llm-settings` status to `"pass"` and add evidence.

- [ ] **Step 2: Update ARCHITECTURE.md**

Add IPC channels for `llm:settings:get/set`, update services layer diagram.

- [ ] **Step 3: Update PRODUCT.md**

No changes needed (already documents LLM settings).

- [ ] **Step 4: Commit**

```bash
git add feature_list.json docs/ARCHITECTURE.md
git commit -m "docs: update feature_list.json and ARCHITECTURE.md for llm-settings"
```
