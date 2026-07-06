import { AppStatus } from '../shared-types';

interface Props {
  status: AppStatus;
}

export function StatusBar({ status }: Props) {
  const statusColors: Record<AppStatus['indexStatus'], string> = {
    idle: '#888',
    indexing: '#f0ad4e',
    ready: '#5cb85c',
    error: '#d9534f',
  };
  const statusColor = statusColors[status.indexStatus];

  const llmColors: Record<string, string> = {
    healthy: '#5cb85c',
    unhealthy: '#d9534f',
    disabled: '#888',
  };
  const llmColor = llmColors[status.llmStatus ?? 'disabled'];

  return (
    <div style={{
      padding: '4px 20px',
      background: 'var(--bg-statusbar)',
      borderTop: '1px solid var(--border-light)',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      fontSize: '11px',
      color: 'var(--text-muted)',
    }}>
      <span>
        <span className={`status-dot ${status.indexStatus === 'indexing' ? 'active' : ''}`} style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: statusColor,
          marginRight: '6px',
        }} />
        Index: {status.indexStatus}
      </span>
      <span>
        <span className="status-dot" style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: llmColor,
          marginRight: '6px',
        }} />
        LLM: {status.llmStatus ?? 'disabled'}
        {status.llmModel && ` (${status.llmModel})`}
      </span>
      <span>Documents: {status.indexedCount} of {status.documentsLoaded} indexed</span>
      {status.lastActivity && (
        <span>Last activity: {new Date(status.lastActivity).toLocaleTimeString()}</span>
      )}
    </div>
  );
}
