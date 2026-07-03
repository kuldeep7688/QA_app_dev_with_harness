import { Session } from '../shared-types';

interface SessionListProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString();
}

export function SessionList({ sessions, activeSessionId, onSelect, onCreate, onRename, onDelete }: SessionListProps) {
  return (
    <div className="session-list">
      <button className="new-chat-btn" onClick={onCreate}>+ New Chat</button>
      <div className="session-items">
        {sessions.length === 0 && (
          <div className="session-empty">No conversations yet</div>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="session-title">{s.title}</span>
            <span className="session-meta">
              {s.messageCount > 0 ? `${s.messageCount} messages` : 'Empty'} · {formatDate(s.updatedAt)}
            </span>
            <div className="session-actions">
              <button
                onClick={e => { e.stopPropagation(); const t = prompt('New title:', s.title); if (t && t.trim()) onRename(s.id, t.trim()); }}
                title="Rename"
              >
                ✎
              </button>
              <button
                onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                title="Delete"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
