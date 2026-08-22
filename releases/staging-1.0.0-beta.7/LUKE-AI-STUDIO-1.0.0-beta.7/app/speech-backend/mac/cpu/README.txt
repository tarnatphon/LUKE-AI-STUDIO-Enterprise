macOS whisper.cpp CPU backend folder

The app expects an executable at:
  app/speech-backend/mac/cpu/whisper-cli

This fixed build supports Homebrew's current whisper-cpp executable names:
  whisper-cli
  whisper-cpp
  main

To repair manually on macOS:
  bash scripts/setup/setup-whisper.sh

Or with Homebrew:
  brew install whisper-cpp
  mkdir -p app/speech-backend/mac/cpu
  cp "$(brew --prefix whisper-cpp)/bin/whisper-cpp" app/speech-backend/mac/cpu/whisper-cli
  chmod +x app/speech-backend/mac/cpu/whisper-cli
