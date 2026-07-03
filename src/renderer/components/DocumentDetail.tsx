import { useEffect, useState } from 'react';
import { Document, Chunk } from '../shared-types';

interface Props {
  document: Document;
  onDelete?: (id: string) => void;
  onIndexed?: () => void;
}

export function DocumentDetail({ document, onDelete, onIndexed }: Props) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [showChunks, setShowChunks] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    window.knowledgeBase.indexing.chunks(document.id).then(setChunks);
  }, [document.id]);

  // Load document content when requested
  const loadContent = async () => {
    if (content) {
      setShowContent(!showContent);
      return;
    }
    setLoadingContent(true);
    try {
      const text = await window.knowledgeBase.documents.getContent(document.id);
      setContent(text);
      setShowContent(true);
    } catch (err) {
      console.error('Failed to load document content:', err);
    } finally {
      setLoadingContent(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
        {document.title}
      </h2>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
        <div>Filename: {document.filename}</div>
        <div>Imported: {new Date(document.importedAt).toLocaleString()}</div>
        <div>Size: {(document.size / 1024).toFixed(1)} KB</div>
        <div>Status: {document.status}</div>
        {document.wordCount !== undefined && <div>Words: {document.wordCount}</div>}
        {document.lineCount !== undefined && <div>Lines: {document.lineCount}</div>}
        {document.fileType && <div>Type: {document.fileType}</div>}
        {document.chunks !== undefined && <div>Chunks: {document.chunks}</div>}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button
          onClick={loadContent}
          disabled={loadingContent}
          style={{
            padding: '6px 12px',
            background: 'var(--accent-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--accent-secondary-hover)',
            borderRadius: '4px',
            cursor: loadingContent ? 'wait' : 'pointer',
            fontSize: '12px',
          }}
        >
          {loadingContent ? 'Loading...' : showContent ? 'Hide Content' : 'View Content'}
        </button>
        <button
          onClick={() => setShowChunks(!showChunks)}
          style={{
            padding: '6px 12px',
            background: 'var(--accent-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--accent-secondary-hover)',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {showChunks ? 'Hide' : 'Show'} Chunks ({chunks.length})
        </button>
        {document.status !== 'indexed' && (
          <button
            onClick={async () => {
              await window.knowledgeBase.indexing.start(document.id);
              if (onIndexed) onIndexed();
            }}
            style={{
              padding: '6px 12px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Index Document
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(document.id)}
            style={{
              padding: '6px 12px',
              background: 'var(--delete)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Delete
          </button>
        )}
      </div>

      {/* Document content viewer */}
      {showContent && content && (
        <div style={{
          padding: '16px',
          background: 'var(--conversation-card-bg)',
          borderRadius: '6px',
          border: '1px solid var(--border-light)',
          fontSize: '13px',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          maxHeight: '400px',
          overflow: 'auto',
          marginBottom: '16px',
        }}>
          {content}
        </div>
      )}

      {showChunks && (
        <div>
          {chunks.map(chunk => (
            <div
              key={chunk.id}
              style={{
                padding: '10px',
                marginBottom: '8px',
                background: 'var(--conversation-card-bg)',
                borderRadius: '4px',
                borderLeft: '3px solid var(--accent)',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Chunk {chunk.index} ({chunk.metadata.charCount} chars)
              </div>
              {chunk.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
