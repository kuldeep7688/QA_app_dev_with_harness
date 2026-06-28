const { execSync } = require('child_process');
const { copyFileSync, mkdirSync, readdirSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

console.log('[dev] Building main + preload...');
try {
  execSync('npx tsc -p tsconfig.node.json', { cwd: root, stdio: 'inherit' });
} catch {
  console.error('[dev] TypeScript compilation failed');
  process.exit(1);
}

console.log('[dev] Copying SQL migrations...');
try {
  const migrationsDir = path.join(root, 'src/services/migrations');
  const distMigrationsDir = path.join(root, 'dist/services/migrations');
  mkdirSync(distMigrationsDir, { recursive: true });
  
  const sqlFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  for (const file of sqlFiles) {
    const src = path.join(migrationsDir, file);
    const dest = path.join(distMigrationsDir, file);
    copyFileSync(src, dest);
    console.log(`[dev]   Copied ${file}`);
  }
} catch (err) {
  console.error('[dev] Failed to copy SQL migrations:', err.message);
  process.exit(1);
}

console.log('[dev] Building renderer...');
try {
  execSync('npx vite build', { cwd: root, stdio: 'inherit' });
} catch {
  console.error('[dev] Vite build failed');
  process.exit(1);
}

console.log('[dev] Starting Electron...');
try {
  execSync('npx electron .', { cwd: root, stdio: 'inherit' });
} catch {
  // Electron exits with code 0 on normal close
}
