# LUKE AI STUDIO — AI Library update

## Added
- Product-facing brand renamed to **LUKE AI STUDIO**.
- Model Manager renamed to **AI Library**.
- Text library sections: Text AI, Vision AI, Open Models, Cloud AI, Installed.
- Official Kimi K3 listing links to Moonshot AI's Hugging Face repository.
- Claude is correctly represented as a Cloud AI connection, not a local download.
- Existing Hugging Face GGUF search, download progress, import, load, unload, and delete workflows remain available.

## Safety and accuracy
- No fake one-click download is shown for multi-file Kimi K3 weights.
- No download action is shown for Claude, whose models are accessed through Anthropic services.
- Technical model details remain available while beginner-facing labels are simplified.

## Validation performed
- macOS launcher shell syntax.
- Node server syntax.
- Python worker compilation.
- JSX delimiter and required UI marker checks.
- ZIP CRC/integrity test.

## Build limitation
The production frontend bundle was not rebuilt in the Linux validation environment because the project pins a Vite/native dependency set intended for macOS. The updated React source is included and the macOS first-run build path remains in place.

## Phase 2 — Video AI Manager
- Added a dedicated Video AI tab inside AI Library.
- Added one-click Image-to-Video Install, Repair, Verify, and status polling.
- Added hardware compatibility cards for SVD, SVD-XT, Wan I2V, and CogVideoX.
- Added storage guidance for external SSD and USB model libraries.
- Keeps technical dependency errors in logs while presenting user-friendly actions.

## Phase 3 — Text Model Arena & concurrent models
- Chat can now run 2-3 text models at the same time and pick the best answer.
- Each arena model runs in its own llama.cpp process (scripts/server/text-model-pool.cjs).
- Answers are scored on relevance, completeness, clarity, detail and uniqueness
  (scripts/server/text-arena-evaluator.cjs), then cross-reviewed by a judge pass
  before the winning answer is written into the conversation.
- Users can keep any other answer, and thumbs up/down feeds future ranking.
- Concurrency restored: image, chat, speech, TTS and arena models can stay loaded
  together. Loading one model no longer unloads another; memory pressure is
  reported as a warning instead of a block.
- Status bar shows how many models are loaded at the same time.
- Automatic memory budget (app/config/text-chat/model-memory-budget.json):
  concurrent loads are still allowed, but a model that cannot fit in RAM or
  VRAM is refused with a clear message instead of crashing the runtime.
  Warnings appear in the log above warnRatio; loading stops above blockRatio.

## Phase 4 — the model cache covers image models
- `scripts/server/model-cache.cjs` now caches a **folder** as well as a single
  file. An installed Core ML image model is a bundle of tens of thousands of
  small `.mlmodelc`/`.mlpackage` resources, which is the slowest thing an
  external disk can be asked to read; the cache fingerprints a tree (file count,
  total bytes, newest mtime), copies it through a temporary name, and verifies
  the copy against the model before it is ever listed as cached.
- **A cached copy is now actually used.** The loaders were looking in one cache
  folder while `Settings > Performance` writes the copy to the other, so the
  copy existed and the model still loaded off the slow disk every time. Both
  folders are searched now, internal disk first, for text models and image models
  alike, and a copy is only trusted when it matches the model byte for byte.
- `/api/model-cache/status` answers the `POST` the panel sends (it was `GET`
  only, so the panel read a 404 and showed nothing) and honours the disk choice
  in the request. It lists image models too, labelled `Image model`, so an image
  model can be copied from the UI at all.
- `/api/model-cache/prime` accepts image models, still resolves nothing from the
  request path itself (the model is looked up inside the model folders), and a
  "copying this gains you nothing" refusal now answers 400 with its reason
  instead of a 500.
- `scripts/workers/coreml_server.py` reads the reference config (tokenizer,
  scheduler) from a local copy under `app/runtime-state/huggingface-cache`
  before going to the network, so an offline start is no longer held up by a
  download it does not need — and it says which of the two it did. A model whose
  config is neither cached nor downloadable gets a message naming the missing
  piece instead of a stack trace. `LUKE_IMAGE_MODEL_CACHE` points that folder
  somewhere else.
- The worker is told which model the user picked (`--model-version`), because a
  cache copy's folder name is hash-prefixed and would otherwise not identify the
  model whose scheduler belongs to it.
- New suite `scripts/validation/test-image-model-cache.cjs` (72 checks) plus
  `scripts/validation/helpers/coreml-reference-cache-probe.py`, which exercises
  the worker's load order without torch, network, or a Mac. The release contract
  now compiles the Core ML worker — until now a syntax error in the one file that
  only runs on Apple Silicon would have shipped unnoticed.
