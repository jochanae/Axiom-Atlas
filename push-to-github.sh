#!/bin/bash
# Run this from your local terminal to push Replit Atlas-v2 code to GitHub
# Usage: GITHUB_TOKEN=your_token bash push-to-github.sh

set -e

REPO="https://${GITHUB_TOKEN}@github.com/jochanae/atlas.git"
BRANCH="Atlas-v2"

echo "==> Cloning current GitHub repo..."
git clone "$REPO" /tmp/atlas-github-push --branch "$BRANCH" --depth 1
cd /tmp/atlas-github-push

echo "==> Copying Replit project files..."
# Copy all Replit workspace files into the clone
rsync -av --exclude='.git' --exclude='node_modules' --exclude='.local' \
  /home/runner/workspace/ /tmp/atlas-github-push/

echo "==> Committing and pushing..."
git add -A
git commit -m "Replit Atlas-v2 sync - workspace header, parking lot, mobile layout"
git push origin HEAD:"$BRANCH" --force

echo "==> Done! https://github.com/jochanae/atlas/tree/$BRANCH"

# Cleanup
cd /
rm -rf /tmp/atlas-github-push
