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
| `publish` | โพสต์อัตโนมัติ | backend relay → API ของช่องทาง | ยิงโพสต์จริงผ่าน API (dry run ได้, คีย์เก็บฝั่งเซิร์ฟเวอร์) — ใช้ได้เฉพาะช่องทาง `automation: "api"` |
| `onepost` | โพสต์คลิกเดียว | client-side compose | เตรียมข้อความ + ลิงก์หน้าเขียนที่เติมให้แล้ว สำหรับช่องทางที่ไม่มี API |

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
| GET | `/channels` | คลังช่องทางฟรี 16 แห่ง + กลุ่ม + ฟิลด์คีย์ + `channelsReviewedAt` |
| GET | `/publish/credentials` | สถานะคีย์ (คืนแค่ boolean ต่อฟิลด์ ไม่คืนค่า) |
| PATCH | `/publish/credentials` | ตั้ง/ล้างคีย์ของช่องทาง |
| POST | `/publish/credentials` | เหมือน PATCH (ฟอร์มที่ส่งทั้งก้อน) |
| POST | `/publish/preview` | dry run: คืน request ที่จะยิง โดยคีย์ถูกปิดเป็น `[set]` |
| POST | `/publish/send` | โพสต์จริง `{ channelId, draft, dryRun }` |

## Publishing (v1.1)

การเผยแพร่ไม่เคยยิงจากเบราว์เซอร์ — คีย์และ request ทั้งหมดผ่าน backend relay
(`scripts/server/ai-workflow-publish.cjs`) เพื่อไม่ให้กุญแจหลุดไปอยู่ใน bundle
หรือ devtools ของผู้ใช้

- **คลังช่องทาง:** `scripts/server/social-publish-channels.cjs` เป็นแหล่งความจริง
  เดียว (registry + `compose()` + `plan()` + `resultUrl()`) ทั้งเซิร์ฟเวอร์และ
  frontend (`app/frontend/src/workflow-builder/channels.js`) import ไฟล์เดียวกัน
  จึงไม่มีรายการที่สองที่ค่อย ๆ ไม่ตรงกัน
- **โหมดโพสต์:** `api` (8 ช่องทาง: DEV, Telegraph, Gist, WordPress.com, Telegram,
  Discord, Mastodon, Blogger) · `manual` (7) · `import` (Medium)
- **ผลลัพธ์ของโพสต์:** `artifact.kind = "post"` เก็บ `channel`, `channelName`,
  `automation`, `url`, `published`, `da`, `pa` — **ไม่เก็บตัวบทความ** ลง state
- **คีย์:** `app/runtime-state/ai-workflow/publish-credentials.json` สิทธิ์ `0600`
  เขียนแบบ atomic · `/state` คืนเฉพาะ `true/false` · dry run ปิดค่าเป็น `[set]`
- **ความปลอดภัยของ relay:** HTTPS เท่านั้น (ยกเว้น loopback เมื่อขอ `allowLocalDev`),
  บล็อก loopback/private/link-local/CGNAT/`.local`/`.internal` และ IP ที่ฝังใน URL,
  ตรวจ DNS อีกครั้งก่อนต่อ (กัน rebinding), ไม่ตาม redirect, timeout 20 วินาที,
  request ≤ 200 KB, response ≤ 64 KB, header ผ่าน allowlist เท่านั้น
- **โหมด manual ไม่ throw:** คืน `{ ok:false, manual:true, openUrl, text }` เพื่อให้
  UI เปิดหน้าเขียนที่เติมข้อความให้แล้วได้ทันที

รายละเอียดช่องทาง/DA/PA/ข้อควรระวัง: `docs/beta7/free-high-da-publishing-platforms.md`

## Limits & validation (backend)

- ≤ 60 workflows, ≤ 120 runs (oldest trimmed), ≤ 30 steps per workflow
- Step types whitelisted; per-type config sanitization (text length caps, numeric clamps)
- `publish`/`onepost` ปฏิเสธช่องทางที่ไม่รู้จัก และปฏิเสธ `publish` บนช่องทางที่ไม่มี API
  (ให้ใช้ `onepost` แทน เพื่อไม่ให้ตั้งใจโพสต์อัตโนมัติแล้วได้แค่หน้าต่างให้กดเอง)
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
- คิวโพสต์แบบตั้งเวลา (ตอนนี้ต้องกดรันเอง หรือใช้ Social Agency สำหรับ FB/LINE/IG)
- OAuth flow ในแอปสำหรับ WordPress.com / Blogger / Mastodon (ตอนนี้ผู้ใช้วาง token เอง)
