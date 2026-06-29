/**
 * Hybrid Retriever (BM25 + Vector via RRF)
 *
 * Pure functions over db + embeddingService for fused retrieval.
 * Supports hybrid, bm25-only, and vector-only modes.
 *
 * Reciprocal Rank Fusion (RRF) merges ranked lists:
 *   fusedScore = Σ 1/(rrfK + rank)
 */

import type Database from "better-sqlite3";
import { logger } from "./logger.js";
import { isVectorExtensionLoaded } from "./db.js";

const log = logger.forService("retriever");

export interface ChunkDetail {
  rowid: number;
  id: string;
  documentId: string;
  idx: number;
  content: string;
  charCount: number;
  wordCount: number;
  embeddedAt: string | null;
}

export interface HybridSearchOptions {
  mode?: "hybrid" | "bm25" | "vector";
  topN?: number;
  topK?: number;
  rrfK?: number;
}

export interface HybridSearchResult {
  chunk: ChunkDetail;
  fusedScore: number;
  bm25Rank?: number;
  bm25Score?: number;
  vectorRank?: number;
  vectorDistance?: number;
  sources: Array<"bm25" | "vector">;
}

interface RankedItem {
  rowid: number;
  rank: number;
  score: number;
  source: "bm25" | "vector";
}

const DEFAULTS: Required<HybridSearchOptions> = {
  mode: "hybrid",
  topN: 20,
  topK: 5,
  rrfK: 60,
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'for',
  'of', 'by', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'can', 'not', 'no', 'nor',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'we', 'our', 'you', 'your', 'he', 'she', 'him', 'her', 'his',
]);

