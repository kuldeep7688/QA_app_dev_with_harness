# Build System Fix: SQL Migration Files

## Problem

When running the app, migrations failed to load:
```
"Loaded migrations","data":{"count":0}
Error: no such table: documents
```

The migration runner couldn't find `001_init.sql` because TypeScript's `tsc` compiler doesn't copy non-TypeScript files (like `.sql`) to the output directory.

## Root Cause

- Migration runner uses `__dirname` to locate `.sql` files
- `__dirname` points to `dist/services/migrations/` at runtime
- `tsc` compiles `.ts` → `.js` but doesn't copy `.sql` files
- Result: runner looks in `dist/services/migrations/` but finds no `.sql` files

## Solution

### 1. Created `scripts/build.sh`

New build script that:
1. Compiles TypeScript with `tsc`
2. **Copies `.sql` files** to `dist/services/migrations/`
3. Builds renderer with Vite

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Building main process..."
tsc -p tsconfig.node.json

echo "Copying SQL migrations..."
mkdir -p dist/services/migrations
cp src/services/migrations/*.sql dist/services/migrations/

echo "Building renderer..."
vite build

echo "Build complete!"
```

### 2. Updated `package.json`

Changed build script to use new `scripts/build.sh`:

```json
"scripts": {
  "build": "bash scripts/build.sh",
  ...
}
```

### 3. Updated `scripts/dev.js`

Added SQL file copying to development workflow:

```javascript
console.log('[dev] Copying SQL migrations...');
const migrationsDir = path.join(root, 'src/services/migrations');
const distMigrationsDir = path.join(root, 'dist/services/migrations');
mkdirSync(distMigrationsDir, { recursive: true });

const sqlFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
for (const file of sqlFiles) {
  copyFileSync(src, dest);
}
```

## Verification

### Before:
```
dist/services/migrations/
├── runner.js
├── runner.d.ts
└── (no SQL files) ❌
```

### After:
```
dist/services/migrations/
├── 001_init.sql ✅
├── runner.js
└── runner.d.ts
```

### Test Results:

```bash
npm run build
# Output: "Copying SQL migrations..."

ls dist/services/migrations/
# 001_init.sql  runner.d.ts  runner.js

npm run dev
# Migrations load successfully: "Loaded migrations","data":{"count":1}
```

## Files Modified

1. **scripts/build.sh** (new) - Production build with SQL copy
2. **scripts/dev.js** (modified) - Development build with SQL copy
3. **package.json** (modified) - Updated build script

## Future Considerations

If more non-TypeScript assets need copying (e.g., `.txt`, `.json` templates), add them to the copy step:

```bash
# In scripts/build.sh
cp src/services/migrations/*.sql dist/services/migrations/
cp src/services/templates/*.json dist/services/templates/
```

Or use a build tool like `esbuild` or `webpack` that can handle asset copying automatically.
