import { Document } from '../shared-types';

interface Props {
  documents: Document[];
  onSelect: (doc: Document) => void;
  selectedId: string | null;
}

export function DocumentList({ documents, onSelect, selectedId }: Props) {
  if (documents.length === 0) {
    return (
      <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
        No documents imported yet.
        <br />
        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
          Import documents to get started.
        </span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {documents.map(doc => (
        <div
          key={doc.id}
          onClick={() => onSelect(doc)}
          className="document-list-item"
          style={{
            padding: '10px 16px',
            cursor: 'pointer',
            borderBottom: '1px solid var(--border-light)',
            background: selectedId === doc.id ? 'var(--accent-secondary)' : 'transparent',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{doc.title}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {doc.status === 'indexed' ? '✓ ' : ''}
            {(doc.size / 1024).toFixed(1)} KB
          </div>
        </div>
      ))}
    </div>
  );
}
