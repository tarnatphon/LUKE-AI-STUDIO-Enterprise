# Online surfaces — why LUKE is not like anything else, and the no-pay boundary

อัปเดต: **2026-11-02** · ใช้คู่กับ [fcc-work-chat-bridge.md](fcc-work-chat-bridge.md)
และ `scripts/config/ai-provider-catalog.json`

เอกสารนี้ตอบสองคำถามจากเจ้าของงาน: *"ถ้าเป็นออนไลน์ ใช้ได้ในไหนบ้าง"* และ
*"อะไรทำให้ LUKE โดดเด่นไม่เหมือนใคร"* แล้วแปลเป็นของที่รันได้จริง 4 ระยะ

> **นิยามที่เจ้าของงานให้ (สำคัญที่สุด)**: คำว่า **"เสียตังค์" = ต้องจ่ายตังค์มาใช้ต่อ**
> (having to pay to keep using) **ไม่ใช่** "เจ้านี้ก็ขายแพลนเสียเงินด้วย"
> ดังนั้น **free tier, free daily allowance และ trial credit แบบต้องผูกบัตร
> ล้วนคือ "การใช้ฟรี" ที่ใช้งานได้ตามปกติ** ใช้ให้เต็ม แล้วค่อยเปลี่ยนมาเป็น
> local LLM / local engine — **ห้ามจ่ายเพื่อใช้ต่อเด็ดขาด**
> (ไม่เติมเครดิต / ไม่ upgrade / ไม่เก็บข้อมูลบัตร / เจอ `402` ให้ถอย)

---

## 0. ตำแหน่ง (positioning)

**LUKE = Sovereign AI Studio**: เครื่องเดียวที่เป็นสตูดิโอครบวงจร
(รูป + ข้อความ + เสียง + วิดีโอ + Workflow + Social Agency + Storage governance)
**ออฟไลน์โดยค่าเริ่มต้น**, แต่สามารถ **ยืมความสามารถออนไลน์แบบฟรีเท่านั้น**
และ **พิสูจน์ได้ว่าอะไรออกจากเครื่องไปบ้าง**

สามเสาที่จากการสำรวจ landscape ปี 2026 แล้วไม่มีใครมีครบ:

| เสา | สิ่งที่ LUKE ทำ | สิ่งที่คนอื่นทำ |
| :--- | :--- | :--- |
| **1. หลักฐาน ไม่ใช่คำสัญญา** | Egress Ledger บันทึกทุก outbound ของ online surfaces + รายงาน air-gap หนึ่งหน้า | แอป local-first (Jan / LM Studio / Ollama / Open WebUI / AnythingLLM) มีความเป็นส่วนตัวเป็นคำโฆษณา; LM Studio มี analytics + update check แบบ opt-out, Jan ไม่มี telemetry แต่ก็ไม่มี log ให้ตรวจ |
| **2. ฟรีอย่างเดียว + ห้ามจ่าย + เลนไม่กรอง** | ตัด provider ที่ต้องจ่าย/ต้องผูกบัตร/prepaid ออกจาก catalog และ transport **ไปเลย** (ไม่มีสวิตช์ให้เปิดกลับ); หมดฟรี → local GGUF; มีสวิตช์ no-filter ที่บังคับ local | router ฟรี (FreeLLMAPI / OpenRouter / FCC) รวม free tier + failover ได้ แต่ยังมีปลายทางแบบเสียเงินให้กด และไม่มีเลน local อยู่ข้างๆ |
| **3. ครบวงจรในโปรเซสเดียว** | 4 engine + Workflow Builder + 24 ช่องทางโพสต์ + ปฏิทิน/Insights + storage DR | ฝั่ง cloud all-in-one (Krater / Poe / Monica / Artificial Studio) มี media แต่เป็น subscription; ฝั่ง scheduler (Buffer / Postiz / Hootsuite) มีแต่โพสต์ |

จังหวะตลาด: hybrid routing แบบ *local by default, cloud on escalation* กำลังกลายเป็น
สถาปัตยกรรมมาตรฐานในปี 2026 แต่ผู้เล่นใหญ่ยัง **เริ่มจาก cloud ก่อน**
(Perplexity Hybrid Compute แยกงานลับไว้บนเครื่อง แต่ทุก task เริ่มใน cloud)
→ LUKE เป็นฝั่งกลับด้านที่ยังไม่มีคนทำจริง

