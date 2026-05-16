#!/bin/bash
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi
pnpm run typecheck:libs
