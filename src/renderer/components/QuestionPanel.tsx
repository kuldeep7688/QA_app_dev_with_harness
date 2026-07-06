import React, { useState } from 'react';

interface Props {
  onAsk: (question: string) => void;
  onCancel?: () => void;
  isStreaming?: boolean;
}

export function QuestionPanel({ onAsk, onCancel, isStreaming }: Props) {
  const [question, setQuestion] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    onAsk(question.trim());
    setQuestion('');
  };

  const handleCancel = () => {
    onCancel?.();
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        padding: '12px 20px',
        borderTop: '1px solid var(--border-light)',
        background: 'var(--kb-sidebar-bg)',
      }}
    >
      <input
        type="text"
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="Ask a question about your documents..."
        disabled={isStreaming}
        style={{
          flex: 1,
          padding: '10px 14px',
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-light)',
          borderRadius: 'var(--radius-md)',
          fontSize: '14px',
          outline: 'none',
          opacity: isStreaming ? 0.6 : 1,
        }}
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={handleCancel}
          style={{
            marginLeft: '10px',
            padding: '10px 20px',
            background: 'var(--danger)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          Cancel
        </button>
      ) : (
        <button
          type="submit"
          style={{
            marginLeft: '10px',
            padding: '10px 20px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          Ask
        </button>
      )}
    </form>
  );
}
