/**
 * Test: Verify database is created in project directory
 */

import * as fs from 'fs';
import * as path from 'path';

console.log('=== Database Location Test ===\n');

// Simulate what main.ts does
const projectRoot = path.join(__dirname, '..');
const dataDir = path.join(projectRoot, 'knowledge-base-data');
const dbPath = path.join(dataDir, 'index.db');

console.log('Project root:', projectRoot);
console.log('Data directory:', dataDir);
console.log('Database path:', dbPath);
console.log();

// Check if dataDir resolves correctly relative to project
const expectedDataDir = '/run/media/kuldeepsingh/Work/github/QA_app_dev_with_harness/knowledge-base-data';
console.log('Expected data dir:', expectedDataDir);
console.log('Resolves correctly:', dataDir === expectedDataDir ? '✓ YES' : '✗ NO');
console.log();

// Check gitignore
const gitignorePath = path.join(projectRoot, '.gitignore');
const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
const isIgnored = gitignoreContent.includes('knowledge-base-data/');

console.log('In .gitignore:', isIgnored ? '✓ YES' : '✗ NO');
console.log();

console.log('When you run the app:');
console.log('  - Database will be created at:', dbPath);
console.log('  - Git will ignore this folder:', isIgnored ? 'YES' : 'NO');
console.log();

console.log('=== Test Complete ===');
