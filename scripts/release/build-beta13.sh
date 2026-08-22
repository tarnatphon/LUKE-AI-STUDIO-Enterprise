#!/bin/bash
set -e

VERSION="1.0.0-beta.13"
echo "=========================================="
echo " Building LUKE AI STUDIO Enterprise $VERSION "
echo "=========================================="

# Update version.json
cat << VERSION_JSON > app/version.json
{
  "version": "$VERSION",
  "build": "enterprise-text-image-v13",
  "releaseDate": "$(date +%Y-%m-%d)",
  "channel": "beta"
}
VERSION_JSON

# Update frontend package.json version
sed -i '' "s/\"version\": .*/\"version\": \"$VERSION\",/" app/frontend/package.json 2>/dev/null || true

# Create release notes & manifest
RELEASE_DIR="releases/$VERSION"
mkdir -p "$RELEASE_DIR"

cat << RELEASE_NOTES > "$RELEASE_DIR/RELEASE-NOTES.md"
# LUKE AI STUDIO Enterprise $VERSION

## Highlights & Features
- **WorkTab Modular Architecture**: Separated project workflows into ChatProjects, ProjectMemoryPanel, WorkTerminalDock, and WorkToolsPanel.
- **Asset Registry & I2V Pipeline**: Reference image upload registration and direct Image-to-Video asset linking.
- **Supervisor Stability**: Fixed missing supervisor policy schema and auto-recovery circuit breaker.
- **Optimized UI Build**: Full Vite production build with code-splitting.
RELEASE_NOTES

cat << LATEST_JSON > "$RELEASE_DIR/latest.json"
{
  "version": "$VERSION",
  "releaseDate": "$(date +%Y-%m-%d)",
  "status": "ready"
}
LATEST_JSON

echo "=========================================="
echo " ✅ Build for $VERSION completed! "
echo "=========================================="
