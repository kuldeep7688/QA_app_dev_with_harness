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
        borderTop: '1px solid #0f3460',
        background: '#16213e',
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
          background: isStreaming ? '#1a1a2e' : '#1a1a2e',
          color: '#e0e0e0',
          border: '1px solid #0f3460',
          borderRadius: '6px',
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
            background: '#8b0000',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
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
            background: '#533483',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
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
