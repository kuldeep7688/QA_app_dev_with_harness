import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { QAHistory, Citation, TokenUsage } from '../shared-types';

interface ConversationHistoryProps {
  history: QAHistory[];
  onClearHistory: () => void;
  onSubmitFeedback: (responseTimestamp: string, question: string, rating: 'positive' | 'negative') => void;
  streamingEntry?: { question: string; partialAnswer: string; hasError: boolean; cancelled: boolean } | null;
  sessionTokens?: TokenUsage;
}

/** Format ISO timestamp to a readable local time string. */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Format token count in human-readable form: 1.2K, 350, 14.5K */
function formatTokens(count: number): string {
  if (count >= 1000) {
    const k = count / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return String(count);
}

/** Color-code confidence: green ≥ 0.7, yellow ≥ 0.4, red otherwise. */
function confidenceStyle(confidence: number): { background: string; color: string; label: string } {
  if (confidence >= 0.7) {
    return { background: 'var(--success-bg)', color: 'var(--success-text)', label: 'high' };
  }
  if (confidence >= 0.4) {
    return { background: 'var(--warning-bg)', color: 'var(--warning-text)', label: 'medium' };
  }
  return { background: 'var(--danger-bg)', color: 'var(--danger-text)', label: 'low' };
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
    return { label: 'Hybrid', bg: 'var(--accent-text-bg)', color: 'var(--accent-hover)' };
  }
  if (c.sources.includes('bm25') && c.bm25Rank !== undefined) {
    return { label: `BM25 #${c.bm25Rank}`, bg: 'var(--info-bg)', color: 'var(--info-text)' };
  }
  if (c.sources.includes('vector') && c.vectorRank !== undefined) {
    return { label: `Vector #${c.vectorRank}`, bg: 'var(--success-bg)', color: 'var(--success-text)' };
  }
  return { label: c.sources[0] || '—', bg: 'var(--badge-bg)', color: 'var(--badge-text)' };
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
          color: 'var(--badge-text)',
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
                  borderLeft: '2px solid var(--quote-border)',
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
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text-bright)' }}>{c.documentTitle}</strong>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>(chunk {c.chunkIndex})</span>
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

const markdownComponents = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          style={{
            background: 'var(--bg-hover)',
            padding: '1px 5px',
            borderRadius: '3px',
            fontSize: '13px',
            color: 'var(--code-text)',
          }}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <pre
        style={{
          background: 'var(--bg-code)',
          padding: '12px',
          borderRadius: '6px',
          overflowX: 'auto',
          border: '1px solid var(--border)',
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--text-bright)',
        }}
      >
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div style={{ overflowX: 'auto', marginTop: '8px', marginBottom: '8px' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: '13px',
            color: 'var(--text-primary)',
          }}
        >
          {children}
        </table>
      </div>
    );
  },
  th({ children }: { children?: React.ReactNode }) {
    return (
      <th
        style={{
          border: '1px solid var(--border-card)',
          padding: '6px 10px',
          background: 'var(--bg-card)',
          textAlign: 'left',
          fontWeight: 600,
        }}
      >
        {children}
      </th>
    );
  },
  td({ children }: { children?: React.ReactNode }) {
    return (
      <td style={{ border: '1px solid var(--border-card)', padding: '6px 10px' }}>
        {children}
      </td>
    );
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return (
      <blockquote
        style={{
          borderLeft: '3px solid var(--quote-border)',
          margin: '8px 0',
          padding: '4px 12px',
          color: 'var(--text-secondary)',
          background: 'var(--quote-bg)',
        }}
      >
        {children}
      </blockquote>
    );
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--link)' }}>
        {children}
      </a>
    );
  },
};

