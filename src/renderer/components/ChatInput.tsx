import { useState, useCallback, useRef } from 'react';
import { UploadedFileData } from '../shared-types';

interface ChatInputProps {
  onSend: (text: string, tools: { kbEnabled: boolean; webEnabled: boolean; files?: UploadedFileData[] }) => void;
  isStreaming: boolean;
  onCancel: () => void;
}

export function ChatInput({ onSend, isStreaming, onCancel }: ChatInputProps) {
  const [text, setText] = useState('');
  const [kbEnabled, setKbEnabled] = useState(false);
  const [webEnabled, setWebEnabled] = useState(false);
  const [files, setFiles] = useState<UploadedFileData[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!text.trim() && files.length === 0) return;
    onSend(text.trim(), { kbEnabled, webEnabled, files: files.length > 0 ? files : undefined });
    setText('');
    setFiles([]);
  }, [text, kbEnabled, webEnabled, files, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFilePick = useCallback(async () => {
    try {
      const filePath = await window.knowledgeBase.dialog.showOpenDialog();
      if (filePath) {
        const result = await window.knowledgeBase.app.readFile(filePath);
        if (result) {
          setFiles(prev => [...prev, { name: result.name, content: result.content, type: result.type }]);
        }
      }
    } catch (err) {
      console.error('File pick failed:', err);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div className="chat-input-container">
      {files.length > 0 && (
        <div className="chat-input-files">
          {files.map((f, i) => (
            <span key={i} className="file-chip">
              {f.name} <button onClick={() => removeFile(i)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input-tools">
        <button
          className={`tool-toggle ${kbEnabled ? 'active' : ''}`}
          onClick={() => setKbEnabled(!kbEnabled)}
          title="Search Knowledge Base"
        >
          KB
        </button>
        <button
          className={`tool-toggle ${webEnabled ? 'active' : ''}`}
          onClick={() => setWebEnabled(!webEnabled)}
          title="Search Web"
        >
          Web
        </button>
        <button
          className="tool-toggle"
          onClick={handleFilePick}
          title="Upload File"
        >
          📎
        </button>
      </div>
      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isStreaming}
          rows={2}
        />
        {isStreaming ? (
          <button className="cancel-btn" onClick={onCancel}>Cancel</button>
        ) : (
          <button className="send-btn" onClick={handleSend} disabled={!text.trim() && files.length === 0}>Send</button>
        )}
      </div>
    </div>
  );
}
