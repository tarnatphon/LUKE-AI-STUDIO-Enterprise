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
