# LLM Settings Panel

## Summary

Add runtime LLM settings (model name, temperature, max tokens, streaming toggle, custom system prompt) to the existing settings system. These override `.env` defaults and take effect on the next question.

## Types

New `LlmSettings` interface in `src/shared/types.ts`:

```typescript
interface LlmSettings {
  modelName: string;       // override env default
  temperature: number;     // 0.0–1.0, default 0.3, clamped at 1.0
  maxTokens: number;       // default 1024
  streamEnabled: boolean;  // default true
  systemPrompt: string;    // custom override for DEFAULT_SYSTEM_PROMPT
}
```

## Persistence

SettingsService stores LLM settings alongside retrieval settings in the same `settings.json` file. Two new typed methods:

- `getLlmSettings(): LlmSettings` — reads merged file, applies defaults for missing fields
- `setLlmSettings(partial: Partial<LlmSettings>): LlmSettings` — validates, merges, writes

Defaults written on first read if `settings.json` is missing or LLM fields absent.

## Validation

| Field | Rule |
|-------|------|
| `temperature` | Clamped to [0, 1.0] with WARN if > 1.0 or < 0 |
| `maxTokens` | Must be positive integer; rejected with WARN if ≤ 0 or non-integer |
| `modelName` | Any non-empty string accepted |
| `streamEnabled` | Must be boolean |
| `systemPrompt` | Any string accepted (empty = use default) |

## IPC

Two new channels in `IPC_CHANNELS`:

- `llm:settings:get` → `settingsService.getLlmSettings()`
- `llm:settings:set` → `settingsService.setLlmSettings(partial)`

Preload exposes `window.knowledgeBase.llmSettings.{get, set}`.

## QaService Changes

Constructor accepts optional `getLlmSettings: () => LlmSettings` callback.

- `buildPrompt()` uses `systemPrompt` from LLM settings when non-empty, else `DEFAULT_SYSTEM_PROMPT`
- `ask()` passes `{ model, temperature, maxTokens }` from LLM settings to `llmProvider.chat()`
- `askStream()` passes `{ model, temperature, maxTokens, signal }` to `llmProvider.chatStream()`
- Default callback (when not provided) returns hardcoded defaults

## UI

Existing `SettingsPanel` gets a new "LLM Settings" section below the retrieval settings:

- **Model Name**: text input, default from env
- **Temperature**: range slider (0–1.0, step 0.05) with numeric display
- **Max Tokens**: number input (min 1, max 32768)
- **Stream Enabled**: checkbox toggle
- **System Prompt**: textarea (3 rows), placeholder "Default system prompt"

The panel title changes from "Retrieval Settings" to "Settings", with a visual separator between the two sections.

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `LlmSettings` interface, `llm:settings:get/set` IPC channels |
| `src/services/settings-service.ts` | Add `getLlmSettings()` / `setLlmSettings()` with validation |
| `src/services/qa-service.ts` | Accept `getLlmSettings`, use custom systemPrompt/temperature/maxTokens/modelName |
| `src/main/ipc-handlers.ts` | Register `llm:settings:get/set` handlers |
| `src/preload/preload.ts` | Add `llmSettings` preload namespace |
| `src/renderer/types.d.ts` | Add `llmSettings` type declaration |
| `src/renderer/components/SettingsPanel.tsx` | Add LLM settings section |
| `test/settings.test.ts` | Add LLM settings tests |
| `test/qa-hybrid.test.ts` | Update QaService tests for LLM settings |
