import { useState, useEffect } from 'react';

interface RetrievalSettings {
  retrievalMode: 'hybrid' | 'bm25' | 'vector';
  topK: number;
  topN: number;
  rrfK: number;
  embeddingsEnabled: boolean;
}

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettingsState] = useState<RetrievalSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.knowledgeBase.settings.get().then(setSettingsState);
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await window.knowledgeBase.settings.set(settings as Partial<RetrievalSettings>);
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

  if (!settings) {
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
          Retrieval Settings
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
