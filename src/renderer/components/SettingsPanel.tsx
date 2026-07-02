import { useState, useEffect } from 'react';

import type { RetrievalSettings, LlmSettings } from '../../shared/types';

interface SettingsPanelProps {
  onClose: () => void;
}

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

  const update = <K extends keyof RetrievalSettings>(key: K, value: RetrievalSettings[K]) => {
    if (!settings) return;
    setSettingsState({ ...settings, [key]: value });
  };

  const updateLlm = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => {
    if (!llmSettings) return;
    setLlmSettingsState({ ...llmSettings, [key]: value });
  };

  if (!settings || !llmSettings) {
    return null;
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: '#1a1a2e',
    color: '#e0e0e0',
    border: '1px solid #0f3460',
    borderRadius: '4px',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '4px',
    color: '#a0a0c0',
    fontSize: '12px',
    fontWeight: 500,
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div style={{
        background: '#1a1a2e',
        border: '1px solid #0f3460',
        borderRadius: '8px',
        padding: '24px',
        maxWidth: '420px',
        width: '90%',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}>
        <h3 style={{ margin: '0 0 4px', color: '#e0e0e0', fontSize: '16px' }}>
          Settings
        </h3>
        <p style={{ margin: '0 0 20px', color: '#666', fontSize: '12px' }}>
          Changes take effect on the next question.
        </p>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Retrieval Mode</label>
          <select
            value={settings.retrievalMode}
            onChange={(e) => update('retrievalMode', e.target.value as RetrievalSettings['retrievalMode'])}
            style={inputStyle}
          >
            <option value="hybrid">Hybrid (BM25 + Vector)</option>
            <option value="bm25">BM25 Only</option>
            <option value="vector">Vector Only</option>
          </select>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Results per Source (topN)</label>
          <input
            type="number"
            min={1}
            max={100}
            value={settings.topN}
            onChange={(e) => update('topN', Math.max(1, parseInt(e.target.value) || 1))}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Final Results (topK)</label>
          <input
            type="number"
            min={1}
            max={20}
            value={settings.topK}
            onChange={(e) => update('topK', Math.max(1, parseInt(e.target.value) || 1))}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>RRF Constant (k)</label>
          <input
            type="number"
            min={1}
            max={200}
            value={settings.rrfK}
            onChange={(e) => update('rrfK', Math.max(1, parseInt(e.target.value) || 1))}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="embeddingsEnabled"
            checked={settings.embeddingsEnabled}
            onChange={(e) => update('embeddingsEnabled', e.target.checked)}
            style={{ accentColor: '#533483' }}
          />
          <label htmlFor="embeddingsEnabled" style={{ color: '#e0e0e0', fontSize: '13px' }}>
            Embeddings Enabled
          </label>
        </div>

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
            value={llmSettings.modelName}
            onChange={(e) => updateLlm('modelName', e.target.value)}
            style={inputStyle}
            placeholder="google/gemma-2-2b-it"
          />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Temperature: {llmSettings.temperature.toFixed(2)}</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={llmSettings.temperature}
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
            value={llmSettings.maxTokens}
            onChange={(e) => updateLlm('maxTokens', Math.max(1, parseInt(e.target.value) || 1))}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="streamEnabled"
            checked={llmSettings.streamEnabled}
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
            value={llmSettings.systemPrompt}
            onChange={(e) => updateLlm('systemPrompt', e.target.value)}
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Default: Answer using ONLY the provided document excerpts..."
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              background: '#0f3460',
              color: '#e0e0e0',
              border: '1px solid #1a1a4e',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '6px 16px',
              background: saving ? '#3a2a5a' : '#533483',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '13px',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
