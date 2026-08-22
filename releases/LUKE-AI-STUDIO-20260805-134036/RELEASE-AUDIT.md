# Local AI Release Audit

This consolidated build uses the validated portable-npm repair base and restores the one-click Image-to-Video capability.

## Release changes
- Removed the incomplete bundled portable Node/npm runtime. macOS setup downloads and verifies a complete official runtime when needed.
- Added one-click Image-to-Video runtime install/repair API and UI.
- Added the Image-to-Video capability manifest and isolated Python runtime installer.
- Removed Python bytecode caches and macOS metadata from the release.
- Added `scripts/validation/validate-release.sh` for repeatable syntax and package checks.

## Known limitation
A full Image-to-Video generation smoke test requires downloading Torch, Diffusers, the selected model, and sufficient compatible hardware. This package validates the installer and worker code but does not bundle those multi-gigabyte dependencies.
