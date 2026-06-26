# Manual Test Plan: Indexing Status UI

## Feature: indexing-status-ui
**Description:** StatusBar shows indexing progress with document counts and status indicator

## Prerequisites
1. Run `npm install && npm run build && npm start`
2. Have at least 2 test documents ready (.txt or .md files)

## Test Cases

### Test 1: Initial State
**Steps:**
1. Launch the app with no existing documents
2. Observe the status bar at the bottom

**Expected:**
- Status indicator: grey dot + "Index: idle"
- Document count: "Documents: 0 of 0 indexed"
- No "Last activity" shown

**Actual:** [ ]

---

### Test 2: Import Without Indexing
**Steps:**
1. Import a single .txt document
2. Observe the status bar

**Expected:**
- Status indicator: grey dot + "Index: idle"
- Document count: "Documents: 0 of 1 indexed"
- "Last activity" shows current time

**Actual:** [ ]

---

### Test 3: Index Single Document
**Steps:**
1. Select the imported document in the list
2. Click "Index Document" button
3. Observe the status bar update

**Expected:**
- Status indicator changes to: green dot + "Index: ready"
- Document count updates to: "Documents: 1 of 1 indexed"
- "Last activity" timestamp updates
- Document status changes from "imported" to "indexed"

**Actual:** [ ]

---

### Test 4: Partial Indexing
**Steps:**
1. Import 3 documents
2. Index only 2 of them
3. Observe the status bar

**Expected:**
- Status indicator: grey dot + "Index: idle"
- Document count: "Documents: 2 of 3 indexed"
- "Last activity" shows time of last indexing

**Actual:** [ ]

---

### Test 5: Full Library Indexed
**Steps:**
1. Index all remaining documents
2. Observe the status bar

**Expected:**
- Status indicator: green dot + "Index: ready"
- Document count: "Documents: 3 of 3 indexed"
- "Last activity" timestamp updates

**Actual:** [ ]

---

### Test 6: Delete Indexed Document
**Steps:**
1. Delete one indexed document
2. Observe the status bar update

**Expected:**
- Status indicator: green dot + "Index: ready" (all remaining docs indexed)
- Document count: "Documents: 2 of 2 indexed"
- "Last activity" timestamp updates

**Actual:** [ ]

---

### Test 7: Refresh Button
**Steps:**
1. Click the "Refresh" button in the header
2. Observe the status bar updates

**Expected:**
- All status information refreshes correctly
- Counts remain accurate
- "Last activity" updates to current time

**Actual:** [ ]

---

## Status Indicator Colors
- **Grey (#888)**: idle - no documents or not all indexed
- **Yellow (#f0ad4e)**: indexing - currently processing (not implemented in this version)
- **Green (#5cb85c)**: ready - all documents indexed
- **Red (#d9534f)**: error - indexing failed (not fully tested)

## Notes
- The "indexing" status is not tested because indexing completes synchronously
- Error status requires simulating a read failure (manual testing not prioritized)
