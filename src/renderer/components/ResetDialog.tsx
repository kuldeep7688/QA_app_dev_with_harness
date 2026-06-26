import { useCallback } from 'react';

interface ResetDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResetDialog({ onConfirm, onCancel }: ResetDialogProps) {
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  return (
    <div
      onClick={handleOverlayClick}
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
        maxWidth: '400px',
        width: '90%',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}>
        <h3 style={{ margin: '0 0 12px', color: '#e0e0e0', fontSize: '16px' }}>
          Reset Application Data?
        </h3>
        <p style={{ margin: '0 0 20px', color: '#a0a0c0', fontSize: '13px', lineHeight: 1.5 }}>
          This will permanently remove all documents, Q&A history, and feedback.
          This action cannot be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onCancel}
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
            onClick={onConfirm}
            style={{
              padding: '6px 16px',
              background: '#8b0000',
              color: '#fff',
              border: '1px solid #a00000',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
