#!/bin/bash
set -e

# Install dependencies (fast when lockfile is unchanged)
npm install

# Sync database schema (non-interactive)
if [ -f drizzle.config.ts ]; then
  npm run db:push --if-present -- --force
fi
