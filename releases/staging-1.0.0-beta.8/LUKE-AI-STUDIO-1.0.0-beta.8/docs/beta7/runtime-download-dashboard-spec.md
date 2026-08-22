# LUKE AI STUDIO Beta 7 Runtime Download Dashboard

Generated: 2026-08-06 11:56:42
Branch: feat/beta7-foundation
Base commit: a5f9083

## Backend APIs Available

- GET /api/runtime/dependencies
- GET /api/runtime/install/jobs
- POST /api/runtime/install/jobs
- GET /api/runtime/install/jobs/:jobId
- PATCH /api/runtime/install/jobs/:jobId
- POST /api/runtime/install/jobs/:jobId/start
- POST /api/runtime/install/jobs/:jobId/cancel

## Required Frontend Features

1. Runtime dependency cards
2. Ready, missing and installing status badges
3. Install button for missing dependencies
4. Progress bar with percentage
5. Downloaded bytes and total bytes
6. Download speed
7. Cancel button for active downloads
8. Checksum verification status
9. Completed and failed states
10. Thai and English status labels
11. Download destination display
12. External drive disconnected warning
13. Safe fallback destination message
14. Automatic polling while jobs are active
15. No duplicate install job for the same dependency

## Preferred Download Directory

```text
/Volumes/EXTERNAL Drive/ai/ai-downloads
```

## Fallback Directory

```text
~/Downloads/LUKE-AI-STUDIO
```

## Entry and Navigation Candidates

```text
app/frontend/src/App.jsx
app/frontend/src/components/Sidebar.jsx
app/frontend/src/components/TopStatusBar.jsx
app/frontend/src/main.jsx
```

## Existing Component Candidates

```text
app/frontend/src/App.jsx
app/frontend/src/components/Generator.jsx
app/frontend/src/components/Home.jsx
app/frontend/src/components/ImageToVideo.jsx
app/frontend/src/components/ModelManager.jsx
app/frontend/src/components/ReferenceManager.jsx
app/frontend/src/components/Settings.jsx
app/frontend/src/components/Sidebar.jsx
app/frontend/src/components/SpeechTranscriber.jsx
app/frontend/src/components/TextChat.jsx
app/frontend/src/components/TextToSpeech.jsx
app/frontend/src/components/TopStatusBar.jsx
app/frontend/src/services/api.js
```

## Polling Rules

- Poll every 750 milliseconds while any job is active.
- Poll every 10 seconds when the dashboard is open but idle.
- Stop polling after the component unmounts.
- Abort outstanding requests when the page changes.
- Do not create more than one polling timer.

## Active States

- queued
- preparing
- downloading
- verifying
- installing
- rolling-back

## Terminal States

- completed
- failed
- cancelled
- rolled-back

## Security Rules

- Installation requires SHA256 from the backend catalog or approved request.
- The frontend must never calculate or override trusted checksums.
- Do not accept arbitrary filesystem installation paths from free-text UI.
- Only use the backend-configured download directory.
- Display errors without exposing stack traces or secrets.

## Next Implementation

Create the Runtime Download Dashboard using the existing frontend architecture, navigation, API request pattern and styling discovered in this report.
