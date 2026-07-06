import type Database from "better-sqlite3";
import { logger } from "./logger.js";

const serviceLogger = logger.forService("RetrieverService");

export interface BM25Result {
  rowid: number;
  score: number;
}

/**
 * RetrieverService handles full-text search and retrieval operations.
 * 
 * Uses SQLite FTS5 with BM25 ranking for keyword-based search.
 * Future: Will support hybrid retrieval (BM25 + vector embeddings).
 */
export class RetrieverService {
  constructor(private readonly db: Database.Database) {
    serviceLogger.info("RetrieverService initialized");
  }

  /**
   * Performs BM25 full-text search on chunks using FTS5.
   * 
   * @param query - Search query string
   * @param limit - Maximum number of results to return (default: 10)
   * @returns Array of {rowid, score} sorted by relevance (highest score first)
   * 
   * Score is negative (BM25 convention), lower (more negative) = more relevant.
   * We negate it so higher score = more relevant for consistency.
   */
  bm25Search(query: string, limit: number = 10): BM25Result[] {
    const start = Date.now();

    if (!query || query.trim().length === 0) {
      serviceLogger.debug("Empty query, returning no results");
      return [];
    }

    try {
      // FTS5 BM25 search: ORDER BY rank means ORDER BY bm25(chunks_fts)
      // rank is negative, so we negate it to get positive scores
      const stmt = this.db.prepare(`
        SELECT 
          rowid,
          -bm25(chunks_fts) as score
        FROM chunks_fts
        WHERE chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      const results = stmt.all(query, limit) as BM25Result[];

      const elapsed = Date.now() - start;
      serviceLogger.info("BM25 search completed", {
        query,
        resultsCount: results.length,
        limit,
        elapsedMs: elapsed
      });

      serviceLogger.debug("BM25 search results", {
        query,
        results: results.slice(0, 3) // Log top 3 for debugging
      });

      return results;
    } catch (error) {
      serviceLogger.error("BM25 search failed", {
        query,
        limit,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Gets the full chunk details for a list of rowids.
   * Preserves the order of the input rowids.
   * 
   * @param rowids - Array of chunk rowids to fetch
   * @returns Array of chunk objects with all columns
   */
  getChunksByRowids(rowids: number[]): Array<{
    rowid: number;
    id: string;
    documentId: string;
    idx: number;
    content: string;
    charCount: number;
    wordCount: number;
    embeddedAt: string | null;
  }> {
    if (rowids.length === 0) {
      return [];
    }

    const placeholders = rowids.map(() => "?").join(",");
    const stmt = this.db.prepare(`
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

    const chunks = stmt.all(...rowids) as Array<{
      rowid: number;
      id: string;
      documentId: string;
      idx: number;
      content: string;
      charCount: number;
      wordCount: number;
      embeddedAt: string | null;
    }>;

    // Preserve order from rowids array
    const chunkMap = new Map(chunks.map(c => [c.rowid, c]));
    const orderedChunks = rowids
      .map(rowid => chunkMap.get(rowid))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    serviceLogger.debug("Fetched chunks by rowids", {
      requestedCount: rowids.length,
      foundCount: orderedChunks.length
    });

    return orderedChunks;
  }
}
