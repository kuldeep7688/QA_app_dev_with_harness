import { useState } from 'react';
import { QAHistory, Citation } from '../shared-types';

interface ConversationHistoryProps {
  history: QAHistory[];
  onClearHistory: () => void;
}

/** Format ISO timestamp to a readable local time string. */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Color-code confidence: green ≥ 0.7, yellow ≥ 0.4, red otherwise. */
function confidenceStyle(confidence: number): { background: string; color: string; label: string } {
  if (confidence >= 0.7) {
    return { background: '#1a5928', color: '#66ff99', label: 'high' };
  }
  if (confidence >= 0.4) {
    return { background: '#664d1a', color: '#ffcc66', label: 'medium' };
  }
  return { background: '#4a2020', color: '#ff9999', label: 'low' };
}

interface CitationsBlockProps {
  citations: Citation[];
}

function CitationsBlock({ citations }: CitationsBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (citations.length === 0) return null;

  return (
    <div style={{ marginTop: '8px' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          background: 'none',
          border: 'none',
          color: '#8888bb',
          cursor: 'pointer',
          fontSize: '12px',
          padding: '0',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <span style={{ fontSize: '10px' }}>{expanded ? '▼' : '▶'}</span>
        {citations.length} citation{citations.length !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <div style={{ marginTop: '6px' }}>
          {citations.map((c, i) => {
            const cs = confidenceStyle(c.confidence);
            return (
              <div
                key={i}
                style={{
                  marginTop: '6px',
                  paddingLeft: '10px',
                  borderLeft: '2px solid #533483',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    minWidth: '38px',
                    padding: '2px 5px',
                    background: cs.background,
                    color: cs.color,
                    borderRadius: '3px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {Math.round(c.confidence * 100)}%
                </div>
                <div style={{ fontSize: '12px', color: '#a0a0c0', lineHeight: 1.5 }}>
                  <strong style={{ color: '#c0c0e0' }}>{c.documentTitle}</strong>{' '}
                  <span style={{ color: '#6666aa' }}>(chunk {c.chunkIndex})</span>
                  {': '}
                  {c.excerpt.substring(0, 120)}
                  {c.excerpt.length > 120 ? '…' : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConversationHistory({ history, onClearHistory }: ConversationHistoryProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClearClick = () => {
    if (confirmClear) {
      onClearHistory();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '12px',
          borderBottom: '1px solid #0f3460',
          marginBottom: '16px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#c0c0e0' }}>
          Conversation History
          {history.length > 0 && (
            <span
              style={{
                marginLeft: '8px',
                fontSize: '12px',
                fontWeight: 400,
                color: '#6666aa',
              }}
            >
              ({history.length} exchange{history.length !== 1 ? 's' : ''})
            </span>
          )}
        </span>

        {history.length > 0 && (
          <button
            onClick={handleClearClick}
            style={{
              padding: '4px 10px',
              background: confirmClear ? '#7a2020' : '#2a2a4e',
              color: confirmClear ? '#ff8888' : '#8888bb',
              border: `1px solid ${confirmClear ? '#aa3333' : '#3a3a6e'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {confirmClear ? 'Confirm clear?' : 'Clear history'}
          </button>
        )}
      </div>

      {/* Empty state */}
      {history.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#4a4a7a',
            fontSize: '14px',
          }}
        >
          No conversation history yet. Ask a question to get started.
        </div>
      )}

      {/* Chat bubbles */}
      {history.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {history.map((entry, idx) => {
            const cs = confidenceStyle(entry.response.confidence);
            return (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* User question bubble — right-aligned, purple */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      maxWidth: '75%',
                      padding: '10px 14px',
                      background: '#533483',
                      borderRadius: '14px 14px 4px 14px',
                      fontSize: '14px',
                      lineHeight: 1.5,
                      color: '#e8e0ff',
                    }}
                  >
                    <div>{entry.question}</div>
                    {entry.response.timestamp && (
                      <div
                        style={{
                          marginTop: '4px',
                          fontSize: '11px',
                          color: '#a090cc',
                          textAlign: 'right',
                        }}
                      >
                        {formatTime(entry.response.timestamp)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Assistant answer bubble — left-aligned, dark */}
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '80%',
                      padding: '10px 14px',
                      background: '#1a1a3e',
                      borderRadius: '14px 14px 14px 4px',
                      border: '1px solid #2a2a5e',
                      fontSize: '14px',
                      lineHeight: 1.6,
                      color: '#d0d0f0',
                    }}
                  >
                    <div>{entry.response.answer}</div>

                    {/* Confidence indicator */}
                    <div
                      style={{
                        marginTop: '8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '2px 7px',
                        background: cs.background,
                        color: cs.color,
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      ● {cs.label} confidence ({Math.round(entry.response.confidence * 100)}%)
                    </div>

                    {/* Expandable citations */}
                    <CitationsBlock citations={entry.response.citations} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
