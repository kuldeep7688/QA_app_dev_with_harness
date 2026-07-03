interface Props {
  onImport: (filePath: string) => void;
}

export function ImportPanel({ onImport }: Props) {
  const handleSelectFile = async () => {
    try {
      console.log('[ImportPanel] Button clicked');
      console.log('[ImportPanel] window.knowledgeBase:', window.knowledgeBase);
      console.log('[ImportPanel] window.knowledgeBase.dialog:', window.knowledgeBase?.dialog);
      console.log('[ImportPanel] Opening file dialog...');
      
      if (!window.knowledgeBase) {
        throw new Error('window.knowledgeBase is not defined - preload script may not have loaded');
      }
      
      if (!window.knowledgeBase.dialog) {
        throw new Error('window.knowledgeBase.dialog is not defined - preload may be missing dialog API');
      }
      
      const filePath = await window.knowledgeBase.dialog.showOpenDialog();
      console.log('[ImportPanel] Selected file:', filePath);
      if (filePath) {
        onImport(filePath);
      }
    } catch (error) {
      console.error('[ImportPanel] Error selecting file:', error);
      alert('Error selecting file: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  return (
    <div style={{
      padding: '20px',
      background: 'var(--kb-sidebar-bg)',
      borderRadius: '6px',
      border: '1px dashed var(--border-light)',
      textAlign: 'center',
      color: 'var(--text-muted)',
    }}>
      <div style={{ fontSize: '14px', marginBottom: '8px' }}>Import Documents</div>
      <div style={{ fontSize: '12px', marginBottom: '16px' }}>
        Click the button below to select a file to import.
        <br />
        Supported: .txt, .md files
      </div>
      <button
        onClick={handleSelectFile}
        style={{
          padding: '8px 16px',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        Select File
      </button>
    </div>
  );
}
