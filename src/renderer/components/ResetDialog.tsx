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
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'var(--bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div className="modal-content" style={{
        background: 'var(--bg-app)',
        border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        maxWidth: '400px',
        width: '90%',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}>
        <h3 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: '16px' }}>
          Reset Application Data?
        </h3>
        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
          This will permanently remove all documents, Q&A history, and feedback.
          This action cannot be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 16px',
              background: 'var(--accent-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--accent-secondary-hover)',
              borderRadius: 'var(--radius-sm)',
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
              background: 'var(--danger)',
              color: '#fff',
              border: '1px solid var(--danger-hover)',
              borderRadius: 'var(--radius-sm)',
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