แหล่งอ่านเพิ่ม: [hybrid architecture 2026](https://www.digitalapplied.com/blog/on-device-local-ai-agents-2026-privacy-cost-stack-forecast),
[Perplexity hybrid](https://omidsaffari.com/blog/local-ai-agents-vs-cloud-ai-agents-for-confidential-work-2026),
[local GUI เปรียบเทียบ](https://llmconfigurator.com/en/blog/open-webui-vs-lm-studio-vs-jan),
[privacy audit](https://www.local-llm.net/blog/local-ai-privacy-audit/),
[egress evidence pack](https://like2byte.com/local-ai-privacy-audit-guide/),
[FreeLLMAPI](https://www.opensourcealternatives.to/item/freellmapi),
[OpenRouter limits](https://openrouter.zendesk.com/hc/en-us/articles/39501163636379-OpenRouter-Rate-Limits-What-You-Need-to-Know),
[all-in-one cloud](https://krater.ai/blog/best-all-in-one-ai-tools),
[schedulers](https://arahi.ai/blog/best-social-media-schedulers-2026),
[channels](https://github.com/agentscope-ai/QwenPaw)

---

## 1. ใช้ได้ในไหน (สองความหมาย)

### A. ช่องทาง / อุปกรณ์

| ช่องทาง | สถานะ | วิธีใช้ |
| :--- | :--- | :--- |
| เครื่องหลัก (Tauri / browser `localhost:1420`) | มีอยู่แล้ว | `./mac.sh` |
| มือถือ / iPad / คอมอีกเครื่องใน LAN | **ใหม่ (ระยะ 2)** | server bind `0.0.0.0` อยู่แล้ว → เปิด **Pair a device** ใน Settings → เอา token ใส่ header `x-luke-pair` (default-deny ถ้าไม่ pair) |
| PWA ติดตั้งหน้าจอ + ใช้ UI ต่อได้ตอนเน็ตหลุด | **ใหม่ (ระยะ 2)** | `manifest.webmanifest` + `sw.js`; **ไม่แคช `/api/` และ `/v1/`** เพราะ status/ledger ที่แคชไว้คือคำโกหก |
| Telegram / Discord / LINE | **ใหม่ (ระยะ 3)** | webhook mode (ไม่มี poller พื้นหลัง): `POST /api/channels/webhook?platform=telegram` ตอบกลับใน HTTP response ได้เลย |
| VS Code / CLI / editor อื่น | **ใหม่ (ระยะ 3)** | `POST /api/mcp` (JSON-RPC `tools/list`, `tools/call`) |
| แอปอื่นชี้ base URL มาที่ LUKE | **ใหม่ (ระยะ 3)** | `http://127.0.0.1:1420/v1` → `/chat/completions` (OpenAI-compatible) |
| โพสต์ 24 ช่องทาง / LinkedIn / ฟอรัม | มีอยู่แล้ว | `docs/beta7/forum-and-community-posting.md`, `linkedin-posting.md` |
| S3 / R2 / B2 / GitHub | มีอยู่แล้ว | `/api/storage/*`, `WorkGithubPanel` |
| อัปเดต signed manifest | มีอยู่แล้ว | README หัวข้อ Automatic updates |

> ** zero static egress**: `index.html` เดิมโหลด Google Fonts จาก CDN → เอาออกแล้ว
> (ใช้ system font stack แทน) ไม่งั้น "air-gap" จะไม่เป็นจริงตั้งแต่เปิดหน้า UI

### B. จุดในโปรแกรม

| พื้นที่ | สิ่งที่ online เพิ่ม |
| :--- | :--- |
| Chat + Work | free cascade → local fallback ( online-first สำหรับทั้งคู่ ) |
| รูป/เสียง/วิดีโอ/PDF เข้าใจ | content-part translator → Gemini / Mistral |
| Luke AI Workflow | โหนด `AI Chat` → cloud → `publish` (คิด → สร้าง → โพสต์ ใน pipeline เดียว) |
| Social Agency | วิเคราะห์ reach / แนะนำมุมคอนเทนต์ |
| Asset Library / Storage | `/api/storage/*` ~50 routes เดิม |
| Model Manager / llmfit | `verifiedAt` + ปุ่ม Test กันโมเดล `:free` หมุนอายุ |
| Whisper / Kokoro / SD / I2V | local 100% **และเป็นทางตกเมื่อ free credit หมด** |
| Memory / RAG / web search | `augmentMessagesWithWebSearch()` เดิม |
| TopStatusBar / Settings | badge ที่คำนวณจาก ledger + สวิตช์นโยบาย |

---

## 2. ระยะที่ 1 — นโยบาย + หลักฐาน

**ไฟล์**: `scripts/config/ai-provider-catalog.json`, `scripts/server/ai-provider-catalog.cjs`,
`scripts/server/online-surfaces.cjs`, `scripts/server/egress-ledger.cjs`

- catalog เดียว **18 รายการ**: ทุกตัว `free=true`, `paid=false`, `neverPays=true`,
  `exhaustion="local"` และมี `allowance` บอกว่าฟรีแบบไหน
  `kind` เป็น `free-tier` (ฟรีประจำ) / `trial-credit` (เครดิตฟรีใช้จนหมด) / `local`
- **คืนรายการที่มีการใช้ฟรีจริง** 8 รายการ: `groq` (free plan สำหรับ open models),
  `cohere`, `azure` ($100/student credit), `aws` (new-account credits),
  `gcp` ($300 trial), `cerebras` ($5/30 วัน), `sambanova` (เฉพาะคนที่มี grant เดิม),
  `huggingface` (Inference Providers credit) — 4 รายการแรกในกลุ่ม cloud ต้องผูกบัตร
  **บนเว็บของ provider เอง** ไม่ใช่ใน LUKE
- **ยังไม่มี** รายการที่ต้องจ่ายตั้งแต่ครั้งแรก: `arena` (prepaid), `openai`,
  `anthropic`, `xai`, `oci`, `together`, `fireworks`, `coreweave`,
  `github_models` (ปิดบริการ 2026-07-30), `amd` (hardware ไม่ใช่ API)
- `groq` ลงทะเบียนเป็น free tier แต่ **ไม่ใส่ใน `DEFAULT_ORDER`** — เจ้าของต้องเชื่อม key
  และเช็คหน้า rate limit เอง ถ้าเจอ `402` → `now_paid` → ไป link ฟรีถัดไป / local
- `no-pay` เป็น **invariant ไม่ใช่สวิตช์**: ไม่มี `freeOnly` ใน config
  (export `NO_PAY = true`) และ `transportPolicy()` คืน `paid = !free` เสมอ
  ฉะนั้นการแก้ catalog ด้วยมือให้ `paid=false` ทั้งที่ `free=false` ก็ยังใช้ไม่ได้
  key เก่าที่ค้างในไฟล์ config (รวม legacy `key` ของ Arena router) ถูกปฏิเสธเงียบๆ
- config `app/runtime-state/online-surfaces/config.json` (0600, gitignored) — **8 สวิตช์**:

| flag | default | ความหมาย |
| :--- | :--- | :--- |
| `cloudForChat` | `true` | แชท online-first ตามที่เจ้าของงานเลือก |
| `uncensoredMode` | `false` | ทุกเทิร์นอยู่ local GGUF |
| `airGapMode` | `false` | บล็อก cloud ทุกเทิร์น + บันทึกการปฏิเสธ |
| `gatewayEnabled` / `mcpEnabled` | `true` | ประตูสำหรับแอปอื่น |
| `channelsEnabled` / `onlineMediaEnabled` | `false` | ต้องเปิดเอง |
| `rateLimitRetry` | `0` | เปิดเองได้ 0–3; retry 429 แบบมีขอบเขตก่อนไป link ถัดไป |

- Egress Ledger: `app/runtime-state/egress/ledger.jsonl` (JSONL, 0600, จำกัด 5,000 แถว)
  บันทึก `host / provider / surface / method / bytes / decision / reason / model / paid`
  **ไม่มี prompt ไม่มี key ไม่มีข้อมูลบัตร ไม่มี response body**
- `GET /api/egress/report` → attestation + SHA-256; `?format=text` → หน้าเดียว
  รายงานระบุ scope ชัดเจนว่าเป็นเฉพาะ LUKE online surfaces (OS/browser อยู่นอก scope)

## 3. ระยะที่ 2 — multimodal + LAN + PWA

**ไฟล์**: `scripts/server/content-parts.cjs`, `scripts/server/lan-pairing.cjs`,
`app/frontend/public/*`, `app/frontend/src/main.jsx`, `index.html`

- เดิม `buildRemotePayload()` กรอง `typeof content === "string"` → รูปที่แนบในแชท
  **หายเงียบๆ** ตอนนี้แปลเป็น 3 wire shape:
  OpenAI (`image_url`) / Anthropic (`image` + base64 source) / Gemini (`inline_data`)
  อนุญาตเฉพาะ `data:` URL แบบ inline (จำกัด 8 MB, 8 parts) — **ไม่ให้ provider ไป fetch
  URL ภายในเครื่อง**; link ที่รับ text อย่างเดียวได้ placeholder แทน
- provider ใหม่ที่ต่อTransport จริง: `gemini` (OpenAI-compatible `/v1beta/openai`, 1M ctx,
  image/audio/video/PDF) และ `mistral` (Free mode) — ทั้งคู่ `free: true`
  `DEFAULT_ORDER` เดิมไม่เปลี่ยน (ยัง `nvidia → openrouter → zai`) เพื่อไม่กระทบชุดเทสต์เดิม
  provider ที่บันทึก key จะถูก `ensureOrder` เติมเข้าท้าย chain
- LAN: `authorize()` เช็ค `req.socket.remoteAddress` → loopback ไว้ใจเสมอ
  (ทุก validation suite ใช้ 127.0.0.1 จึงไม่กระทบ), นอกนั้น default-deny
  อนุญาตเฉพาะ static asset + handshake (`/api/health`, `/api/online-surfaces/status`,
  `/api/lan/status`, `/api/lan/pair`) token สุ่ม 24 bytes แสดง **ครั้งเดียว** ไม่คืนค่าอีก
- PWA: icon 192/512, `display: standalone`, service worker แบบ network-first สำหรับ
  navigation / cache-first สำหรับ asset แบบ hash, **ไม่แคช API**

---

## 4. ระยะที่ 3 — ประตูสำหรับโลกภายนอก

**ไฟล์**: `scripts/server/mcp-server.cjs`, `scripts/server/channel-relay.cjs`,
route `/v1/chat/completions` ใน `serve.cjs`

- **External gateway**: ตั้ง base URL ของ LM Studio / Ollama / Claude Code เป็น
  `http://127.0.0.1:1420/v1` แล้วเรียก `/chat/completions` ได้เลย
  ตอบได้ทั้งแบบ JSON และ SSE; ถ้า free chain หมดและไม่มีโมเดล local → `503` พร้อมคำอธิบาย
  (ไม่ใช่ 500) ต้อง declare **ก่อน** `/v1/` proxy เดิม ไม่งั้นถูกส่งไป image backend
- **MCP**: `POST /api/mcp` รองรับ `initialize`, `tools/list`, `tools/call`
  tools: `luke_status`, `luke_providers`, `luke_chat`, `luke_egress_report`
  ไม่มี tool แตะไฟล์ / terminal / key
- **Channels**: config ที่ `app/runtime-state/channels/config.json` (0600)
  โทเค็นไม่คืนเบราว์เซอร์; ตรวจ `x-telegram-bot-api-secret-token` /
  HMAC-SHA256 ของ LINE / presence ของ Discord signature
  webhook ตอบกลับใน HTTP response (Telegram `method: sendMessage`, Discord `type: 4`)
  → **ไม่ต้องมี outbound call ในกรณีทั่วไป**; ถ้าต้องยิงเองใช้ `/api/channels/send`
  (dry-run ได้) ทุกการยิงผ่าน `recordEgress`

---

## 5. ระยะที่ 4 — ใช้เครดิตฟรีให้เต็ม แล้วตก local

**ไฟล์**: `scripts/server/online-media.cjs`

Frontier image/video generation **ไม่มี free tier แบบ recurring ในปี 2026**
แต่มี **การใช้ฟรี** อยู่ 2 แบบ ซึ่งตามนิยามของเจ้าของงานใช้งานได้ทั้งคู่:

| ประเภท | ตัวอย่าง | ปฏิบัติ |
| :--- | :--- | :--- |
| no-card daily allowance | `kling_free` 6 เครดิต/วัน | ใช้จนหมด → reset ทุก UTC day |
| card-backed trial grant | `fal_trial` ~$20 · `veo_gcp_trial` $300 · `stability_trial` 25 | ใช้จนหมด → **ห้ามเติม** |

บัตร (ถ้าต้องมี) **ผูกบนเว็บของ provider เอง** LUKE เห็นแค่ยอดเครดิต
`requiresCard` เป็นข้อมูลให้เจ้าของทราบ **ไม่ใช่ด่าน** และไม่มี `cardConfirmed` อีกต่อไป

ด่านที่ยังอยู่ (กันไม่ให้ใช้เครดิตโดยไม่ตั้งใจ):

1. ต้องเปิด `onlineMediaEnabled` เอง
2. provider ต้องเป็น `freeWhileCreditsLast` ที่ประกาศไว้ (4 ตัว) และ `paid=false`
3. `quote()` ต้องอยู่ใน grant ที่เหลือ — ถ้าไม่พอคืน `eligible:false`
4. ทุก request ต้องมี `explicitConsent: true` **และ** `creditConfirmed: true`
5. **default คือ dry run** — `live: true` เป็น flag แยกต่างหาก
6. field ที่เกี่ยวกับการจ่าย (`cardNumber` / `cvv` / `autoTopUp` / `paidPlan` /
   `cardConfirmed` / `billing` …) ถูกปฏิเสธทันทีด้วย `400 payment_field_rejected`
   **ก่อน** มี ledger entry หรือ network call

**จุดตัดจ่าย (หัวใจของงานรอบนี้)**:

- เครดิตหมด → `409 free_credit_exhausted` + `fallback: "local"` +
  บันทึก ledger เป็น `blocked` (reason: *no top-up, no payment, falling back to local*)
- upstream ตอบ `402` / `Payment Required` / `insufficient credits` / `quota exceeded`
  → ตัดยอด grant เป็น `spent` เต็ม + `402 now_paid` + `fallback: "local"`
  **ไม่ลองใหม่ด้วยเงิน ไม่ upgrade**
- ไฟล์ `app/runtime-state/online-media/spend.json` (0600) เก็บแค่
  `{ spent, day, savedAt }` — ไม่มีเลขบัตร ไม่มี key ไม่มี prompt

เมื่อหมดฟรี งานตกไป engine ในเครื่องทันที:
`stable-diffusion.cpp` (รูป/img2img) · `whisper.cpp` (เสียง→ข้อความ) ·
`kokoro-js` (ข้อความ→เสียง) · `image-to-video` · Luke AI Workflow
Egress Ledger ระบุใน attestation ว่า media dispatch เป็น free credit only และ LUKE never pays

## 6. API ใหม่ทั้งหมด

| Method | Path | หมายเหตุ |
| :--- | :--- | :--- |
| GET | `/api/online-surfaces/status` | badge + policy + counters |
| POST | `/api/online-surfaces/config` | สวิตช์นโยบาย |
| GET | `/api/online-surfaces/catalog` | ตาราง 18 รายการที่มีการใช้ฟรี (free tier + trial credit + local) |
| GET | `/api/egress/ledger` | รายการล่าสุด |
| GET | `/api/egress/report` | attestation (`?format=text`) |
| POST | `/api/egress/clear` | ต้อง `confirm: true` |
| GET | `/api/lan/status` | ไม่คืน token |
| POST | `/api/lan/pair` | คืน token ครั้งเดียว, loopback เท่านั้น |
| POST | `/api/lan/revoke` | |
| POST | `/api/mcp` | JSON-RPC 2.0 |
| GET | `/api/channels/status` | |
| POST | `/api/channels/config` / `webhook` / `send` / `test` | |
| GET | `/api/online-media/providers` | ยอดเครดิตฟรีคงเหลือ + `neverPays` |
| POST | `/api/online-media/quote` | quote เครดิตฟรี, บอก `fallback: "local"` |
| POST | `/api/online-media/generate` | ต้อง consent ทุก job; หมด → 409 + fallback local |
| POST | `/v1/chat/completions` | external gateway |

---

## 7. ชุดตรวจ no-pay (regression guard)

`node scripts/validation/test-no-pay-audit.cjs` ไม่ได้ทดสอบฟีเจอร์ แต่ตอบคำถามว่า
*"มีทางที่ LUKE **จ่ายเงินเพื่อใช้ต่อ** แฝงกลับเข้ามาไหม"* โดยเดิน production source
ทุกไฟล์แล้วตรวจ 6 หมวด:

1. `NO_PAY` เป็น invariant — config มี **8 สวิตช์** ไม่มี `freeOnly` / `paid` /
   `billing` / `card` และ `setConfig({paidAllowed:true, allowPaid:true})` ไม่ถูกเขียนลงไฟล์
2. catalog ทุก entry `free=true` + `neverPays=true` + `exhaustion="local"` ·
   การ์ดอนุญาตเฉพาะ `trial-credit` ที่ `cardBoundOnProviderSite=true` ·
   ไม่มี id ที่จ่ายตั้งแต่ครั้งแรก · provider ไม่รู้จัก fail closed เป็น `paid` ·
   transport ทุกตัวชี้ host ใน allowlist ของ free usage (รวม `api.groq.com`)
3. **ไม่มี payment path**: ไม่มี host ของ API แบบ prepaid (OpenAI / Anthropic / xAI /
   Together / Fireworks / Arena / Replicate / Azure OpenAI …) ·
   ไม่มีโค้ดที่รับ `cardNumber` / `cvv` / `autoTopUp` / `paidPlan` / `cardConfirmed` /
   `paymentMethod` · field พวกนี้มีอยู่ **เฉพาะใน denylist ของ `online-media.cjs`
   เพื่อปฏิเสธ** · ตรวจว่า `assertNoPaymentFields()` ถูกเรียกก่อน `quote()` ·
   web search ใช้ DuckDuckGo เท่านั้น · S3/R2/B2 ไม่มี endpoint hardcoded
4. **การใช้ฟรีไม่ถูกตัด**: โมดูล media มีอยู่ 4 provider · card-backed trial quote ได้
   โดยไม่ต้องส่ง flag บัตร · ปฏิเสธเลขบัตร / top-up / paid-plan ·
   **ใช้ grant จนหมดทุกเครดิต** แล้ว job ถัดไปได้ `409` + `fallback:"local"`
   และไม่มี dispatch เพิ่ม · `402` ถูกตัดยอดเป็น spent ทันที ·
   spend file ไม่มีข้อมูลบัตร · 3 route ถูกประกาศและมีสวิตช์ gate ·
   UI มี 8 สวิตช์ · local engine ยังผูกอยู่
5. หมดฟรียังตกมา local GGUF: `setLocalProvider` + `/api/text-runtime/remote-provider/local`
   ยังอยู่, `402` → `now_paid` → ถอย, air-gap / no-filter / ปิด online-first Chat ปฏิเสธ cloud ได้จริง
6. README + เอกสารนี้พูดตรงกัน

การเพิ่ม free provider หรือ host ใหม่ต้องแก้ allowlist ในชุดตรวจพร้อมบอกเหตุผล
→ ทางจ่ายไม่สามารถแอบกลับเข้ามาแบบเงียบๆ ได้

**ขอบเขตที่ต้องพูดตรงๆ**: S3/R2/B2, GitHub, Telegram/Discord/LINE และ 24 ช่องทางโพสต์
เป็น **บัญชีของเจ้าของเอง** ที่ต้องใส่ credential ก่อน ไม่มีค่าใช้จ่ายฝั่ง LUKE
และไม่ถูกเรียกอัตโนมัติ

---

## 8. ข้อจำกัดที่ต้องพูดตรงๆ

1. **FCC เป็นคนถือราคาฝั่งใน** — LUKE บังคับได้แค่ catalog ของตัวเอง
   ต้องตั้ง FCC Admin ให้ใช้ free provider เท่านั้น / pin free model ref
2. **เฉพาะเจ้าที่ต้องจ่ายตั้งแต่ครั้งแรกที่ถูกลบ** — `arena` (prepaid), `openai`,
   `anthropic`, `xai`, `oci`, `together`, `fireworks`, `coreweave`,
   `github_models` (ปิดแล้ว), `amd` (hardware) ไม่มี object ให้เรียก ไม่มี key ที่อ่านกลับมา
   ส่วน `groq` / `azure` / `aws` / `gcp` / `cerebras` / `cohere` / `sambanova` /
   `huggingface` **คืนมาแล้ว** เพราะมีการใช้ฟรีตามนิยามข้างต้น
   (Groq ยังต้องเช็คหน้า rate limit เอง และ `402` = ถอย ไม่ใช่จ่าย)
3. **catalog ที่เหลือก็ยังหมุนเวียน** — โมเดล `:free` เปลี่ยนได้ทุกเดือน
   → `verifiedAt` + ปุ่ม **List models / Test** ใน Settings คือเครื่องมือตรวจ
   อย่า hardcode ว่าฟรีตลอดไป; ถ้าเจ้าไหนเริ่มคิดเงิน (`402`) chain จะเดินต่อไป
   link ฟรีถัดไป หรือตกมา local GGUF ไม่มีทางจ่าย
4. **"ไม่กรอง" ทำได้จริงเฉพาะ local weights** — ไม่มีความพยายามหลบ moderation
   ของ provider ใดๆ; hosted ที่ขายว่า uncensored ก็ยังบล็อก illegal content
5. **Air-gap attestation พิสูจน์เฉพาะ LUKE online surfaces** — ต้องการหลักฐานระดับ
   regulated ให้จับ PCAP/firewall egress เพิ่มตามคู่มือ audit
6. **ข้อมูลแชทที่ online ออกนอกเครื่อง** — รวม system prompt, ความจำ, path โฟลเดอร์,
   เนื้อหาไฟล์แนบ → นี่คือเหตุผลที่มี badge, สวิตช์ปิด, และเลน no-filter

---

## 9. เช็กลิสต์บน Mac (หลัง merge)

```bash
cd /Volumes/AI/LUKE-AI-STUDIO-Enterprise
git fetch origin
git checkout main
git pull --ff-only
cd app/frontend && npm install && npx vite build
cd ../.. && ./mac.sh
```

> ⚠️ ต้อง build ใหม่เพราะ `app/dist/` อยู่ใน `.gitignore`
> ⚠️ zsh บน Mac ไม่เปิด `interactivecomments` — ห้ามวางบรรทัดที่มี `#` ต่อท้ายคำสั่ง

1. เปิด Settings → **Online surfaces** → ดู badge และ 8 สวิตช์
   (ข้อความ "Free usage is used until it is spent, then local" ต้องปรากฏ และไม่มีสวิตช์ `freeOnly`)
2. ปิดเน็ต → เปิดแอป → ยังใช้งานได้ (PWA shell) → `GET /api/egress/report?format=text`
   ต้องขึ้น `Allowed outbound requests: 0`
3. ต่อ free provider → ส่งแชท → `cloud: {provider, model}` ปรากฏ → ledger มี `allowed`
   และ `paidCalls` ต้องเป็น `0`
4. ลอง `POST /api/text-runtime/remote-provider/key` ด้วย `providerId: "arena"`
   → ต้อง `400` (prepaid router ถูกลบ) · `groq` บันทึก key ได้แต่ไม่อยู่ใน chain อัตโนมัติ
   → ถ้า provider ตอบ `402` ต้องมี entry `blocked` เหตุผล `no-pay invariant`/`now_paid`
   และไม่มี request ออกไปหาเจ้านั้น
5. เปิด `Air-gap proof mode` → ทุกเทิร์นอยู่ local + ledger บันทึกการปฏิเสธ
6. มือถือใน LAN → กด **Pair a device** → ใส่ `x-luke-pair` → เข้า UI ได้
7. ตั้ง base URL ของแอปอื่นเป็น `http://127.0.0.1:1420/v1` → `/chat/completions` ตอบ
8. ตั้ง Telegram webhook + secret → ส่งข้อความ → ได้คำตอบกลับใน response
9. รัน `node scripts/validation/test-no-pay-audit.cjs` → ต้อง `0 failed`
   (ยืนยันว่าไม่มีทางจ่าย + การใช้ฟรียังใช้งานได้ + หมดแล้วตก local)
10. เปิด `Free-credit media generation` → กด **Quote the free allowance** →
    ใช้จนหมด → job ถัดไปต้องตอบ `409 free_credit_exhausted` + `fallback: "local"`
