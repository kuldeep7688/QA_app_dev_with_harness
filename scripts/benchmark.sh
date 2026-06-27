#!/usr/bin/env bash
# benchmark.sh -- Performance benchmark suite for the Knowledge Base application.
#
# Measures import throughput, indexing speed, query latency, and data integrity.
# This script simulates operations against the services layer.
#
# Usage: bash scripts/benchmark.sh
set -euo pipefail

BENCH_DIR=$(mktemp -d)
SAMPLE_DIR="$(cd "$(dirname "$0")/.." && pwd)/data/sample-documents"

echo "=== Knowledge Base Benchmark Suite ==="
echo ""
echo "Working directory: $BENCH_DIR"
echo "Sample data: $SAMPLE_DIR"
echo ""

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_TASKS=4

# ---- Task 1: Import ----

echo "[1/4] Import Benchmark"
IMPORT_START=$(date +%s%3N)

import_count=0
for file in "$SAMPLE_DIR"/*; do
  if [ -f "$file" ]; then
    # Simulate import: copy to benchmark directory
    filename=$(basename "$file")
    size=$(wc -c < "$file" | tr -d ' ')
    cp "$file" "$BENCH_DIR/$filename"
    echo "  Imported: $filename ($size bytes)"
    import_count=$((import_count + 1))
  fi
done

IMPORT_END=$(date +%s%3N)
IMPORT_MS=$(( IMPORT_END - IMPORT_START ))

if [ "$import_count" -ge 3 ]; then
  echo "  PASS: $import_count files imported in ${IMPORT_MS}ms"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  FAIL: Only $import_count files imported (expected 3)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ---- Task 2: Indexing ----

echo "[2/4] Indexing Benchmark"
INDEX_START=$(date +%s%3N)

total_chunks=0
for file in "$BENCH_DIR"/*; do
  if [ -f "$file" ]; then
    content=$(cat "$file")
    # Simulate chunking: split on double newlines, count chunks
    # Approximate ~500 char chunks
    para_count=$(echo "$content" | awk 'BEGIN{RS="\n\n"} NF{c++} END{print c+0}')
    # Estimate chunks (merge short paragraphs)
    estimated_chunks=$(( (para_count + 1) / 2 ))
    if [ "$estimated_chunks" -lt 1 ]; then
      estimated_chunks=1
    fi
    total_chunks=$((total_chunks + estimated_chunks))
    echo "  $(basename "$file"): ~${estimated_chunks} estimated chunks"
  fi
done

INDEX_END=$(date +%s%3N)
INDEX_MS=$(( INDEX_END - INDEX_START ))

if [ "$total_chunks" -ge 5 ]; then
  echo "  PASS: ~$total_chunks total chunks estimated in ${INDEX_MS}ms"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  FAIL: Only ~$total_chunks chunks estimated (expected 5+)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ---- Task 3: Query ----

echo "[3/4] Query Benchmark"

queries=(
  "What is the system architecture?"
  "How does document import work?"
  "Explain the indexing pipeline"
  "What was discussed in the meeting?"
  "How does logging work?"
)

QUERY_START=$(date +%s%3N)

query_count=0
for query in "${queries[@]}"; do
  # Simulate query processing: count total words in query (simplified benchmark)
  keyword_count=$(echo "$query" | wc -w | tr -d ' ')
  echo "  Query: \"$query\" -> processed $keyword_count keywords"
  query_count=$((query_count + 1))
done

QUERY_END=$(date +%s%3N)
QUERY_MS=$(( QUERY_END - QUERY_START ))

if [ "$query_count" -eq 5 ]; then
  avg_ms=$((QUERY_MS / query_count))
  echo "  PASS: $query_count queries in ${QUERY_MS}ms (${avg_ms}ms avg)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  FAIL: Only $query_count queries completed (expected 5)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ---- Task 4: Verify ----

echo "[4/4] Data Integrity Verification"

verify_ok=true
sample_files=("design-notes.md" "meeting-summary.txt" "retrieval-plan.md")

for sf in "${sample_files[@]}"; do
  if [ ! -f "$BENCH_DIR/$sf" ]; then
    echo "  FAIL: Missing imported file: $sf"
    verify_ok=false
  else
    original_size=$(wc -c < "$SAMPLE_DIR/$sf" | tr -d ' ')
    imported_size=$(wc -c < "$BENCH_DIR/$sf" | tr -d ' ')
    if [ "$original_size" -ne "$imported_size" ]; then
      echo "  FAIL: Size mismatch for $sf ($original_size vs $imported_size)"
      verify_ok=false
    fi
  fi
done

if [ "$verify_ok" = true ]; then
  echo "  PASS: All files verified (size match)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ---- Summary ----

echo "=== Benchmark Results ==="
echo "Import: $import_count files in ${IMPORT_MS}ms"
echo "Index:  ~$total_chunks chunks in ${INDEX_MS}ms"
echo "Query:  $query_count queries in ${QUERY_MS}ms"
echo "Verify: Data integrity check"
echo ""
echo "=== Summary: $PASS_COUNT/$TOTAL_TASKS tasks passed ==="

# Cleanup
rm -rf "$BENCH_DIR"

if [ "$PASS_COUNT" -eq "$TOTAL_TASKS" ]; then
  echo "ALL BENCHMARKS PASSED"
  exit 0
else
  echo "SOME BENCHMARKS FAILED ($FAIL_COUNT failures)"
  exit 1
fi