function bm25Search(
  db: Database.Database,
  query: string,
  limit: number,
): Array<{ rowid: number; score: number }> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  // Sanitize query for FTS5: remove characters that cause syntax errors
  // and strip common stopwords/question words to avoid full-word AND failures
  const sanitized = query
    .replace(/[?'"()*]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w.toLowerCase()))
    .join(' ');

  if (sanitized.length === 0) {
    return [];
  }

  const stmt = db.prepare(`
    SELECT 
      rowid,
      -bm25(chunks_fts) as score
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  return stmt.all(sanitized, limit) as Array<{ rowid: number; score: number }>;
}

function vectorSearch(
  db: Database.Database,
  embedding: Float32Array,
  limit: number,
): Array<{ rowid: number; distance: number }> {
  if (!isVectorExtensionLoaded()) {
    return [];
  }

  const stmt = db.prepare(`
    SELECT 
      rowid,
      distance
    FROM chunks_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `);

  return stmt.all(embedding, limit) as Array<{ rowid: number; distance: number }>;
}

function getChunksByRowids(
  db: Database.Database,
  rowids: number[],
): ChunkDetail[] {
  if (rowids.length === 0) return [];

  const placeholders = rowids.map(() => "?").join(",");
  const stmt = db.prepare(`
    SELECT 
      rowid,
      id,
      document_id as documentId,
      idx,
      content,
      char_count as charCount,
      word_count as wordCount,
      embedded_at as embeddedAt
    FROM chunks
    WHERE rowid IN (${placeholders})
  `);

  const chunks = stmt.all(...rowids) as ChunkDetail[];
  const chunkMap = new Map(chunks.map((c) => [c.rowid, c]));
  return rowids
    .map((rowid) => chunkMap.get(rowid))
    .filter((c): c is ChunkDetail => c !== undefined);
}

function computeRRF(
  items: RankedItem[],
  rrfK: number,
): Map<number, number> {
  const fused = new Map<number, number>();
  for (const item of items) {
    const current = fused.get(item.rowid) ?? 0;
    fused.set(item.rowid, current + 1 / (rrfK + item.rank));
  }
  return fused;
}

function vecRowidToChunkRowid(
  db: Database.Database,
  vecRowids: number[],
): Map<number, number> {
  if (vecRowids.length === 0) return new Map();

  const placeholders = vecRowids.map(() => "?").join(",");
  const stmt = db.prepare(`
    SELECT rowid, vec_rowid FROM chunks
    WHERE vec_rowid IN (${placeholders})
  `);
  const rows = stmt.all(...vecRowids) as Array<{ rowid: number; vec_rowid: number }>;
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.vec_rowid, row.rowid);
  }
  return map;
}

function rankedItemToDebug<T extends "score" | "distance">(
  items: RankedItem[],
  source: "bm25" | "vector",
  valueKey: T,
): Array<{ rowid: number; rank: number } & Record<T, number>> {
  return items
    .filter((i) => i.source === source)
    .map((i) => ({ rowid: i.rowid, [valueKey]: i.score, rank: i.rank }) as any);
}

export interface DebugSearchResult {
  bm25Results: Array<{ rowid: number; score: number; rank: number }>;
  vectorResults: Array<{ rowid: number; distance: number; rank: number }>;
  fusedResults: HybridSearchResult[];
}

async function internalHybridSearch(
  db: Database.Database,
  query: string,
  embedFn: (text: string) => Promise<Float32Array>,
  opts?: HybridSearchOptions,
): Promise<{
  results: HybridSearchResult[];
  rankedItems: RankedItem[];
}> {
  const options = { ...DEFAULTS, ...opts };
  const { mode, topN, topK, rrfK } = options;

  if (!query || query.trim().length === 0) {
    return { results: [], rankedItems: [] };
  }

  const rankedItems: RankedItem[] = [];
  let bm25Results: Array<{ rowid: number; score: number }> = [];
  let vecResults: Array<{ rowid: number; distance: number }> = [];

  if (mode === "hybrid" || mode === "bm25") {
    bm25Results = bm25Search(db, query, topN);
    for (let i = 0; i < bm25Results.length; i++) {
      rankedItems.push({
        rowid: bm25Results[i].rowid,
        rank: i + 1,
        score: bm25Results[i].score,
        source: "bm25",
      });
    }
  }

  if (isVectorExtensionLoaded() && (mode === "hybrid" || mode === "vector")) {
    try {
      const embedding = await embedFn(query);
      if (embedding && embedding.length > 0) {
        const rawVecResults = vectorSearch(db, embedding, topN);
        const mapping = vecRowidToChunkRowid(db, rawVecResults.map((r) => r.rowid));
        for (let i = 0; i < rawVecResults.length; i++) {
          const vr = rawVecResults[i];
          const chunkRowid = mapping.get(vr.rowid);
          if (chunkRowid !== undefined) {
            vecResults.push({ rowid: chunkRowid, distance: vr.distance });
          }
        }
        for (let i = 0; i < vecResults.length; i++) {
          rankedItems.push({
            rowid: vecResults[i].rowid,
            rank: i + 1,
            score: vecResults[i].distance,
            source: "vector",
          });
        }
      }
    } catch {}
  }

  if (rankedItems.length === 0) {
    return { results: [], rankedItems };
  }

  const fusedScores = computeRRF(rankedItems, rrfK);
  const mergedRowids = Array.from(fusedScores.entries())
    .sort((a, b) => {
      const scoreDiff = b[1] - a[1];
      if (scoreDiff !== 0) return scoreDiff;
      return a[0] - b[0];
    })
    .slice(0, topK)
    .map(([rowid]) => rowid);

  const chunks = getChunksByRowids(db, mergedRowids);
  const chunkMap = new Map(chunks.map((c) => [c.rowid, c]));

  const bm25Ranks = new Map(bm25Results.map((r, i) => [r.rowid, i + 1] as const));
  const bm25Scores = new Map(bm25Results.map((r) => [r.rowid, r.score] as const));
  const vecRanks = new Map(vecResults.map((r, i) => [r.rowid, i + 1] as const));
  const vecDistances = new Map(vecResults.map((r) => [r.rowid, r.distance] as const));

  const results: HybridSearchResult[] = [];
  for (const rowid of mergedRowids) {
    const chunk = chunkMap.get(rowid);
    if (!chunk) continue;
    const sources: Array<"bm25" | "vector"> = [];
    if (bm25Ranks.has(rowid)) sources.push("bm25");
    if (vecRanks.has(rowid)) sources.push("vector");
    results.push({
      chunk,
      fusedScore: fusedScores.get(rowid) ?? 0,
      bm25Rank: bm25Ranks.get(rowid),
      bm25Score: bm25Scores.get(rowid),
      vectorRank: vecRanks.get(rowid),
      vectorDistance: vecDistances.get(rowid),
      sources,
    });
  }

  return { results, rankedItems };
}

export async function debugSearch(
  db: Database.Database,
  query: string,
  embedFn: (text: string) => Promise<Float32Array>,
  opts?: HybridSearchOptions,
): Promise<DebugSearchResult> {
  const { results, rankedItems } = await internalHybridSearch(db, query, embedFn, opts);
  return {
    bm25Results: rankedItemToDebug(rankedItems, "bm25", "score"),
    vectorResults: rankedItemToDebug(rankedItems, "vector", "distance"),
    fusedResults: results,
  };
}

export async function hybridSearch(
  db: Database.Database,
  query: string,
  embedFn: (text: string) => Promise<Float32Array>,
  opts?: HybridSearchOptions,
): Promise<HybridSearchResult[]> {
  const startTime = Date.now();
  const options = { ...DEFAULTS, ...opts };
  const { mode, topN, topK, rrfK } = options;

  log.info("Hybrid search started", {
    query: query.substring(0, 100),
    mode,
    topN,
    topK,
    rrfK,
  });

  const { results } = await internalHybridSearch(db, query, embedFn, opts);

  if (results.length === 0) {
    log.info("No results from any retriever");
  }

  const elapsed = Date.now() - startTime;
  log.info("Hybrid search completed", {
    resultCount: results.length,
    mode,
    elapsedMs: elapsed,
  });

  return results;
}
