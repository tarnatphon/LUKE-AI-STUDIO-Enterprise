#!/bin/bash
set -e

VERSION="1.0.0-beta.13"
echo "=========================================="
echo " Building LUKE AI STUDIO Enterprise $VERSION "
echo "=========================================="

# 1. Update version.json
cat << VERSION_JSON > app/version.json
{
  "version": "$VERSION",
  "build": "enterprise-text-image-v13",
  "releaseDate": "$(date +%Y-%m-%d)",
  "channel": "beta"
}
VERSION_JSON

# 2. Update frontend package.json version
sed -i '' "s/\"version\": .*/\"version\": \"$VERSION\",/" app/frontend/package.json 2>/dev/null || true

# 3. Build frontend assets
echo "Building frontend..."
cd app/frontend && npm run build && cd ../..
mkdir -p app/dist
cp -r app/frontend/dist/* app/dist/ 2>/dev/null || true

# 4. Create release folder structure
RELEASE_DIR="releases/$VERSION"
mkdir -p "$RELEASE_DIR"

cat << RELEASE_NOTES > "$RELEASE_DIR/RELEASE-NOTES.md"
# LUKE AI STUDIO Enterprise $VERSION

## Highlights & Changes
- **WorkTab Modularization**: Replaced monolithic WorkTab with ChatProjects, ProjectMemoryPanel, WorkTerminalDock, and WorkToolsPanel.
- **Asset Registry & I2V**: Reference image upload registration & Image-to-Video asset tracking pipeline.
- **Runtime Supervisor**: Hardened policy crash protection and automatic recovery.
- **Storage Engine**: S3-compatible cloud storage adapter and keychain disaster recovery readiness.
RELEASE_NOTES

cat << LATEST_JSON > "$RELEASE_DIR/latest.json"
{
  "version": "$VERSION",
  "releaseDate": "$(date +%Y-%m-%d)",
  "status": "ready"
}
LATEST_JSON

echo "=========================================="
echo " Build for $VERSION completed successfully! "
echo "=========================================="
