import { useState } from 'react';
import { QAHistory, Citation } from '../shared-types';

interface ConversationHistoryProps {
  history: QAHistory[];
  onClearHistory: () => void;
  onSubmitFeedback: (responseTimestamp: string, question: string, rating: 'positive' | 'negative') => void;
  streamingEntry?: { question: string; partialAnswer: string; hasError: boolean; cancelled: boolean } | null;
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

interface BadgeInfo {
  label: string;
  bg: string;
  color: string;
}

function sourceBadge(c: Citation): BadgeInfo {
  const isHybrid = c.sources.includes('bm25') && c.sources.includes('vector');
  if (isHybrid) {
    return { label: 'Hybrid', bg: '#2a1a4e', color: '#bb88ff' };
  }
  if (c.sources.includes('bm25') && c.bm25Rank !== undefined) {
    return { label: `BM25 #${c.bm25Rank}`, bg: '#1a2a4e', color: '#88bbff' };
  }
  if (c.sources.includes('vector') && c.vectorRank !== undefined) {
    return { label: `Vector #${c.vectorRank}`, bg: '#1a3a2a', color: '#88ff99' };
  }
  return { label: c.sources[0] || '—', bg: '#333', color: '#aaa' };
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
            const badge = sourceBadge(c);
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
                <div
                  style={{
                    padding: '2px 6px',
                    background: badge.bg,
                    color: badge.color,
                    borderRadius: '3px',
                    fontSize: '10px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    marginTop: '1px',
                  }}
                >
                  {badge.label}
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

export function ConversationHistory({ history, onClearHistory, onSubmitFeedback, streamingEntry }: ConversationHistoryProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Set<string>>(new Set());

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
      {history.length === 0 && !streamingEntry && (
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
      {(history.length > 0 || streamingEntry) && (
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

                    {/* Token usage */}
                    {entry.response.tokensUsed && (
                      <div style={{ marginTop: '6px', fontSize: '11px', color: '#6666aa' }}>
                        {entry.response.tokensUsed.total} tokens
                        {entry.response.modelUsed ? ` · ${entry.response.modelUsed}` : ''}
                      </div>
                    )}

                    {/* Feedback buttons */}
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => {
                          if (feedbackGiven.has(entry.response.timestamp)) return;
                          setFeedbackGiven(prev => new Set([...prev, entry.response.timestamp]));
                          onSubmitFeedback(entry.response.timestamp, entry.question, 'positive');
                        }}
                        disabled={feedbackGiven.has(entry.response.timestamp)}
                        style={{
                          background: feedbackGiven.has(entry.response.timestamp) ? '#1a3a2a' : '#2a2a4e',
                          color: feedbackGiven.has(entry.response.timestamp) ? '#66ff99' : '#8888bb',
                          border: `1px solid ${feedbackGiven.has(entry.response.timestamp) ? '#33aa55' : '#3a3a6e'}`,
                          borderRadius: '4px',
                          cursor: feedbackGiven.has(entry.response.timestamp) ? 'default' : 'pointer',
                          padding: '3px 10px',
                          fontSize: '12px',
                          lineHeight: '1.4',
                        }}
                      >
                        👍 {feedbackGiven.has(entry.response.timestamp) ? 'Thanks!' : 'Helpful'}
                      </button>
                      <button
                        onClick={() => {
                          if (feedbackGiven.has(entry.response.timestamp)) return;
                          setFeedbackGiven(prev => new Set([...prev, entry.response.timestamp]));
                          onSubmitFeedback(entry.response.timestamp, entry.question, 'negative');
                        }}
                        disabled={feedbackGiven.has(entry.response.timestamp)}
                        style={{
                          background: feedbackGiven.has(entry.response.timestamp) ? '#3a1a1a' : '#2a2a4e',
                          color: feedbackGiven.has(entry.response.timestamp) ? '#ff6666' : '#8888bb',
                          border: `1px solid ${feedbackGiven.has(entry.response.timestamp) ? '#aa3333' : '#3a3a6e'}`,
                          borderRadius: '4px',
                          cursor: feedbackGiven.has(entry.response.timestamp) ? 'default' : 'pointer',
                          padding: '3px 10px',
                          fontSize: '12px',
                          lineHeight: '1.4',
                        }}
                      >
                        👎 {feedbackGiven.has(entry.response.timestamp) ? 'Noted' : 'Not helpful'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Streaming entry */}
          {streamingEntry && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                  <div>{streamingEntry.question}</div>
                </div>
              </div>

              {/* Streaming answer bubble */}
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '10px 14px',
                    background: streamingEntry.hasError ? '#3a1a1a' : '#1a1a3e',
                    borderRadius: '14px 14px 14px 4px',
                    border: streamingEntry.hasError ? '1px solid #6a2020' : '1px solid #2a2a5e',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    color: streamingEntry.hasError ? '#ff9999' : '#d0d0f0',
                  }}
                >
                  <div>
                    {streamingEntry.partialAnswer}
                    {!streamingEntry.hasError && !streamingEntry.cancelled && streamingEntry.partialAnswer && (
                      <span style={{ animation: 'blink 1s step-end infinite', marginLeft: '2px' }}>▊</span>
                    )}
                    {streamingEntry.cancelled && !streamingEntry.partialAnswer && (
                      <span style={{ color: '#ff8888' }}>[cancelled]</span>
                    )}
                  </div>

                  {/* Status indicator */}
                  {streamingEntry.partialAnswer && (
                    <div
                      style={{
                        marginTop: '8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '2px 7px',
                        background: streamingEntry.hasError ? '#4a2020' : streamingEntry.cancelled ? '#4a4040' : '#1a2a4e',
                        color: streamingEntry.hasError ? '#ff9999' : streamingEntry.cancelled ? '#aaaaaa' : '#88bbff',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      ● {streamingEntry.hasError ? 'error' : streamingEntry.cancelled ? 'cancelled' : 'generating...'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
