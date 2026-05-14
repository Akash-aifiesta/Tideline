#!/usr/bin/env bash
# Deploy the React client to GitHub Pages.
# Usage:
#   VITE_API_URL=https://your-api.up.railway.app ./deploy-gh-pages.sh
#
# Prerequisites:
#   pnpm install -g gh-pages   (or: npm install -g gh-pages)
#   git remote named "origin" pointing at your GitHub repo

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Require VITE_API_URL ─────────────────────────────────────────────────────
if [[ -z "${VITE_API_URL:-}" ]]; then
  echo "ERROR: VITE_API_URL is not set."
  echo "Usage: VITE_API_URL=https://your-api.up.railway.app ./deploy-gh-pages.sh"
  exit 1
fi

echo "▶ Building client (API → $VITE_API_URL)…"
VITE_API_URL="$VITE_API_URL" pnpm build

# ── Detect repo name for base path ───────────────────────────────────────────
# GitHub Pages serves at https://<user>.github.io/<repo>/ so Vite needs
# base = "/<repo>/" to resolve assets correctly.
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
REPO_NAME=$(basename -s .git "$REMOTE_URL" 2>/dev/null || echo "")

if [[ -n "$REPO_NAME" && "$REPO_NAME" != "$(git config user.name 2>/dev/null).github.io" ]]; then
  BASE="/$REPO_NAME/"
else
  BASE="/"
fi

echo "▶ Rebuilding with base path: $BASE"
VITE_API_URL="$VITE_API_URL" pnpm exec vite build --base "$BASE"

# ── Deploy via gh-pages ──────────────────────────────────────────────────────
echo "▶ Deploying dist/ → gh-pages branch…"
pnpm exec gh-pages --dist dist --branch gh-pages --message "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "✓ Done. Live at: https://$(git remote get-url origin | sed 's/.*github.com[:/]\([^/]*\)\/\([^.]*\).*/\1.github.io\/\2/')/"
