/**
 * Embedding Service using @xenova/transformers
 * 
 * Provides local text embedding via the all-MiniLM-L6-v2 model (384-dim).
 * Model is lazy-loaded on first embed() call and cached for subsequent use.
 * 
 * CPU-only configuration - no GPU acceleration.
 */

import { pipeline, env } from '@xenova/transformers';
import { logger } from './logger';

const log = logger.forService('embedding-service');

// Force CPU execution (no GPU)
env.backends.onnx.wasm.numThreads = 1;

// Disable remote model loading in production (use bundled models only)
// Set to false to allow first-run download if model not bundled
env.allowRemoteModels = true;

// Model configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;
const BATCH_SIZE = 32;

// Singleton pipeline instance (using any to avoid complex transformer types)
let pipelineInstance: any = null;
let isInitializing = false;

/**
 * Initialize the embedding pipeline (lazy load).
 * Subsequent calls return the cached instance.
 */
async function initPipeline(): Promise<any> {
  if (pipelineInstance) {
    return pipelineInstance;
  }

  if (isInitializing) {
    // Wait for initialization to complete
    while (!pipelineInstance) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return pipelineInstance;
  }

  isInitializing = true;

  try {
    log.info('Loading embedding model', { 
      model: MODEL_NAME, 
      dimension: EMBEDDING_DIM,
      device: 'cpu'
    });

    const startTime = Date.now();

    // Create feature extraction pipeline
    // Using 'any' type to work around transformers.js type complexity
    pipelineInstance = await pipeline('feature-extraction', MODEL_NAME);

    const loadTime = Date.now() - startTime;

    log.info('Embedding model loaded successfully', { 
      model: MODEL_NAME,
      loadTimeMs: loadTime,
      device: 'cpu'
    });

    isInitializing = false;
    return pipelineInstance;
  } catch (error) {
    isInitializing = false;
    log.error('Failed to load embedding model', {
      model: MODEL_NAME,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Embed a single text string into a 384-dimensional vector.
 * Model is loaded lazily on first call.
 * 
 * @param text - Input text to embed
 * @returns Float32Array of length 384
 */
export async function embed(text: string): Promise<Float32Array> {
  const startTime = Date.now();

  try {
    const pipe = await initPipeline();

    // Generate embedding
    const output = await pipe(text, { pooling: 'mean', normalize: true });

    // Extract the embedding data as Float32Array
    const embedding = new Float32Array(output.data);

    const duration = Date.now() - startTime;

    log.debug('Text embedded', { 
      textLength: text.length, 
      embeddingDim: embedding.length,
      durationMs: duration,
    });

    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(`Expected ${EMBEDDING_DIM}-dim embedding, got ${embedding.length}`);
    }

    return embedding;
  } catch (error) {
    log.error('Embedding failed', {
      textLength: text.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Embed multiple texts in a batch for better throughput.
 * Processes in chunks of BATCH_SIZE (32).
 * 
 * @param texts - Array of input texts
 * @returns Array of Float32Arrays, one per input text
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) {
    return [];
  }

  const startTime = Date.now();

  try {
    const pipe = await initPipeline();

    const allEmbeddings: Float32Array[] = [];

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, Math.min(i + BATCH_SIZE, texts.length));

      log.debug('Processing embedding batch', { 
        batchStart: i, 
        batchSize: batch.length,
        totalTexts: texts.length,
      });

      // Generate embeddings for the batch
      const outputs = await pipe(batch, { pooling: 'mean', normalize: true });

      // Extract embeddings
      // For batch input, outputs will be an array of results
      if (Array.isArray(outputs)) {
        for (const output of outputs) {
          const embedding = new Float32Array(output.data);
          if (embedding.length !== EMBEDDING_DIM) {
            throw new Error(`Expected ${EMBEDDING_DIM}-dim embedding, got ${embedding.length}`);
          }
          allEmbeddings.push(embedding);
        }
      } else {
        // Single result - extract and split by dimension
        const data = outputs.data as number[];
        for (let j = 0; j < batch.length; j++) {
          const embedding = new Float32Array(
            data.slice(j * EMBEDDING_DIM, (j + 1) * EMBEDDING_DIM)
          );
          allEmbeddings.push(embedding);
        }
      }
    }

    const duration = Date.now() - startTime;
    const throughput = (texts.length / duration) * 1000;

    log.info('Batch embedding completed', {
      count: texts.length,
      durationMs: duration,
      throughput: `${throughput.toFixed(1)} texts/sec`,
    });

    return allEmbeddings;
  } catch (error) {
    log.error('Batch embedding failed', {
      textCount: texts.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Calculate cosine similarity between two embeddings.
 * Returns a value between -1 and 1, where 1 means identical vectors.
 * 
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Cosine similarity score
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get embedding dimension (384 for all-MiniLM-L6-v2).
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}
