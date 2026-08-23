#!/bin/bash
set -e
echo "Setting up Whisper Turbo model for Mac M3..."

# Download Whisper Large-v3-Turbo model (Optimized for Apple Silicon)
curl -L -o "app/speech-models/ggml-large-v3-turbo.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

echo "Whisper model installed at app/speech-models/ggml-large-v3-turbo.bin!"
