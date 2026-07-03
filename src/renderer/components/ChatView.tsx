import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SessionList } from './SessionList';
import { ChatInput } from './ChatInput';
import { Session } from '../shared-types';

interface DisplayMessage {
  id: number | string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: any[];
  webResults?: any[];
  tokensUsed?: { prompt: number; completion: number; total: number };
  model?: string;
  createdAt: string;
}

export function ChatView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const currentRequestId = useRef<string | null>(null);
  const chunkUnsub = useRef<(() => void) | null>(null);
  const doneUnsub = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    chunkUnsub.current?.();
    doneUnsub.current?.();
    chunkUnsub.current = null;
    doneUnsub.current = null;
    currentRequestId.current = null;
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const list = await window.knowledgeBase.sessions.list();
      setSessions(list);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const msgs = await window.knowledgeBase.sessions.getMessages(sessionId);
      setMessages(msgs || []);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    loadMessages(activeSessionId);
  }, [activeSessionId, loadMessages]);

  const handleSend = useCallback(async (text: string, tools: any) => {
    if (!activeSessionId) return;

    cleanup();
    const requestId = crypto.randomUUID();
    currentRequestId.current = requestId;

    const userMsg: DisplayMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingContent('');

    chunkUnsub.current = window.knowledgeBase.chat.onStreamChunk((data: any) => {
      if (data.requestId === requestId) {
        setStreamingContent(prev => prev + (data.content || ''));
      }
    });

    doneUnsub.current = window.knowledgeBase.chat.onStreamDone((data: any) => {
      if (data.requestId !== requestId) return;
      setIsStreaming(false);
      if (data.content) {
        const assistantMsg: DisplayMessage = {
          id: `temp-${Date.now()}`,
          role: 'assistant',
          content: data.content,
          tokensUsed: data.tokensUsed,
          model: data.model,
          createdAt: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
      setStreamingContent('');
      cleanup();
      loadSessions();
    });

    window.knowledgeBase.chat.sendStream({
      sessionId: activeSessionId,
      text,
      tools,
      requestId,
    });
  }, [activeSessionId, loadSessions, cleanup]);

  const handleCancel = useCallback(() => {
    const rid = currentRequestId.current;
    if (rid) {
      window.knowledgeBase.chat.cancel(rid);
    }
    setIsStreaming(false);
  }, []);

  const handleCreateSession = useCallback(async () => {
    const session = await window.knowledgeBase.sessions.create();
    setSessions(prev => [session, ...prev]);
    setActiveSessionId(session.id);
    setMessages([]);
  }, []);

  const handleSelectSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    await window.knowledgeBase.sessions.update(id, { title });
    loadSessions();
  }, [loadSessions]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await window.knowledgeBase.sessions.delete(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }, [activeSessionId]);

  return (
    <div className="chat-view">
      <SessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onCreate={handleCreateSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
      />
      <div className="chat-main">
        <div className="chat-messages">
          {!activeSessionId && (
            <div className="chat-empty">Select a session or create a new chat to begin</div>
          )}
          {messages.map(m => (
            <div key={m.id} className={`chat-message ${m.role}`}>
              <div className="message-bubble">
                {m.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                ) : (
                  <div>{m.content}</div>
                )}
                {m.citations && m.citations.length > 0 && (
                  <div className="message-citations">
                    {m.citations.map((c: any, i: number) => (
                      <div key={i} className="citation-chip">📄 {c.documentTitle}</div>
                    ))}
                  </div>
                )}
                {m.webResults && m.webResults.length > 0 && (
                  <div className="message-web-results">
                    {m.webResults.map((r: any, i: number) => (
                      <a key={i} href={r.url} target="_blank" className="web-source-link">🔗 {r.title}</a>
                    ))}
                  </div>
                )}
                {m.tokensUsed && (
                  <div className="message-tokens">{m.tokensUsed.total} tokens</div>
                )}
              </div>
            </div>
          ))}
          {isStreaming && (
            <div className="chat-message assistant">
              <div className="message-bubble streaming">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                <span className="streaming-cursor">▊</span>
              </div>
            </div>
          )}
        </div>
        <ChatInput
          onSend={handleSend}
          isStreaming={isStreaming}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}
