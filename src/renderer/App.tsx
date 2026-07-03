import { useState, useCallback, useEffect, useRef } from 'react';
import { DocumentList } from './components/DocumentList';
import { QuestionPanel } from './components/QuestionPanel';
import { DocumentDetail } from './components/DocumentDetail';
import { ImportPanel } from './components/ImportPanel';
import { StatusBar } from './components/StatusBar';
import { ConversationHistory } from './components/ConversationHistory';
import { ResetDialog } from './components/ResetDialog';
import { SettingsPanel } from './components/SettingsPanel';
import { Document, AppStatus, QAHistory, TokenUsage } from './shared-types';

export function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [appStatus, setAppStatus] = useState<AppStatus>({
    documentsLoaded: 0,
    indexStatus: 'idle',
    lastActivity: '',
    indexedCount: 0,
    vectorEnabled: false,
    llmEnabled: false,
  });
  const [history, setHistory] = useState<QAHistory[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Streaming state
  const [streamingEntry, setStreamingEntry] = useState<{ question: string; partialAnswer: string; hasError: boolean; cancelled: boolean } | null>(null);

  // Cumulative token tracking (in-memory, resets on app restart)
  const [sessionTokens, setSessionTokens] = useState<TokenUsage>({ prompt: 0, completion: 0, total: 0 });
  const currentRequestId = useRef<string | null>(null);
  const unsubChunk = useRef<(() => void) | null>(null);
  const unsubDone = useRef<(() => void) | null>(null);

  // Set up streaming event listeners once
  useEffect(() => {
    unsubChunk.current = window.knowledgeBase.qa.onStreamChunk((data) => {
      if (data.requestId !== currentRequestId.current) return;
      if (data.chunk.type === 'delta' && data.chunk.content) {
        setStreamingEntry(prev => prev ? { ...prev, partialAnswer: prev.partialAnswer + data.chunk.content! } : prev);
      } else if (data.chunk.type === 'error') {
        setStreamingEntry(prev => prev ? { ...prev, hasError: true, partialAnswer: prev.partialAnswer + (data.chunk.error ? `\n\n${data.chunk.error}` : '') } : prev);
      }
    });

    unsubDone.current = window.knowledgeBase.qa.onStreamDone((data) => {
      if (data.requestId !== currentRequestId.current) return;
      currentRequestId.current = null;
      setStreamingEntry(null);
      const tokens = data.response?.tokensUsed;
      if (tokens) {
        setSessionTokens(prev => ({
          prompt: prev.prompt + tokens.prompt,
          completion: prev.completion + tokens.completion,
          total: prev.total + tokens.total,
        }));
      }
      refreshHistory();
    });

    return () => {
      unsubChunk.current?.();
      unsubDone.current?.();
    };
  }, []);

  // Verify preload loaded
  useEffect(() => {
    console.log('[Renderer] Checking window.knowledgeBase...');
    console.log('[Renderer] window.knowledgeBase exists?', !!window.knowledgeBase);
    if (window.knowledgeBase) {
      console.log('[Renderer] window.knowledgeBase.dialog exists?', !!window.knowledgeBase.dialog);
      console.log('[Renderer] window.knowledgeBase.documents exists?', !!window.knowledgeBase.documents);
      console.log('[Renderer] Full API:', Object.keys(window.knowledgeBase));
    } else {
      console.error('[Renderer] ❌ window.knowledgeBase is NOT defined! Preload script did not load.');
    }
  }, []);

  // Load documents and history on mount
  useEffect(() => {
    refreshDocuments();
    refreshHistory();
  }, []);

  const refreshDocuments = useCallback(async () => {
    try {
      const docs = await window.knowledgeBase.documents.list();
      setDocuments(docs);
      const status = await window.knowledgeBase.indexing.status();
      setAppStatus(status);
    } catch (err) {
      console.error('Failed to refresh documents:', err);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const h = await window.knowledgeBase.qa.history();
      setHistory(h);
      // Compute cumulative session totals from history
      const totals = h.reduce(
        (acc, entry) => {
          if (entry.response.tokensUsed) {
            acc.prompt += entry.response.tokensUsed.prompt;
            acc.completion += entry.response.tokensUsed.completion;
            acc.total += entry.response.tokensUsed.total;
          }
          return acc;
        },
        { prompt: 0, completion: 0, total: 0 },
      );
      setSessionTokens(totals);
    } catch (err) {
      console.error('Failed to refresh history:', err);
    }
  }, []);

  const handleImport = useCallback(async (filePath: string) => {
    try {
      await window.knowledgeBase.documents.import(filePath);
      await refreshDocuments();
      setShowImport(false);
    } catch (err) {
      console.error('Import failed:', err);
    }
  }, [refreshDocuments]);

  const handleSelectDocument = useCallback((doc: Document) => {
    setSelectedDoc(doc);
    setShowHistory(false);
  }, []);

  const handleAskQuestion = useCallback(async (question: string) => {
    try {
      const requestId = await window.knowledgeBase.qa.askStream(question);
      currentRequestId.current = requestId;
      setStreamingEntry({ question, partialAnswer: '', hasError: false, cancelled: false });
      setShowHistory(true);
      setShowImport(false);
    } catch (err) {
      console.error('Streaming Q&A failed:', err);
    }
  }, []);

  const handleCancelQuestion = useCallback(async () => {
    if (currentRequestId.current) {
      try {
        await window.knowledgeBase.qa.cancel(currentRequestId.current);
      } catch (err) {
        console.error('Cancel failed:', err);
      }
      setStreamingEntry(prev => prev ? { ...prev, cancelled: true } : prev);
    }
  }, []);

  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await window.knowledgeBase.documents.delete(id);
      if (selectedDoc?.id === id) {
        setSelectedDoc(null);
      }
      await refreshDocuments();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [selectedDoc, refreshDocuments]);

  const handleClearHistory = useCallback(async () => {
    try {
      await window.knowledgeBase.qa.clearHistory();
      setHistory([]);
      setSessionTokens({ prompt: 0, completion: 0, total: 0 });
    } catch (err) {
      console.error('Clear history failed:', err);
    }
  }, []);

  const handleSubmitFeedback = useCallback(async (
    responseTimestamp: string,
    question: string,
    rating: 'positive' | 'negative',
  ) => {
    try {
      await window.knowledgeBase.feedback.submit(responseTimestamp, question, rating);
    } catch (err) {
      console.error('Feedback submission failed:', err);
    }
  }, []);

  const handleShowHistory = useCallback(() => {
    setShowHistory(true);
    setShowImport(false);
  }, []);

  const handleReset = useCallback(async () => {
    try {
      await window.knowledgeBase.app.resetData();
      setDocuments([]);
      setHistory([]);
      setSelectedDoc(null);
      setShowHistory(false);
      setShowImport(false);
      setAppStatus({
        documentsLoaded: 0,
        indexStatus: 'idle',
        lastActivity: '',
        indexedCount: 0,
        vectorEnabled: false,
        llmEnabled: false,
      });
      setShowResetDialog(false);
    } catch (err) {
      console.error('Reset failed:', err);
    }
  }, []);

  const isStreaming = currentRequestId.current !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{
        padding: '12px 20px',
        background: '#16213e',
        borderBottom: '1px solid #0f3460',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600 }}>Knowledge Base</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleShowHistory}
            style={{
              padding: '6px 14px',
              background: showHistory ? '#533483' : '#0f3460',
              color: '#e0e0e0',
              border: `1px solid ${showHistory ? '#7044bb' : '#1a1a4e'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            History {history.length > 0 ? `(${history.length})` : ''}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              padding: '6px 14px',
              background: showSettings ? '#533483' : '#0f3460',
              color: '#e0e0e0',
              border: '1px solid #1a1a4e',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Settings
          </button>
          <button
            onClick={() => setShowResetDialog(true)}
            style={{
              padding: '6px 14px',
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
          <button
            onClick={refreshDocuments}
            style={{
              padding: '6px 14px',
              background: '#0f3460',
              color: '#e0e0e0',
              border: '1px solid #1a1a4e',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {showResetDialog && (
        <ResetDialog
          onConfirm={handleReset}
          onCancel={() => setShowResetDialog(false)}
        />
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left panel: Document list */}
        <div style={{
          width: '280px',
          borderRight: '1px solid #0f3460',
          display: 'flex',
          flexDirection: 'column',
          background: '#16213e',
        }}>
          <div style={{
            padding: '10px 16px',
            borderBottom: '1px solid #0f3460',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#a0a0c0' }}>
              Documents ({documents.length})
            </span>
            <button
              onClick={() => {
                setShowImport(!showImport);
                if (!showImport) setShowHistory(false);
              }}
              style={{
                padding: '4px 10px',
                background: '#533483',
                color: '#fff',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {showImport ? 'Cancel' : '+ Import'}
            </button>
          </div>
          <DocumentList
            documents={documents}
            onSelect={handleSelectDocument}
            selectedId={selectedDoc?.id ?? null}
          />
        </div>

        {/* Right panel: Import / Conversation History / Document detail */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            {showImport ? (
              <ImportPanel onImport={handleImport} />
            ) : showHistory ? (
              <ConversationHistory
                history={history}
                onClearHistory={handleClearHistory}
                onSubmitFeedback={handleSubmitFeedback}
                streamingEntry={streamingEntry}
                sessionTokens={sessionTokens}
              />
            ) : selectedDoc ? (
              <DocumentDetail
                document={selectedDoc}
                onDelete={handleDeleteDocument}
                onIndexed={refreshDocuments}
              />
            ) : (
              <div style={{ color: '#666', textAlign: 'center', paddingTop: '40px' }}>
                Select a document or ask a question to get started
              </div>
            )}
          </div>

          <QuestionPanel onAsk={handleAskQuestion} onCancel={handleCancelQuestion} isStreaming={isStreaming} />
        </div>
      </div>

      <StatusBar status={appStatus} />
    </div>
  );
}
