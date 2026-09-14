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
