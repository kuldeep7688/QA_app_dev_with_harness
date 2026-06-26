# Clean State Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Reset button with confirmation dialog that clears all persisted data and returns the app to empty state.

**Architecture:** A new `PersistenceService.resetAll()` method removes/recreates the data directory. A new `app:reset` IPC channel exposes it to the renderer. A new `ResetDialog` component provides the confirmation UX.

**Tech Stack:** Electron, TypeScript, React, filesystem (fs.rmSync)

---

### File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `src/shared/types.ts` | Add `RESET_DATA` channel | IPC channel definition |
| `src/services/persistence-service.ts` | Add `resetAll()` | Remove + recreate data dir |
| `src/main/ipc-handlers.ts` | Register handler | Wire app:reset to resetAll |
| `src/preload/preload.ts` | Expose `app.resetData()` | Bridge to renderer |
| `src/renderer/types.d.ts` | Add `app` namespace | TypeScript type for preload API |
| `src/renderer/components/ResetDialog.tsx` (new) | Create dialog | Confirmation UI |
| `src/renderer/App.tsx` | Add button + wiring | Header button, state, callbacks |

---

### Task 1: Add IPC channel constant

**Files:**
- Modify: `src/shared/types.ts` (add to `IPC_CHANNELS`)

- [ ] **Step 1: Add `RESET_DATA` to IPC_CHANNELS**

In `src/shared/types.ts`, add after the `SHOW_OPEN_DIALOG` line:

```typescript
  // App
  RESET_DATA: 'app:reset',
```

- [ ] **Step 2: Verify no compilation errors yet**

Run: `npx tsc --noEmit`
Expected: passes (the new constant is defined but unused — that's fine for now)

---

### Task 2: Add PersistenceService.resetAll()

**Files:**
- Modify: `src/services/persistence-service.ts` (add method after `getIndexDir()`)

- [ ] **Step 1: Add `resetAll()` method**

After line 189 (`getIndexDir` closing brace), add:

```typescript
  resetAll(): void {
    log.warn('Resetting all data', { dataDir: this.dataDir });
    try {
      if (fs.existsSync(this.dataDir)) {
        fs.rmSync(this.dataDir, { recursive: true, force: true });
      }
      this.ensureDirectories();
      log.info('Data directory reset complete', { dataDir: this.dataDir });
    } catch (error) {
      log.error('Failed to reset data directory', {
        dataDir: this.dataDir,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
```

---

### Task 3: Register IPC handler for app:reset

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Add app:reset handler**

Add to `registerIpcHandlers()` after the `SHOW_OPEN_DIALOG` handler (before the logging loop):

```typescript
  // App reset
  ipcMain.handle(IPC_CHANNELS.RESET_DATA, async () => {
    log.info('IPC received', { channel: IPC_CHANNELS.RESET_DATA });
    persistenceService.resetAll();
  });
```

Note: `persistenceService` is not in the `Services` interface yet. We need to expose it.

- [ ] **Step 2: Add PersistenceService to the Services interface and injection**

Update the `Services` interface:

```typescript
export interface Services {
  documentService: DocumentService;
  indexingService: IndexingService;
  qaService: QaService;
  persistenceService: PersistenceService;
}
```

Add import at top:

```typescript
import { PersistenceService } from '../services/persistence-service';
```

Update the destructuring in `registerIpcHandlers`:

```typescript
  const { documentService, indexingService, qaService, persistenceService } = services;
```

---

### Task 4: Wire PersistenceService in main.ts

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Pass persistenceService to registerIpcHandlers**

```typescript
  registerIpcHandlers(ipcMain, {
    documentService,
    indexingService,
    qaService,
    persistenceService, // add this
  });
```

---

### Task 5: Expose app.resetData() in preload

**Files:**
- Modify: `src/preload/preload.ts`

- [ ] **Step 1: Add RESET_DATA channel and app namespace**

Add to the inline `IPC_CHANNELS`:

```typescript
  RESET_DATA: 'app:reset',
```

Add an `app` namespace to the `api` object (after the `feedback` block):

```typescript
  app: {
    resetData: () => ipcRenderer.invoke(IPC_CHANNELS.RESET_DATA),
  },
```

---

### Task 6: Add app type to renderer types.d.ts

**Files:**
- Modify: `src/renderer/types.d.ts`

- [ ] **Step 1: Add `app` namespace to the Window interface**

After the `dialog` block:

```typescript
      app: {
        resetData: () => Promise<void>;
      };
```

---

### Task 7: Create ResetDialog component

**Files:**
- Create: `src/renderer/components/ResetDialog.tsx`

- [ ] **Step 1: Write the dialog component**

```typescript
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
```

---

### Task 8: Wire Reset button and dialog in App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add state and handler**

Add `showResetDialog` state after `showHistory` state:

```typescript
  const [showResetDialog, setShowResetDialog] = useState(false);
```

Add `handleReset` callback after `handleShowHistory`:

```typescript
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
      });
      setShowResetDialog(false);
    } catch (err) {
      console.error('Reset failed:', err);
    }
  }, []);
```

Import `ResetDialog` at top:

```typescript
import { ResetDialog } from './components/ResetDialog';
```

- [ ] **Step 2: Add Reset button to header**

In the header `div` with `gap: '8px'`, add before the Refresh button:

```typescript
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
```

- [ ] **Step 3: Render ResetDialog when showResetDialog is true**

After the `</header>` closing tag and before the `div` with `display: 'flex', flex: 1`:

```typescript
      {showResetDialog && (
        <ResetDialog
          onConfirm={handleReset}
          onCancel={() => setShowResetDialog(false)}
        />
      )}
```

---

### Task 9: Build and test

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: builds successfully

- [ ] **Step 3: Update feature_list.json**

Set `clean-state-reset` to `"pass"` with evidence like:
```
"evidence": "Added app:reset IPC channel, PersistenceService.resetAll(), ResetDialog component with dark-themed confirmation dialog. Reset button in header clears all documents, history, feedback, and returns app to empty state."
```

- [ ] **Step 4: Run cleanup scanner**

Run: `bash scripts/cleanup-scanner.sh`
Expected: `Result: CLEAN (0 issues)`

- [ ] **Step 5: Run clean-state-checklist**

Run through relevant items from `clean-state-checklist.md`:
- `npm run check` passes
- `npm run build` succeeds
- No `fs`/`path` in renderer (ResetDialog is UI only)
- app:reset channel defined in types.ts
- app.resetData() exposed in preload

---

### Task 10: Update documentation

**Files:**
- Modify: `session-handoff.md`
- Modify: `agent-progress.md`

- [ ] **Step 1: Update session-handoff.md** with feature status, files modified

- [ ] **Step 2: Update agent-progress.md** with implementation details
