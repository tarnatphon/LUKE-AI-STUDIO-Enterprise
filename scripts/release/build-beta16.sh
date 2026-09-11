#!/bin/bash
set -e

VERSION="1.0.0-beta.16"
echo "=========================================="
echo " Building LUKE AI STUDIO Enterprise $VERSION "
echo "=========================================="

# Update version.json
cat << VERSION_JSON > app/version.json
{
  "version": "$VERSION",
  "build": "enterprise-social-agency-v16",
  "releaseDate": "$(date +%Y-%m-%d)",
  "channel": "beta"
}
VERSION_JSON

# Update frontend package.json version
sed -i '' "s/\"version\": .*/\"version\": \"$VERSION\",/" app/frontend/package.json 2>/dev/null || true

# Build Vite frontend
echo "Building Vite UI..."
cd app/frontend && npm run build && cd ../..
mkdir -p app/dist
cp -r app/frontend/dist/* app/dist/ 2>/dev/null || true

# Create Release Manifest
mkdir -p "releases/$VERSION"
cat << RELEASE_NOTES > "releases/$VERSION/RELEASE-NOTES.md"
# LUKE AI STUDIO Enterprise $VERSION

## New Enterprise Capabilities
1. **Social Agency Overview Dashboard**: month stats by status/platform, 7-day queue, review queue, recent runs + calendar filters.
2. **Per-Platform Versions & Few-Shot Styles**: FB/IG/LINE/Demo caption variants with platform rules + brand style examples for LLM prompts.
3. **Server Wiring & Health**: `/health` endpoint, scheduler start/stop controls, `LUKE_SOCIAL_AGENCY_SCHEDULER=off` boot flag, graceful shutdown.
4. **Backup & Weekly LINE Summaries**: client/all export, server snapshots with safety copies, restore + opt-in Monday 09:00 LINE broadcast summaries.
RELEASE_NOTES

cat << LATEST_JSON > "releases/$VERSION/latest.json"
{
  "version": "$VERSION",
  "releaseDate": "$(date +%Y-%m-%d)",
  "status": "ready"
}
LATEST_JSON

echo "=========================================="
echo " ✅ Build for $VERSION completed! "
echo "=========================================="
