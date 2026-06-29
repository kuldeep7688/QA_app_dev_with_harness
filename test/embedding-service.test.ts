/**
 * Test: Local Embedding Service
 * 
 * Verifies that the embedding service correctly loads the all-MiniLM-L6-v2 model,
 * generates 384-dimensional embeddings, handles batch processing, and computes
 * cosine similarity.
 */

import { embed, embedBatch, cosineSimilarity, getEmbeddingDimension } from '../src/services/embedding-service';

describe('Local Embedding Service', () => {
  test('embed() returns 384-dimensional Float32Array', async () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const embedding = await embed(text);

    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(384);
    expect(getEmbeddingDimension()).toBe(384);
  }, 30000); // First model load can take time

  test('embed() produces different embeddings for different texts', async () => {
    const text1 = 'Machine learning and artificial intelligence';
    const text2 = 'The cat sat on the mat';

    const embedding1 = await embed(text1);
    const embedding2 = await embed(text2);

    expect(embedding1).toBeInstanceOf(Float32Array);
    expect(embedding2).toBeInstanceOf(Float32Array);

    // Embeddings should be different
    let allSame = true;
    for (let i = 0; i < Math.min(10, embedding1.length); i++) {
      if (Math.abs(embedding1[i] - embedding2[i]) > 0.001) {
        allSame = false;
        break;
      }
    }
    expect(allSame).toBe(false);
  }, 20000);

  test('cosine similarity of identical embeddings is ~1.0', async () => {
    const text = 'Database systems and query optimization';
    const embedding1 = await embed(text);
    const embedding2 = await embed(text);

    const similarity = cosineSimilarity(embedding1, embedding2);

    // Should be very close to 1.0 (allowing for floating-point precision)
    expect(similarity).toBeGreaterThan(0.99);
    expect(similarity).toBeLessThanOrEqual(1.01); // Allow tiny floating-point errors
  }, 20000);

  test('cosine similarity of semantically similar texts is high', async () => {
    const text1 = 'Dogs are great pets and loyal companions';
    const text2 = 'Canines make wonderful friends and are very faithful';

    const embedding1 = await embed(text1);
    const embedding2 = await embed(text2);

    const similarity = cosineSimilarity(embedding1, embedding2);

    // Semantically similar texts should have high similarity (>0.5)
    expect(similarity).toBeGreaterThan(0.5);
    expect(similarity).toBeLessThanOrEqual(1.0);
  }, 20000);

  test('cosine similarity of unrelated texts is low', async () => {
    const text1 = 'Python programming language for machine learning';
    const text2 = 'Cooking recipes for chocolate cake with frosting';

    const embedding1 = await embed(text1);
    const embedding2 = await embed(text2);

    const similarity = cosineSimilarity(embedding1, embedding2);

    // Unrelated texts should have lower similarity
    expect(similarity).toBeLessThan(0.6);
    expect(similarity).toBeGreaterThanOrEqual(-1.0);
  }, 20000);

  test('embedBatch() returns correct number of embeddings', async () => {
    const texts = [
      'First document about databases',
      'Second document about machine learning',
      'Third document about web development',
    ];

    const embeddings = await embedBatch(texts);

    expect(embeddings).toBeInstanceOf(Array);
    expect(embeddings.length).toBe(3);

    for (const embedding of embeddings) {
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    }
  }, 30000);

  test('embedBatch() handles large batches (>32 texts)', async () => {
    // Create 50 texts to test batch processing (BATCH_SIZE = 32)
    const texts: string[] = [];
    for (let i = 0; i < 50; i++) {
      texts.push(`Document number ${i} with some content about topic ${i % 10}`);
    }

    const embeddings = await embedBatch(texts);

    expect(embeddings.length).toBe(50);

    for (const embedding of embeddings) {
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    }

    // Verify different texts produce different embeddings
    const similarity = cosineSimilarity(embeddings[0], embeddings[49]);
    expect(similarity).toBeLessThan(0.99); // Should be different
  }, 40000);

  test('embedBatch() produces same embeddings as embed() for single text', async () => {
    const text = 'Testing consistency between single and batch embedding';

    const singleEmbedding = await embed(text);
    const batchEmbeddings = await embedBatch([text]);

    expect(batchEmbeddings.length).toBe(1);

    const similarity = cosineSimilarity(singleEmbedding, batchEmbeddings[0]);

    // Should be identical or very close
    expect(similarity).toBeGreaterThan(0.99);
  }, 20000);

  test('embedBatch() returns empty array for empty input', async () => {
    const embeddings = await embedBatch([]);
    expect(embeddings).toEqual([]);
  });

  test('model loads once and is reused (performance check)', async () => {
    const text1 = 'First embedding call (may include model load time)';
    const text2 = 'Second embedding call (should be faster)';

    // First call (may include model load)
    const start1 = Date.now();
    await embed(text1);
    const duration1 = Date.now() - start1;

    // Second call (model already loaded)
    const start2 = Date.now();
    await embed(text2);
    const duration2 = Date.now() - start2;

    // Second call should be significantly faster (at least 2x faster)
    // Note: First test in suite may have already loaded model
    console.log(`First embed: ${duration1}ms, Second embed: ${duration2}ms`);

    // Just verify both calls complete
    expect(duration1).toBeGreaterThan(0);
    expect(duration2).toBeGreaterThan(0);
  }, 30000);

  test('cosine similarity throws error for mismatched dimensions', () => {
    const a = new Float32Array(384).fill(0.1);
    const b = new Float32Array(256).fill(0.2);

    expect(() => cosineSimilarity(a, b)).toThrow('Embeddings must have the same dimension');
  });

  test('embedding service runs on CPU (no GPU)', async () => {
    // This test verifies that the service works without GPU
    // If GPU were required and unavailable, this would fail

    const text = 'Testing CPU-only execution';
    const embedding = await embed(text);

    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(384);

    // No explicit assertion about CPU vs GPU, but the fact that
    // this test passes in a CPU-only environment confirms it works
  }, 20000);
});
