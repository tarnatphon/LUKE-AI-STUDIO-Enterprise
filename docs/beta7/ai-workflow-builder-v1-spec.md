# Luke AI Workflow Builder — v1 Spec

## What it is

`Luke AI Workflow` is a visual pipeline editor that chains the app's local AI
engines — LLM chat, Stable Diffusion image generation, Kokoro TTS, and Whisper
STT — into one repeatable workflow that runs 100% offline.

- **Workspace id:** `ai-workflow` (sidebar: *Luke AI Workflow*, also on the Home task grid)
- **Frontend:** `app/frontend/src/components/WorkflowBuilder.jsx` + `app/frontend/src/workflow-builder/lib.js` (+ `workflow-builder.css`)
- **Backend:** `scripts/server/ai-workflow-runtime.cjs`, mounted in `serve.cjs`
- **State:** `app/runtime-state/ai-workflow/state.json` (gitignored; atomic tmp+rename writes)

## Node types

| Type | Label (TH) | Engine | Notes |
| :--- | :--- | :--- | :--- |
| `input` | ข้อความตั้งต้น | — | Seed text/topic for the chain |
| `chat` | AI Chat (LLM) | llama.cpp via `/api/llm/chat` | System + user prompt, temperature, max tokens |
| `image` | สร้างภาพ | stable-diffusion.cpp via `generateImage()` | Prompt/negative, W×H, steps, CFG, sampler |
| `tts` | อ่านออกเสียง (TTS) | Kokoro via `/api/tts/speak` | Text template, voice (optional), speed |
| `stt` | เสียง → ข้อความ | whisper via `/api/speech/transcribe` | Transcribes a previous TTS node's audio |
| `transform` | จัดข้อความ | client-side | Template, find/replace, truncate |
| `condition` | เงื่อนไข | client-side | contains / not_contains / regex / min_length / max_length — a failed check halts the run |
| `output` | ผลลัพธ์ | — | Terminal display node |

## Template variables

- `{{input}}` — output of the previous node
- `{{<ชื่อโหนด>}}` — output of any earlier node by its display name
- Unknown variables resolve to empty string

## Execution model

Execution is **client-side and sequential** (top → bottom), reusing the exact
same frontend service helpers as the Chat / Create Image / TTS / Speech
workspaces — no duplicate engine wiring. Each node transitions
`idle → running → done | failed | halted` with per-node duration, output, and
artifacts (image data URL / audio URL). After a run finishes (success, failed,
or halted), the frontend reports a **run record** to the backend:

```
POST /api/ai-workflow/runs { workflowId, status, startedAt, finishedAt, durationMs, nodes[] }
```

Artifacts are trimmed before reporting (base64 images are never persisted;
only `kind`, `url`, `file`, `seed` survive).

## REST API (`/api/ai-workflow/*`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| GET | `/state` | Workflows + recent runs + stats |
| POST | `/workflows` | Create (seeds input+output steps) |
| PATCH | `/workflows/:id` | Rename / replace steps (validated + sanitized) |
| POST | `/workflows/:id/duplicate` | Copy workflow |
| DELETE | `/workflows/:id` | Delete workflow + its runs |
| GET | `/runs?workflowId=&limit=` | Run history |
| POST | `/runs` | Record a run |
| DELETE | `/runs/:id` | Delete a run record |

## Limits & validation (backend)

- ≤ 60 workflows, ≤ 120 runs (oldest trimmed), ≤ 30 steps per workflow
- Step types whitelisted; per-type config sanitization (text length caps, numeric clamps)
- Run node outputs stored as ≤ 8,000-char snippets

## Workflow Tab upgrades (Social Agency)

Shipped together with the builder, the Social Agency **Workflow tab** now:

- shows the **`score` (คะแนนไวรัล)** node that the backend has always emitted
  (frontend previously dropped the label/icon for it),
- has a **รันเลยตอนนี้** button directly in the topbar (previously required the
  Calendar tab or entry drawer),
- offers inline **อนุมัติ & เผยแพร่ / ยกเลิก** actions when a run is waiting at the
  human gate,
- filters run history by status (ทั้งหมด / สำเร็จ / รออนุมัติ / ล้มเหลว),
- shows a live **node progress bar** while a run is in-flight, and
- exports the selected run as a **JSON report** download.

## Future work

- Free-form DAG canvas with branch merge nodes
- Scheduler trigger (run a workflow on a Bangkok-time schedule, like the agency)
- Backend-side execution queue so runs survive page reloads
- Export/import workflows as JSON files
