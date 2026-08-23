#!/bin/bash
set -e
echo "Downloading Qwen2-VL Vision Model + Projector for M3..."

# Vision Projector (MMPROJ)
curl -L -o "app/llm-models/vision/qwen2-vl-7b-instruct-mmproj-f16.gguf" \
  "https://huggingface.co/Qwen/Qwen2-VL-7B-Instruct-GGUF/resolve/main/qwen2-vl-7b-instruct-mmproj-f16.gguf"

# Model Weights (Q4_K_M for ultra-fast M3 inference)
curl -L -o "app/llm-models/vision/qwen2-vl-7b-instruct-q4_k_m.gguf" \
  "https://huggingface.co/Qwen/Qwen2-VL-7B-Instruct-GGUF/resolve/main/qwen2-vl-7b-instruct-q4_k_m.gguf"

echo "Vision Model and Projector ready in app/llm-models/vision!"
