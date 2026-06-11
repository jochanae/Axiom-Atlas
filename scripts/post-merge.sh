#!/bin/bash
set -e

# Install any new dependencies added by the merged task.
# DB schema changes are applied automatically at server startup via the
# migrate() call in artifacts/api-server/src/index.ts — no CLI migration step
# is needed here.
pnpm install --frozen-lockfile
