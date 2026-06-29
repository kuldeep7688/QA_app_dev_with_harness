import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PersistenceService } from '../src/services/persistence-service';
import { SettingsService } from '../src/services/settings-service';
import type { RetrievalSettings } from '../src/shared/types';

const tempRoot = path.join(os.tmpdir(), 'kb-settings-test-' + Date.now());
const dataDir = path.join(tempRoot, 'data');
fs.mkdirSync(tempRoot, { recursive: true });

let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}${detail ? ' -- ' + detail : ''}`);
    failed++;
  }
}

async function run() {
  const persistence = new PersistenceService(dataDir);

  // Test 1: Default settings on first launch
  const settings = new SettingsService(persistence);
  const defaults = settings.get();
  check('Default mode is hybrid', defaults.retrievalMode === 'hybrid');
  check('Default topK is 5', defaults.topK === 5);
  check('Default topN is 20', defaults.topN === 20);
  check('Default rrfK is 60', defaults.rrfK === 60);
  check('Default embeddingsEnabled is true', defaults.embeddingsEnabled === true);
  check('Settings file created after get', persistence.exists('settings.json'));

  // Test 2: Settings persist to disk
  const settings2 = new SettingsService(persistence);
  const fromDisk = settings2.get();
  check('Cached settings persist across instances', fromDisk.retrievalMode === 'hybrid');
  check('topK persists', fromDisk.topK === 5);

  // Test 3: Update settings
  const updated = settings.set({ retrievalMode: 'bm25', topK: 3, rrfK: 30 });
  check('Updated mode is bm25', updated.retrievalMode === 'bm25');
  check('Updated topK is 3', updated.topK === 3);
  check('Updated rrfK is 30', updated.rrfK === 30);
  check('topN unchanged from default', updated.topN === 20);
  check('embeddingsEnabled unchanged', updated.embeddingsEnabled === true);

  // Test 4: Updated settings load from disk
  const settings3 = new SettingsService(persistence);
  const reloaded = settings3.get();
  check('bm25 mode loaded from disk', reloaded.retrievalMode === 'bm25');
  check('topK=3 loaded from disk', reloaded.topK === 3);
  check('rrfK=30 loaded from disk', reloaded.rrfK === 30);

  // Test 5: Cache works (same instance returns cached values without re-reading)
  const cached = settings.get();
  check('Cache returns same mode', cached.retrievalMode === 'bm25');
  check('Cache returns same topK', cached.topK === 3);

  // Test 6: Invalid values rejected
  const beforeInvalid = settings.get();
  const afterInvalidMode = settings.set({ retrievalMode: 'invalid' as any });
  check('Invalid mode rejected', afterInvalidMode.retrievalMode === beforeInvalid.retrievalMode);

  const afterInvalidTopK = settings.set({ topK: -1 });
  check('Negative topK rejected', afterInvalidTopK.topK === beforeInvalid.topK);

  const afterInvalidTopN = settings.set({ topN: 0 });
  check('Zero topN rejected', afterInvalidTopN.topN === beforeInvalid.topN);

  const afterInvalidRrfK = settings.set({ rrfK: -5 });
  check('Negative rrfK rejected', afterInvalidRrfK.rrfK === beforeInvalid.rrfK);

  const afterInvalidFloat = settings.set({ topK: 3.5 });
  check('Float topK rejected', afterInvalidFloat.topK === beforeInvalid.topK);

  const afterInvalidBool = settings.set({ embeddingsEnabled: 'yes' as any });
  check('Non-boolean embeddingsEnabled rejected', afterInvalidBool.embeddingsEnabled === beforeInvalid.embeddingsEnabled);

  // Test 7: Partial update preserves other values
  settings.set({ retrievalMode: 'hybrid', topK: 5, topN: 20, rrfK: 60, embeddingsEnabled: true });
  const partial = settings.set({ topK: 10 });
  check('Partial update preserves mode', partial.retrievalMode === 'hybrid');
  check('Partial update preserves topN', partial.topN === 20);
  check('Partial update sets topK to 10', partial.topK === 10);

  // Test 8: getDefaults returns a fresh copy
  const defaults2 = settings.getDefaults();
  check('getDefaults returns hybrid mode', defaults2.retrievalMode === 'hybrid');
  check('getDefaults returns topK=5', defaults2.topK === 5);
  defaults2.topK = 999;
  check('Modifying returned defaults does not affect cached copy', settings.get().topK !== 999);

  // Test 9: Corrupted settings.json falls back to defaults
  fs.writeFileSync(path.join(dataDir, 'settings.json'), '{invalid json}', 'utf-8');
  const settings4 = new SettingsService(persistence);
  const afterCorrupt = settings4.get();
  check('Corrupted file returns defaults', afterCorrupt.retrievalMode === 'hybrid');

  // Summary
  if (failed > 0) {
    console.error(`\n=== FAILED: ${failed} check(s) failed ===`);
    process.exit(1);
  } else {
    console.log(`\n=== ALL SETTINGS TESTS PASSED ===`);
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
