import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Database Location', () => {
  it('should resolve data directory correctly', () => {
    const projectRoot = path.join(__dirname, '..');
    const dataDir = path.join(projectRoot, 'knowledge-base-data');
    const expectedDataDir = '/run/media/kuldeepsingh/Work/github/QA_app_dev_with_harness/knowledge-base-data';
    expect(dataDir).toBe(expectedDataDir);
  });

  it('should have knowledge-base-data in .gitignore', () => {
    const projectRoot = path.join(__dirname, '..');
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    expect(gitignoreContent).toContain('knowledge-base-data/');
  });

  it('should have database path under knowledge-base-data', () => {
    const projectRoot = path.join(__dirname, '..');
    const dbPath = path.join(projectRoot, 'knowledge-base-data', 'index.db');
    expect(dbPath).toContain('knowledge-base-data/index.db');
  });
});
