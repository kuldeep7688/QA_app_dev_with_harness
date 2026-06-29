import type { RetrievalSettings } from '../shared/types';
import { PersistenceService } from './persistence-service';
import { logger } from './logger';

const log = logger.forService('SettingsService');

const VALID_MODES = ['hybrid', 'bm25', 'vector'] as const;

const DEFAULTS: RetrievalSettings = {
  retrievalMode: 'hybrid',
  topK: 5,
  topN: 20,
  rrfK: 60,
  embeddingsEnabled: true,
};

export class SettingsService {
  private persistence: PersistenceService;
  private cache: RetrievalSettings | null = null;

  constructor(persistence: PersistenceService) {
    this.persistence = persistence;
    log.info('Settings service initialized');
  }

  getDefaults(): RetrievalSettings {
    return { ...DEFAULTS };
  }

  get(): RetrievalSettings {
    if (this.cache) {
      return { ...this.cache };
    }

    const saved = this.persistence.readJson<RetrievalSettings>('settings.json');
    if (saved) {
      const validated = this.applyDefaults(saved);
      this.cache = validated;
      log.debug('Settings loaded from disk', { retrievalMode: validated.retrievalMode });
      return { ...validated };
    }

    log.info('No settings file found, using defaults');
    this.cache = { ...DEFAULTS };
    this.persistence.writeJson('settings.json', DEFAULTS);
    return { ...DEFAULTS };
  }

  set(partial: Partial<RetrievalSettings>): RetrievalSettings {
    const current = this.get();
    const merged: RetrievalSettings = {
      ...current,
      ...partial,
    };

    if (partial.retrievalMode !== undefined && !VALID_MODES.includes(partial.retrievalMode as typeof VALID_MODES[number])) {
      log.warn('Invalid retrievalMode rejected', { invalidValue: partial.retrievalMode });
      merged.retrievalMode = current.retrievalMode;
    }

    if (partial.topK !== undefined) {
      if (!Number.isInteger(partial.topK) || partial.topK < 1) {
        log.warn('Invalid topK rejected', { invalidValue: partial.topK });
        merged.topK = current.topK;
      }
    }

    if (partial.topN !== undefined) {
      if (!Number.isInteger(partial.topN) || partial.topN < 1) {
        log.warn('Invalid topN rejected', { invalidValue: partial.topN });
        merged.topN = current.topN;
      }
    }

    if (partial.rrfK !== undefined) {
      if (!Number.isInteger(partial.rrfK) || partial.rrfK < 1) {
        log.warn('Invalid rrfK rejected', { invalidValue: partial.rrfK });
        merged.rrfK = current.rrfK;
      }
    }

    if (partial.embeddingsEnabled !== undefined && typeof partial.embeddingsEnabled !== 'boolean') {
      log.warn('Invalid embeddingsEnabled rejected', { invalidValue: partial.embeddingsEnabled });
      merged.embeddingsEnabled = current.embeddingsEnabled;
    }

    this.cache = { ...merged };
    this.persistence.writeJson('settings.json', merged);

    log.info('Settings updated', {
      retrievalMode: merged.retrievalMode,
      topK: merged.topK,
      topN: merged.topN,
      rrfK: merged.rrfK,
      embeddingsEnabled: merged.embeddingsEnabled,
    });

    return { ...merged };
  }

  private applyDefaults(saved: Partial<RetrievalSettings>): RetrievalSettings {
    const validMode = saved.retrievalMode !== undefined && VALID_MODES.includes(saved.retrievalMode as typeof VALID_MODES[number])
      ? saved.retrievalMode
      : DEFAULTS.retrievalMode;
    const topK = typeof saved.topK === 'number' && Number.isInteger(saved.topK) && saved.topK >= 1
      ? saved.topK : DEFAULTS.topK;
    const topN = typeof saved.topN === 'number' && Number.isInteger(saved.topN) && saved.topN >= 1
      ? saved.topN : DEFAULTS.topN;
    const rrfK = typeof saved.rrfK === 'number' && Number.isInteger(saved.rrfK) && saved.rrfK >= 1
      ? saved.rrfK : DEFAULTS.rrfK;
    const embeddingsEnabled = typeof saved.embeddingsEnabled === 'boolean'
      ? saved.embeddingsEnabled : DEFAULTS.embeddingsEnabled;

    return {
      retrievalMode: validMode as RetrievalSettings['retrievalMode'],
      topK,
      topN,
      rrfK,
      embeddingsEnabled,
    };
  }
}