export function ConversationHistory({ history, onClearHistory, onSubmitFeedback, streamingEntry, sessionTokens }: ConversationHistoryProps) {
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
          borderBottom: '1px solid var(--border-light)',
          marginBottom: '16px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-bright)' }}>
          Conversation History
          {history.length > 0 && (
            <span
              style={{
                marginLeft: '8px',
                fontSize: '12px',
                fontWeight: 400,
                color: 'var(--text-dim)',
              }}
            >
              ({history.length} exchange{history.length !== 1 ? 's' : ''})
            </span>
          )}
          {sessionTokens && sessionTokens.total > 0 && (
            <span
              style={{
                marginLeft: '8px',
                fontSize: '11px',
                fontWeight: 400,
                color: 'var(--text-dim)',
              }}
            >
              · {formatTokens(sessionTokens.total)} tokens total
            </span>
          )}
        </span>

        {history.length > 0 && (
          <button
            onClick={handleClearClick}
            style={{
              padding: '4px 10px',
              background: confirmClear ? 'var(--danger-bg)' : 'var(--bg-hover)',
              color: confirmClear ? 'var(--danger-text)' : 'var(--badge-text)',
              border: `1px solid ${confirmClear ? 'var(--danger)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
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
            color: 'var(--text-dim)',
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
              <div key={idx} className="qa-entry" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* User question bubble — right-aligned, purple */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      maxWidth: '75%',
                      padding: '10px 14px',
                      background: 'var(--chat-user-bg)',
                      borderRadius: '14px 14px 4px 14px',
                      fontSize: '14px',
                      lineHeight: 1.5,
                      color: 'var(--chat-user-text)',
                    }}
                  >
                    <div>{entry.question}</div>
                  </div>
                </div>

                {/* Assistant answer bubble — left-aligned, dark */}
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '80%',
                      padding: '10px 14px',
                      background: 'var(--conversation-card-bg)',
                      borderRadius: '14px 14px 14px 4px',
                      border: '1px solid var(--chat-assistant-border)',
                      fontSize: '14px',
                      lineHeight: 1.6,
                      color: 'var(--chat-assistant-text)',
                    }}
                  >
                    <div><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{entry.response.answer}</ReactMarkdown></div>

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

                    {/* Token usage and timestamp */}
                    <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-dim)' }}>
                      {entry.response.tokensUsed
                        ? `${formatTokens(entry.response.tokensUsed.total)} tokens · ${formatTime(entry.response.timestamp)}`
                        : formatTime(entry.response.timestamp)
                      }
                      {entry.response.modelUsed ? ` · ${entry.response.modelUsed}` : ''}
                    </div>

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
                          background: feedbackGiven.has(entry.response.timestamp) ? 'var(--success-bg)' : 'var(--bg-hover)',
                          color: feedbackGiven.has(entry.response.timestamp) ? 'var(--success-text)' : 'var(--badge-text)',
                          border: `1px solid ${feedbackGiven.has(entry.response.timestamp) ? 'var(--success-text)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius-sm)',
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
                          background: feedbackGiven.has(entry.response.timestamp) ? 'var(--danger-bg)' : 'var(--bg-hover)',
                          color: feedbackGiven.has(entry.response.timestamp) ? 'var(--danger-text)' : 'var(--badge-text)',
                          border: `1px solid ${feedbackGiven.has(entry.response.timestamp) ? 'var(--danger)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius-sm)',
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
                    background: 'var(--chat-user-bg)',
                    borderRadius: '14px 14px 4px 14px',
                    fontSize: '14px',
                    lineHeight: 1.5,
                    color: 'var(--chat-user-text)',
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
                    background: streamingEntry.hasError ? 'var(--danger-bg)' : 'var(--conversation-card-bg)',
                    borderRadius: '14px 14px 14px 4px',
                    border: streamingEntry.hasError ? '1px solid var(--danger)' : '1px solid var(--chat-assistant-border)',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    color: streamingEntry.hasError ? 'var(--danger-text)' : 'var(--chat-assistant-text)',
                  }}
                >
                  <div>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{streamingEntry.partialAnswer}</ReactMarkdown>
                    {!streamingEntry.hasError && !streamingEntry.cancelled && streamingEntry.partialAnswer && (
                      <span className="streaming-cursor" style={{ marginLeft: '2px' }}>▊</span>
                    )}
                    {streamingEntry.cancelled && !streamingEntry.partialAnswer && (
                      <span style={{ color: 'var(--danger-text)' }}>[cancelled]</span>
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
                        background: streamingEntry.hasError ? 'var(--danger-bg)' : streamingEntry.cancelled ? 'var(--bg-card)' : 'var(--info-bg)',
                        color: streamingEntry.hasError ? 'var(--danger-text)' : streamingEntry.cancelled ? 'var(--text-muted)' : 'var(--info-text)',
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
