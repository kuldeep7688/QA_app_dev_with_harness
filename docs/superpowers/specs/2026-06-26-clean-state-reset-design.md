# Clean State Reset -- Design

## Summary

Add a Reset button in the application header that, after confirmation, clears all persisted data (documents, chunks, Q&A history, feedback) and returns the app to its initial empty state.

## Requirements (from PRODUCT.md)

- Reset button in application header
- Confirmation dialog before reset
- Clears all documents, chunks, Q&A history, and feedback
- Application returns to initial empty state
- Data directory is removed and recreated

## Data Layer

### PersistenceService.resetAll()

New method on the existing `PersistenceService` class:

1. `fs.rmSync(this.dataDir, { recursive: true, force: true })` to remove the entire data directory tree
2. Re-run `ensureDirectories()` to recreate the directory structure
3. Log at WARN level (per RELIABILITY.md: "Clean state reset (WARN)")

### IPC

- Add `RESET_DATA: 'app:reset'` to the `IPC_CHANNELS` constant in `src/shared/types.ts`
- Register handler in `ipc-handlers.ts` that delegates to `PersistenceService.resetAll()`
- Log at INFO level per IPC conventions
- Expose as `app.resetData()` in `src/preload/preload.ts`
- Add type declaration in `src/renderer/types.d.ts`

## UI

### Reset Button

Add a "Reset" button to the existing header bar, styled consistently with the "History" and "Refresh" buttons but with a distinct red-ish color to indicate destructiveness.

### Confirmation Dialog (`ResetDialog`)

Custom React component with:
- Dark overlay (semi-transparent black) covering the full viewport
- Centered dialog card with:
  - Title: "Reset Application Data?"
  - Message: "This will permanently remove all documents, Q&A history, and feedback. This action cannot be undone."
  - Two buttons: "Cancel" (dismisses dialog) and "Reset" (triggers the reset flow)
- Styled to match the app's dark theme

### Reset Flow (App.tsx)

1. User clicks "Reset" button in header
2. `showResetDialog` state set to `true`, dialog renders
3. User clicks "Reset" in the dialog
4. `handleReset()` called:
   a. `await window.knowledgeBase.app.resetData()`
   b. Clear all React state: `setDocuments([])`, `setHistory([])`, `setSelectedDoc(null)`, `setShowHistory(false)`, `setShowImport(false)`
   c. Refresh app status via `refreshDocuments()`
5. Dialog auto-closes (showResetDialog = false)
6. User sees empty app state with "Select a document or ask a question to get started"

## Files Modified

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `RESET_DATA: 'app:reset'` to IPC_CHANNELS |
| `src/services/persistence-service.ts` | Add `resetAll()` method |
| `src/main/ipc-handlers.ts` | Register handler for `app:reset` channel |
| `src/preload/preload.ts` | Expose `app.resetData()` via contextBridge |
| `src/renderer/types.d.ts` | Add `app: { resetData: () => Promise<void> }` |
| `src/renderer/App.tsx` | Add Reset button, dialog state, handleReset callback |
| `src/renderer/components/ResetDialog.tsx` | New file: confirmation dialog component |

## Verification

- `npm run check` passes with 0 errors
- `npm run build` succeeds
- Feature appears in `feature_list.json` with status `"pass"`
- `clean-state-checklist.md` passes all checks
- Manual: click Reset → dialog appears → confirm → all data cleared, app shows empty state
