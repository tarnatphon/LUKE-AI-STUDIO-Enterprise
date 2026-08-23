#!/bin/bash
set -e

VERSION="1.0.0-beta.15"
echo "=========================================="
echo " Building LUKE AI STUDIO Enterprise $VERSION "
echo "=========================================="

# Update version.json
cat << VERSION_JSON > app/version.json
{
  "version": "$VERSION",
  "build": "enterprise-rag-agent-scraper-v15",
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
1. **Local RAG & Semantic Code Search**: High-speed chunking & cosine similarity vector search across project files.
2. **Autonomous Coding Agent Loop**: Background tool loops, automated test execution, and auto-healing code edits.
3. **Web & Doc Ingestion Scraper**: Clean HTML-to-Markdown document parsing for live URL and API documentation ingestion.
4. **Whisper Turbo STT & Kokoro TTS**: Native Apple Silicon speech pipeline.
5. **Multi-Modal Vision**: Qwen2-VL / MiniCPM-V projector loading.
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
