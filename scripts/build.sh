#!/usr/bin/env bash
#
# build.sh - Build script that copies SQL migrations
#

set -euo pipefail

echo "Building main process..."
tsc -p tsconfig.node.json

echo "Copying SQL migrations..."
mkdir -p dist/services/migrations
cp src/services/migrations/*.sql dist/services/migrations/

echo "Building renderer..."
vite build

echo "Build complete!"
