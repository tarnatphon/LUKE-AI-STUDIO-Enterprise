# ARENA_HANDOFF.md — บันทึกส่งต่องานระหว่าง session

> **อัปเดตล่าสุด:** 2026-09-30 (session `arena/01a0f086…` — **สเกล steps ของ img2img** ให้ backend ตัดตาม denoise แล้วยังได้สเต็ปจริงครบ (20 สเต็ป @ denoise 0.38 = ส่ง 53) · กฎกลางไฟล์เดียวใช้ทั้ง Generator และ Social Agency · เทสต์ใหม่ 16 checks · run-all 143 passed · 0 failed · 0 known-failing · 1 skipped (ชุด Python ไม่รันเพราะ `--include-python` เป็น opt-in) · **PR #28 merged แล้ว เป็น `66863bf`, CI เขียวทั้ง workflow**) 
> **อัปเดตล่าสุด:** 2026-09-30 (session `arena/01a0f037…` — **สืบหา commit `5be0bd0` / `1d7d26c` ตามคำขอ: ไม่มีอยู่จริงทั้งใน sandbox, บน GitHub และบนเครื่อง Mac** → push ไม่ได้ (ไม่มี object ให้ push) · งานเนื้อหาชุด img2img อยู่ใน `main` แล้วเป็น `5d64236` + `f83ee8d` → merge `24c2a64` · แก้ข้อมูล branch บน GitHub ในข้อ 1 ให้ตรงกับที่ `ls-remote` เห็นจริง · รายละเอียดที่มา/ที่ตรวจแล้วอยู่ท้ายข้อ 6)
> **อัปเดตล่าสุด:** 2026-09-29 (session `arena/01a0eb60…` — รูปสินค้าอ้างอิงเปลี่ยนไปใช้ img2img จากรูปสินค้าจริง · เตือนใน UI เมื่อ backend ไม่ได้ใช้รูปอ้างอิง · แก้สไตล์เช็กบ็อกซ์ในด่านตรวจภาพ · 143 passed / 0 failed)
> **อัปเดตล่าสุด:** 2026-09-27 (session `arena/01a0e089…` — ปิดงานค้างหัวข้อ 6 ครบทุกข้อและ merge เข้า `main` แล้วเป็น `6397105` · `ci-baseline.json` ว่าง · 140 passed / 0 failed ทั้ง macOS และ Linux CI)
> **อัปเดตล่าสุด:** 2026-09-27 (session `arena/01a0e089-luke-ai-studio-enterprise` — เก็บกวาด repo: ลบไฟล์สำรอง + ลบ branch เก่า)
>
> **อัปเดตล่าสุด:** 2026-09-27 (session `arena/01a0e089…` — CI + ตัวรันชุดเทสต์, แก้บั๊กที่ CI เจอ)
> **วิธีใช้ไฟล์นี้:** ท้ายทุก session ให้แก้หัวข้อ "งานค้าง" ด้านล่าง แล้ว **commit + push ให้เรียบร้อย**
> ทุก session ของ Arena จะ clone ใหม่จาก `main` เสมอ — ไฟล์หรือโค้ดที่ไม่ได้ push จะ**ไม่ตามมา** session ถัดไป
> **หมายเหตุ:** เพราะ session ถัดไป clone จาก `main` งานจึงต้อง **merge เข้า `main` ด้วย** (เปิด PR → merge) ไม่ใช่แค่ push branch ทิ้งไว้
> ส่วนค่า sha ของ `main` ในข้อ 1 ไม่ต้องอัปเดตทุกครั้ง — มันจะตามหลังไป 1 commit ทุกครั้งที่ไฟล์นี้ถูก merge จึงให้ดู `git log -1 --oneline main` แทน

---

## 1. สถานะปัจจุบัน

| รายการ | ค่า |
|---|---|
| `main` | ดู sha ล่าสุดด้วย `git log -1 --oneline main` — ณ 2026-09-30 คือ `24c2a64` (merge ของ PR #26) |
| เวอร์ชัน | `1.0.0-beta.16` (`app/version.json`, tag `v1.0.0-beta.16`) |
| PR ที่เปิดค้าง | **ไม่มี** — PR #28 (สเกล steps ของ img2img + เทสต์) merged 2026-09-30 04:34Z เป็น `66863bf`; CI `validation suites` เขียวทั้ง workflow (runs 36669042409) · ก่อนหน้า: PR #26 (รูปสินค้าอ้างอิง → img2img + เตือนใน UI + แก้เช็กบ็อกซ์) **merged แล้ว** 2026-09-29 04:33Z เป็น `24c2a64` (commits ที่ push จริง: `5d64236` + `f83ee8d`) · ก่อนหน้า: #25 = `e21eb87`, #21 = `6397105` |
| branch บน GitHub (ตรวจด้วย `git ls-remote` 2026-09-30) | `main` `24c2a64` · `arena/01a0e089…` `2584762` · `arena/01a0e633…` `3095163` · `arena/01a0eb2c…` `6080dd5` · `arena/01a0eb60…` `24c2a64` · `arena/01a0ebd4…` `24c2a64` · `ci/validation-suites` `8274bde` — **ยังไม่ได้ลบ** (ข้อความเดิมที่ว่า "เหลือแค่ `main`" ไม่จริงแล้ว) · tag `v1.0.0-beta.16` = `fe84a3c` |
| งานค้างที่ทราบ | **ยืนยัน img2img กับ backend จริงบน Mac (โค้ดอยู่ใน `main` แล้วจาก PR #28)** — คราวนี้ต้องดูทั้ง `imageJob.refMode` และ `steps`/`stepsSent` และเวลาสร้างที่นานขึ้น (~2.6 เท่าที่ denoise 0.38) · สร้างภาพ WSB-019 ใหม่ (ดูท้ายหัวข้อ 2) · หัวข้อ 6 **ปิดครบแล้ว** · งานที่จงใจทิ้งไว้อยู่ท้ายหัวข้อ 6 · **ไม่มี commit ค้างให้กู้** (ดูท้ายข้อ 6) |

---

## 2. งานล่าสุดที่เข้า `main`

### PR #28 (session `arena/01a0f086…`, 2026-09-30 — merged เป็น `66863bf`, CI เขียว) — สเกล steps ของ img2img ให้ prompt มีผลจริงที่ denoise ต่ำ
> ต่อจาก PR #26 โดยตรง: หลังเปลี่ยนมาใช้ img2img ที่ denoise 0.38 แล้ว "สินค้าตรงขึ้น แต่ prompt แทบไม่มีผล" เพราะ backend ตัดตารางตาม denoise
- **ต้นเหตุ (ยืนยันจากซอร์สของ backend):** `stable-diffusion.cpp` ทำ img2img แบบ sd-webui — `src/pipeline/image.cpp` `prepare_image_generation_latents()`: `t_enc = (size_t)(plan->sample_steps * strength)` แล้วตัด sigma ตามนั้น → คำขอ 20 สเต็ปที่ denoise 0.38 รันจริง 7 สเต็ป · upstream แก้ปัญหาเดียวกันกับ hires fix ด้วยการหารกลับ (`src/pipeline/request.cpp`: `scheduler_steps = effective_steps / hires.denoising_strength`)
- `scripts/server/img2img-steps.cjs` — **กฎกลางไฟล์เดียว** (frontend import ไฟล์เดียวกับที่ server `require`): `ceil(steps/denoise)` แล้วขยับขึ้นจน `floor(sent × strength) ≥ steps`, เพดาน `MAX_IMG2IMG_SENT_STEPS = 150` + ธง `capped`, ค่าขยะ → ค่าเริ่มต้น (ไม่เป็น NaN), denoise = 1 ไม่แตะ
- `social-agency-runtime.cjs` — `_img2imgStepPlan()` + `_imageImg2ImgBody(..., stepPlan)` ส่ง `steps: plan.sent` และเก็บ `steps` / `stepsSent` / `stepsCapped` ลง `imageJob` (โหมด `reference` และเส้นทาง txt2img **ไม่สเกล**)
- `app/frontend/src/services/api.js` — `planImageSteps()` (export) ใช้กฎเดียวกัน: denoise window เดิม **0.15–0.75** ไม่ขยับ, txt2img ส่งจำนวนเดิม, `generateImage` คืน `steps` / `stepsSent` / `stepsCapped`
- `Generator.jsx` — ประมาณเวลา + ตัวนับสเต็ปตามจำนวนที่รันจริง (`activeTotalSteps` จาก progress ของ backend), บรรทัดบอกตอนสเกล/แตะเพดาน, `metadata.stepsSent`
- `social-agency/drawers.jsx` — `steps 20→53` ในหน้ารายการ + คำอธิบายใต้สไลเดอร์ (รวมต้นทุนเวลา ~1/denoise)
- `vite.config.js` — `server.fs.allow = [REPO_ROOT]` เพื่อให้ dev server เสิร์ฟไฟล์ที่ใช้ร่วมกันได้ (build ผ่านปกติ; bundle ยังกิน budget 300 KB — 292,266 bytes)
- เทสต์ใหม่ `scripts/validation/test-image-img2img-step-scaling.cjs` (16 checks, mock ทั้งหมด): กฎ (กวาด 3,000+ กรณี) · Social Agency (รวม flux 4 สเต็ป → 11) · **Generator: import `api.js` จริงแล้วเรียก `generateImage` จริง** ตรวจ body ที่ส่ง
- `validate-release.sh` — `node --check scripts/server/img2img-steps.cjs` (ไฟล์ที่ถูก require ตอนโหลด)
- **ยังไม่ได้ยืนยัน:** คุณภาพ/เวลาจริงบน Mac (ดูเช็กลิสต์ท้ายข้อ 6) · พฤติกรรมของ sampler เมื่อสเกลสเต็ปขึ้น (คาดว่าได้ตารางละเอียดขึ้นตามแบบ sd-webui)

### PR #26 (session `arena/01a0eb60…`, 2026-09-29 — รอ merge) — รูปสินค้าอ้างอิงเข้า backend จริง + เตือนใน UI + แก้เช็กบ็อกซ์
> ต่อจาก PR #25 โดยตรง: อาการคือ backend รับ `reference_images` แล้วตอบ 200 แต่**ไม่ได้ใช้รูปอ้างอิง** (กระเป๋าออกมาเป็นเดรส) — แก้ที่ต้นเหตุด้วยวิธีเดียวกับที่ Generator ใช้อยู่แล้ว
- `scripts/server/social-agency-runtime.cjs` — การสร้างภาพปฏิทินส่ง **img2img** เป็นค่าเริ่มต้น (`POST /sdapi/v1/img2img`, `init_images:[<รูปสินค้า>]`, `denoising_strength` 0.38) ให้เหมือน `app/frontend/src/services/api.js` ของ Generator
  - `settings.productRefMode` = `img2img` (เริ่มต้น) หรือ `reference` (วิธีเดิมที่ส่ง `reference_images`) · `settings.productRefDenoise` 0.15–0.75 (ค่าเริ่มต้น 0.38, `clampFloat` ไม่ปัดเป็นจำนวนเต็ม) · บันทึกผ่าน `saveConnectors`
  - ถ้า backend ไม่มี img2img (404/405/501 หรือ 400/422 ที่ error เอ่ยถึง `init_images`/`denoising_strength`) → ถอยไปใช้ `/v1/images/generations` แบบเดิม **และใส่ `imageJob.warning`** · 400 อื่นๆ ถือเป็น error จริง ไม่ retry
  - `entry.imageJob` เพิ่ม `refMode` (`img2img` | `reference` | `none` | `off`), `denoise`, คง `usedProductRef` และ `warning: "ไม่ได้ใช้รูปสินค้าอ้างอิง: …"` ไว้ให้ grep ได้เหมือนเดิม
  - `setImageBackendProvider(fn)` — อ่านพอร์ต Image API สดๆ จาก `PORT_BACKEND` ของ serve.cjs (พอร์ตขยับได้เมื่อ 8080 ไม่ว่าง หรือผู้ใช้ตั้ง `backendPort`)
- `scripts/server/serve.cjs` — ต่อ `setImageBackendProvider(() => "http://127.0.0.1:" + PORT_BACKEND)`
- Frontend: `lib.js` (`productRefNotice` + `PRODUCT_REF_MODE_LABEL`) · `drawers.jsx` (`ImageRefLine`, คำเตือนในด่านตรวจภาพ, ตัวเลือกโหมด + สไลเดอร์ denoise ใน Connectors) · `RunsTab.jsx` (เตือนในคิวอนุมัติ) · `social-agency.css`
- **สาเหตุของเช็กบ็อกซ์สี่เหลี่ยมขาว:** `.sa-shell input { width:100%; min-height:36px; background: card }` กินเช็กบ็อกซ์ด้วย → ใส่ `:not([type="checkbox"]):not([type="radio"])` ที่กฎเดิม + กฎขนาดเช็กบ็อกซ์ 15px และจัด `.sa-image-gate-confirm` เป็น grid `auto 1fr`
- เทสต์ใหม่ 2 ชุด: `test-social-agency-product-ref-img2img.cjs` (11 checks — mock fetch ทั้งหมด) · `test-social-agency-image-gate-ui.cjs` (10 checks) · `run-all` = **143 passed · 0 failed · 1 skipped**
- **ยังไม่ได้ยืนยัน:** คุณภาพ/img2img กับ backend จริงบนเครื่อง Mac (ต้อง `npx vite build` ใหม่หลัง pull) · ภาพเดรสเดิมของ WSB-019 ต้องสร้างใหม่แล้วตรวจเทียบรูปสินค้าก่อนอนุมัติ

### (session `arena/01a0eb2c…`, 2026-09-29) — ด่านตรวจภาพแยกจากการอนุมัติแคปชัน
> เขียนใหม่บน `main` ล่าสุด: แพตช์เดิมที่ทำบน Mac (ผลทดสอบ 104 checks) **ไม่เคยถูก push และกู้คืนไม่ได้** (`/Volumes/AI` สะอาด, `~/Desktop/Local AI` เป็นสำเนาเก่า) — อย่าเอาสำเนา `Local AI` มา commit/push เพราะมีการลบไฟล์ staged ค้างอยู่
- `scripts/server/social-agency-runtime.cjs` — ภาพที่แนบกับรายการต้องมีการ "ตรวจภาพ" โดยคนก่อนส่งจริงไป Facebook / Instagram / LINE OA broadcast (TikTok/demo ไม่เกี่ยว)
  - การอนุมัติผูกกับ fingerprint = sha256(ไบต์ไฟล์ภาพ + Public URL) + SKU · ไฟล์/URL/สินค้าเปลี่ยน → บล็อกอีกครั้ง · กำลังสร้างภาพทดแทน (`imageJob.running`) → บล็อก · สร้างภาพเสร็จใหม่ → ล้างผลตรวจ
  - `POST /api/social-agency/entry-image/review` `{entryId, confirmed:true}` (หรือ `approve:false` เพื่อยกเลิก) — **ไม่เริ่ม workflow ไม่เผยแพร่ ไม่แตะ status**
  - บังคับ 2 ชั้น: `_executeWorkflow` (8b — ส่งเข้า `needs_review` พร้อมเหตุผล ไม่ใช่ failed แม้กดอนุมัติแบบ force) และ `_publishEntry` (`_assertImageReviewed` ก่อนยิง API จริง) · dry-run ไม่โดนบล็อก
  - `_publishLiveState()` แยกตรรกะ "จะส่งจริงไหม" ให้ `_publishEntry` กับ workflow ใช้ตัวเดียวกัน
  - `entry.imageGate` เป็นฟิลด์ตอบกลับเท่านั้น (`getState`/`listCalendar`) ไม่ถูกเก็บลงไฟล์
  - พาธรูปสินค้า: `_resolveProductImageFile` ยอมเฉพาะ `app/outputs/sa-products/<clientId>/<sku>.<png|jpg|jpeg|webp|gif>` (กัน `..`, ลูกค้า/SKU อื่น, symlink) · `_applyProductImage` ปฏิเสธพาธ `/sa-products/` ที่ไม่ตรง · ถ้ารูปอ้างอิงถูกปฏิเสธ การสร้างภาพเดินต่อโดยไม่มี ref และใส่ `imageJob.warning`
- Frontend: `drawers.jsx` (`ImageReviewGate` — ติ๊กยืนยัน + ปุ่ม "ตรวจภาพแล้ว"), `RunsTab.jsx` (แจ้งเตือนในคิวอนุมัติ), `SocialAgency.jsx`, `social-agency.css`
- เทสต์: `scripts/validation/test-social-agency-image-review-gate.cjs` (19 checks, mock ทั้งหมด) · Social Agency smoke ยัง 104 checks · `run-all` 140 passed (ที่ล้ม 1 = `validate-release.sh` ต้องมี `imageio_ffmpeg` ซึ่งเครื่อง sandbox ไม่มี — CI ติดตั้งให้)
- **ยังไม่ได้ทำ/ยังไม่ยืนยัน:** คุณภาพภาพจาก backend จริงบน Mac · การส่งไปบัญชี Facebook/IG/LINE จริง · ภาพเดรสเดิมของ WSB-019 **อย่าอนุมัติ** — สร้างใหม่แล้วตรวจเทียบรูปสินค้าจริงก่อน

### PR #21 (2026-09-27) — ปิดงานค้างหัวข้อ 6 (baseline ว่าง · 140 passed / 0 failed)
- `app/frontend/src/lib/safe-link.mjs` — รับ `data:image/<raster>;base64,…` เฉพาะภาพที่แอปสร้างเอง (SVG และ `data:text/html` ยังถูกปฏิเสธ) · คุม `href` 2 จุดที่หลุด guard ใน `WorkflowBuilder.jsx` และ `ProductsTab.jsx`
- `scripts/server/work-github.cjs` — โวลุ่มที่เก็บ permission ไม่ได้ คืน `warning` ให้ผู้ใช้เห็น แทนที่จะกลืนความล้มเหลวของ `chmod` ใน `catch {}`
- `scripts/cloud-doctor.cjs` — ถามโวลุ่มก่อนว่าเก็บ file permission ได้ไหม แทนที่จะกล่าวหาไฟล์ที่ผู้ใช้แก้ไม่ได้
- `sync.sh` — `sed -z` เป็นส่วนเสริมของ GNU ที่ BSD sed (macOS) ไม่มี ทำให้ลูป "เอาของผู้ใช้คืน" ไม่เคยรัน และ `releases/` ถูกลบโดยที่สคริปต์ยังรายงานว่าสำเร็จ
- `scripts/validation/validate-release.sh` — `find` เดินขึ้นราก volume ไปโดน `.Trashes`/`.Spotlight-V100` บน macOS (คู่กับ `set -e` ทำให้ contract จบทันที) · แยก portable runtime ของเครื่องทำงานออกจากของที่แพ็ก
- `scripts/validation/check-api-contracts.cjs` — กลุ่ม optional ใน route regex ไม่ถูกแยกออก จึงไม่ match ทั้งรูปไม่มีส่วนและรูปมีส่วน
- `.github/workflows/validation.yml` — ติดตั้ง `imageio-ffmpeg` ซึ่ง release contract ต้องใช้
- เทสต์ 11 ชุดที่วัด **สภาพเครื่อง** แทน **ตัวโค้ด** แก้ที่ต้นเหตุทั้งหมด
- `scripts/validation/test-sync-script.cjs` + `test-releases-untracked.cjs` — ทั้งคู่อ่านชื่อ branch ของ checkout ที่ตัวเองกำลังรันอยู่ ไปสั่ง `git clone --branch` ของ fixture · ตอนนี้ให้ fixture ตั้งชื่อ branch เอง
- `scripts/validation/ci-baseline.json` — **ว่างแล้ว 0 รายการ**
- ผลวัด: เครื่องจริง (macOS) **140 passed · 0 failed · 1 skipped** · sandbox (Linux) **140 passed · 0 failed · 1 skipped** → `exit 0` ทั้งคู่

### PR #20 (2026-09-27) — CI + ตัวรันชุดเทสต์ (merged เป็น `b3fb3f8`)
- `.github/workflows/validation.yml` — รัน `scripts/validation/` ทุก PR ทุก push เข้า `main` และกดรันเองได้ (ubuntu-latest, Node 22, build frontend ก่อน)
- `run-all.cjs` + `ci-baseline.json` — รันทั้งชุด สรุปผล เขียนรายงาน · รายการที่ล้มอยู่แล้วถูกบันทึกเป็น XFAIL พร้อมเหตุผล (บางรายการ scope เฉพาะ `darwin` = ล้มได้บน macOS เท่านั้น ที่อื่นต้องผ่าน)
- แก้ `serve.cjs` — ที่ยังไม่ได้ดาวน์โหลดโมเดล speech/TTS ตอบ **503** แทน 500 (CI รอบแรกเจอ แก้ใน PR นี้เลย)
- ผลวัด: Linux CI **133 passed · 0 failed · 7 known-failing · 1 skipped** · เครื่องจริง (macOS) **129 passed · 0 failed · 10 known-failing · 1 xpassed · 1 skipped** → `exit 0` ทั้งคู่

### PR #12 (2026-09-27) — เก็บกวาด repo
- ลบไฟล์สำรองจากการ patch ที่หลุดเข้า git 13 ไฟล์ (~1.3 MB) + เพิ่ม `.gitignore` กันซ้ำ (ดูข้อ 6.1)
- ลบ branch เก่าบน GitHub ทั้งหมด เหลือแค่ `main` (ดูข้อ 4)
- อัปเดตไฟล์นี้ทุกหัวข้อ (ดูข้อ 6.3)
- ไม่มีการเปลี่ยนโค้ด product — `node --check` ผ่าน, smoke test ผ่าน 99 checks

### PR #11 (2026-09-26) — เอกสาร
- เพิ่มไฟล์นี้ (`ARENA_HANDOFF.md`) เข้า `main` — session ถัดไปอ่านไฟล์นี้ก่อนเริ่มงาน

### PR #10 (2026-09-26) — ฟีเจอร์

1. **Luke AI Workflow builder** (workspace ใหม่) — ต่อ AI หลายขั้นเป็นสายงานเดียว
   Chat (LLM) → สร้างภาพ → TTS → STT → จัดข้อความ → เงื่อนไข → ผลลัพธ์, ตัวแปร `{{input}}` / `{{ชื่อโหนด}}`
   Backend: `scripts/server/ai-workflow-runtime.cjs` (`/api/ai-workflow/*`)
2. **รูปสินค้าจากเว็บตาม SKU → ใช้เป็น Reference ตอนสร้างภาพปฏิทิน**
   - ปุ่ม "ดึงรูปสินค้าจากเว็บ" (ทั้งชุด/รายตัว) ดึง og:image / JSON-LD / รูปใหญ่สุด แล้วเก็บในเครื่อง
   - ปุ่ม "🎲 สุ่ม 1 สินค้า/วัน" ดึงรูปมาพร้อมสินค้าอัตโนมัติ
   - รูปสินค้าถูกแนบเป็น Reference (Appearance Lock) ตอนสร้างภาพโพสต์ — เปิด/ปิดได้ใน Settings ของลูกค้า
   - รูป demo 10 รูปฝังใน `app/config/social-agency-seeds/`
3. **Social Agency › Workflow tab** — โหนด "คะแนนไวรัล", ปุ่มรันเลย/อนุมัติ/ยกเลิก, ตัวกรองประวัติ, progress bar, export รายงาน

PR ก่อนหน้า (merge แล้วทั้งหมด): #4 Social Agency v2.3 · #5 release beta.16 · #6 validation 87/87 · #7 fix live publish · #8 Thai prompt auto-translate · #9 English-native imagePrompt · #2,#3 (Social Agency v2.2 + repo audit)

---

## 3. ⚠️ หลัง `git pull main` บนเครื่องจริง ต้อง build frontend ใหม่เสมอ

`app/dist/` **ไม่อยู่ใน git** — ถ้าไม่ build จะเห็น UI เวอร์ชันเก่า

```bash
git checkout main && git pull
cd app/frontend && npm install && npx vite build
# แล้วรัน server ตามปกติ: mac.sh / linux.sh / windows.bat
```

---

## 4. สถานะ branch อื่นบน GitHub (ตรวจและลบแล้ว 2026-09-27)

**หลัง session 2026-09-27 เหลือแค่ `main`** — branch เก่าทั้งหมดถูกลบไปแล้ว (เหลือแค่ branch ของ session ที่กำลังทำงานซึ่งจะ merge แล้วลบท้าย session) ตารางด้านล่างเก็บไว้เป็นบันทึกว่าลบอะไรไปบ้าง

| branch | สถานะก่อนลบ | ผลการตรวจ |
|---|---|---|
| `arena/01a03c94…`, `01a065e2…`, `01a08988…`, `01a08f7a…`, `01a09e4b…`, `01a0de84…`, `01a0df14…` | merge เข้า `main` ครบแล้ว | ยืนยันด้วย GitHub compare API: `ahead_by = 0` ทุก branch → ลบได้เลย ✅ ลบแล้ว |
| `backup/volumes-ai-20260914` | WIP จากเครื่อง local 14 ก.ย. (งาน image-to-video สำหรับโพสต์ Social Agency: `videoJob`, `setImageToVideoJobs`, progress bar) | ตรวจซ้ำแล้ว: commit เดียวที่ไม่ซ้ำกับ `main` (`3328d4f7`) มี 54 ไฟล์ แต่เป็น `app/dist/` + runtime state ที่ gitignore แล้วเกือบทั้งหมด เหลือโค้ดจริง 9 ไฟล์ — ไล่เทียบบรรทัดที่เพิ่มกับ `main` ทีละบรรทัดแล้ว **พบครบ ยกเว้น 6 บรรทัด ซึ่ง `main` พัฒนาต่อแล้ว** (`_imageGenBody(prompt, ref)` รองรับรูปสินค้าอ้างอิง, `reference_images`/`reference_settings`/`negative_prompt` เป็นแบบมี ref, `EntryDrawer` มี props เพิ่ม, `entryPatch` เพิ่ม `captionSource`/`hook`) → **ห้าม merge** แต่ลบได้ ✅ ลบแล้ว |

> ข้อมูลเดียวที่หายไปกับ branch นั้น: ค่า settings ของโมเดล `typhoon-1.5-8b-Q4_K_M.gguf` (Metal, threads 9, ctx 16384) ใน `app/config/llm-model-settings.json` ซึ่งเป็นค่าที่ตั้งบนเครื่อง local เอง — ถ้าเคยใช้โมเดลนี้ให้ตั้งค่าใหม่ในแอปได้

---

## 5. แผนที่โค้ดสำคัญ

| ส่วน | ตำแหน่ง |
|---|---|
| Frontend (Vite + React) | `app/frontend/src/` — Social Agency: `components/SocialAgency.jsx` + `social-agency/` |
| Server entry | `scripts/server/serve.cjs` |
| Social Agency runtime | `scripts/server/social-agency-runtime.cjs` (+ `social-agency-groups-smoke.cjs` สำหรับ smoke test) |
| AI Workflow runtime | `scripts/server/ai-workflow-runtime.cjs` |
| Image-to-video | `scripts/server/image-to-video-*.cjs` |
| Config / seed | `app/config/` |
| รายงาน validation / release | `validation-reports/`, `RELEASE-AUDIT.md`, `AI-LIBRARY-CHANGELOG.md` |

---

## 6. งานค้าง / สิ่งที่ควรทำต่อ

_(งานเก็บกวาด repo ข้อ 6.1–6.3 เสร็จแล้ว · ต่อมาเพิ่ม CI + ตัวรันชุดเทสต์ใน session เดียวกัน)_

**เสร็จแล้ว (session `arena/01a0e089…`, 2026-09-27):**
- [x] **6.1 ลบไฟล์สำรองจากการ patch ที่หลุดเข้า git** — ลบ 13 ไฟล์ (`*.p5w-orig` 6, `*.p5w2-orig` 2, `*.p5y-orig` 1, `*.p5z-orig` 1, `*.p5x-orig` 1) ใน `app/frontend/src/…` และ `scripts/server/…` รวมถึง `p5w-audit.txt`, `p5w-dump.txt` ที่ root
  - เพิ่มกฎกันซ้ำใน `.gitignore`: `*.p5*-orig`, `p5w-*.txt` (ของเดิมมีแค่ `*.orig` ซึ่งจับไฟล์พวกนี้ไม่ได้)
  - ตรวจแล้วว่าไม่มีไฟล์ไหน import ไฟล์เหล่านี้ · `node --check` ผ่าน · smoke test ผ่าน 99 checks
- [x] **6.2 ลบ branch เก่า** — ลบ arena branch ที่ merge แล้ว 7 ตัว + `backup/volumes-ai-20260914` (ตรวจโค้ดซ้ำก่อนลบ ดูตารางข้อ 4) เหลือแค่ `main`
- [x] **6.3 อัปเดตไฟล์นี้** — แก้ข้อ 1 (main), ข้อ 2 (เพิ่ม PR #11/#12), ข้อ 4 (บันทึกการลบ branch), ข้อ 6 (ติ๊กรายการ) — merge เข้า `main` แล้ว (PR #12)

**เสร็จแล้วเพิ่ม (session `arena/01a0e089…`, ต่อจากข้อ 6.3):**
- [x] **ตั้ง CI ให้รัน `scripts/validation/` ทุก PR** — `.github/workflows/validation.yml` + ตัวรัน `run-all.cjs` (ดูหัวข้อ 2)
- [x] **แยก known-failing ตามแพลตฟอร์ม** — `ci-baseline.json` รับได้แบบ `{reason, platforms}` · รายการที่ scope เป็น `darwin` ถูกเมินบนแพลตฟอร์มอื่น **และต้องผ่านจริง** ไม่ใช่ถูกบดบัง (มี 4 รายการ — เหตุผลอยู่ในไฟล์นั้น)
- [x] **ให้บรรทัดสรุปนับ xpassed ด้วย** — ก่อนหน้านี้ยอดรวมไม่ตรงกับผลจริงเพราะไม่นับชุดที่ผ่านทั้งที่ถูกบันทึกว่าล้ม
- [x] **แก้บั๊ก 503 ที่ CI เจอ** — `POST /api/speech/start` ตอบ 500 เมื่อยังไม่ได้ดาวน์โหลดโมเดล เพราะ `resolveSpeechModel()` โยน `Error` ที่ไม่มี `statusCode` (CI ติดตั้ง whisper.cpp ได้จึงเดินถึงจุดนั้น) · เปลี่ยนเป็น `serviceUnavailable()` → 503 แก้จุดเดียวกันใน `resolveTtsModel()` ด้วย

**ปิดครบแล้ว (PR #21, 2026-09-27) — `ci-baseline.json` ว่างแล้ว 0 รายการ**

ทั้ง 11 รายการแก้ที่ต้นเหตุแล้ว **ลบรายการออกจาก baseline ทั้งหมด** · ผลวัด 140 passed · 0 failed · 1 skipped ทั้ง macOS และ Linux

| ชุด / ไฟล์ | ประเภท | ต้นเหตุที่แก้ |
|---|---|---|
| `test-frontend-link-safety.cjs` | โค้ด | `safe-link.mjs` ปฏิเสธ `data:` ทั้งหมด แต่ workflow builder ส่ง `data:image/png;base64,…` มาเป็นลิงก์ — เพิ่ม raster base64 เท่านั้น และให้ทั้ง 2 จุดเรนเดอร์ลิงก์เมื่อ guard อนุมัติ |
| `validate-release.sh` | โค้ด | `check-api-contracts.cjs` อ่าน route แบบ regex ได้อยู่แล้ว แต่กลุ่ม optional ไม่ถูกแยก จึงไม่ match ทั้งสองรูป |
| `test-config-write-fixed-point.cjs` | โค้ด | เทสต์ยืม install record จาก `app/runtimes/` ของเครื่อง (ไม่มีใน clone สะอาด) และ copy `app/config` จาก working tree ซึ่งเป็นไฟล์ที่แอปเขียนทับ — เปลี่ยนเป็นเขียน record เอง และอ่าน config จาก git |
| `test-route-declarations.cjs` | เทสต์ | ~~cache-control helper~~ **คำอธิบายเดิมผิด** — ตัวจริงคือ `/sa-products/` static route จริงที่รายชื่อ namespace ในเทสต์แคบเกิน |
| `test-sync-script.cjs` | เทสต์ | scenario ผูกกับ branch ที่ checkout อยู่ — ให้ชุดเทสต์สร้างข้อตั้งต้นของตัวเอง ผลเหมือนกันทุกเครื่อง |
| `test-mac-launch-files-tracked.cjs` | สภาพแวดล้อม | `app/dist/` ถูก gitignore ไปแล้ว สมมติฐานว่ามันต้องมากับ git ล้าสมัย — เปลี่ยนเป็นเช็คว่า dist ที่มีอยู่ครบทุก bundle ที่ `index.html` อ้าง |
| `test-releases-untracked.cjs` | สภาพแวดล้อม | เช็คว่ามีโฟลเดอร์ `releases/` บนดิสก์ ซึ่ง clone สะอาดไม่มี — เปลี่ยนเป็นรายงาน ส่วนที่พิสูจน์ว่าอัปเดตไม่ลบของผู้ใช้คือการรัน `sync.sh` จริงถัดไป |
| `test-llm-performance.cjs` | สภาพแวดล้อม | fixture อยู่ใน `os.tmpdir()` แต่ cache root อยู่บน `/Volumes/AI` → คำถาม "ดิสก์เดียวกัน" กลายเป็น "คนละดิสก์" — สร้างทั้งสองกรณีขึ้นมาเอง |
| `test-api-route-methods.cjs` | สภาพแวดล้อม | teardown `rmSync` โดน ENOTEMPTY บน macOS เพราะ server ยังเขียนทับขณะลบ — retry และไม่ throw ใน `finally` (eslint จับ `no-unsafe-finally`) |
| `test-work-github.cjs` | สภาพแวดล้อม | ตรวจว่าไฟล์ token เป็น 0600 ซึ่งโวลุ่ม external เก็บ permission ไม่ได้ — ตอนนี้เช็คว่าโค้ด **บอก** แทนที่จะเงียบ คู่กับการแก้ `work-github.cjs` ให้คืน `warning` |
| `test-cloud-doctor.cjs` | สภาพแวดล้อม | "healthy chain" ออก 1 โดยไม่บอกสาเหตุ — ใส่ stdout/stderr ในข้อความ และเพิ่มเคสโวลุ่มที่เก็บ permission ไม่ได้ (พิสูจน์ด้วยโฟลเดอร์ที่เขียนไม่ได้จริง) |

**บั๊ก macOS ที่เจอระหว่างทาง — ไม่ได้อยู่ในรายการเดิม (แก้แล้วในรอบนี้):**
- **`sync.sh` ใช้ `sed -z`** ซึ่งเป็นส่วนเสริมของ GNU · BSD sed บน macOS ไม่มี → ลูป "เอาของผู้ใช้คืน" ไม่เคยรัน และ `releases/` ของผู้ใช้ถูกลบตอน sync โดยที่สคริปต์ยังออก 0 และรายงานว่าสำเร็จ · **กู้คืนแล้ว** ด้วย `git archive 761082b^ releases | tar -x -C .` (ไม่แตะ index เพราะ `releases/` ถูก gitignore)
- **`validate-release.sh` เดิน `find "$ROOT"`** ขึ้นถึงรากของ volume ซึ่งบน macOS มี `.Spotlight-V100` / `.TemporaryItems` / `.Trashes` ตอบ `Operation not permitted` · คู่กับ `set -e` ทำให้ release contract จบในวินาทีแรก

**ระบบที่สามที่จับได้ — CI (Linux บน GitHub):**
- `actions/checkout` เช็คเอาต์แบบ **detached HEAD** เสมอ จึงไม่มี branch ให้อ่าน · `test-releases-untracked.cjs` เอา `"HEAD"` ไปสั่ง `git clone --branch` → `fatal: Remote branch HEAD not found in upstream origin` · `test-sync-script.cjs` assert ว่า branch ต้องไม่เป็น `HEAD` → ล้มที่ assert นั้น · ทั้งสองชุดตอนนี้ตั้งชื่อ branch ให้ fixture เอง แล้ว `git checkout -B` สร้างมันหลัง clone
- ยืนยันด้วยการจำลองสภาพจริง: clone สะอาด + `git checkout --detach` แล้วรันสองชุด → ผ่านทั้งคู่ ส่วนก่อนแก้ล้มด้วยข้อความเดียวกับใน log CI

**ค้างของ session `arena/01a0eb60…` (2026-09-29) — ทำบนเครื่อง Mac เท่านั้น:**
- [ ] **ยืนยัน img2img กับ backend จริง** — `git pull` → `cd app/frontend && npm install && npx vite build` → สร้างภาพปฏิทิน 1 ใบ แล้วตรวจว่า `imageJob.refMode` เป็น `img2img`, `imageJob.steps` = สเต็ปที่ตั้งไว้ และ `imageJob.stepsSent` ≈ steps/denoise (ค่าเริ่มต้น 20 @ 0.38 → 53) · ภาพออกมาตรงกับรูปสินค้าจริง · **เวลาต้องนานขึ้น ~2.6 เท่า** ถ้าไม่นานขึ้นเลยให้สงสัยว่า backend ไม่ได้ใช้ `steps` ที่ส่งไป (ถ้า backend รุ่นนั้นไม่มี `/sdapi/v1/img2img` จะเห็นคำเตือน "ไม่ได้ใช้รูปสินค้าอ้างอิง: backend ไม่รองรับ img2img" ในหน้ารายการ/คิวอนุมัติ ซึ่งแปลว่าต้องอัปเดต backend)
- [ ] **ภาพเดรสของ WSB-019** ที่สร้างตอน backend ไม่ใช้รูปอ้างอิง — กด "สร้างภาพใหม่" แล้วตรวจเทียบรูปสินค้าจริงก่อนอนุมัติ อย่าอนุมัติภาพเดิม
- [ ] **ตรวจไฟล์สถานะด้วย grep** (ใช้ได้ทั้งก่อน/หลังสร้างภาพใหม่):
  `grep -o '"refMode": "[a-z]*"\|"usedProductRef": [a-z]*\|"denoise": [0-9.]*\|"steps": [0-9]*\|"stepsSent": [0-9]*\|"stepsCapped": true\|"warning": "[^"]*"' /Volumes/AI/app/runtime-state/social-agency/thai-modern-bags.json | tail`
  ก่อนสร้างใหม่รายการเก่าจะไม่มี `refMode` (ดูในแอปจะขึ้นเตือนให้ตรวจภาพเทียบสินค้าเอง) · หลังสร้างใหม่ต้องเป็น `"refMode": "img2img"` + `"usedProductRef": true` และไม่มี `warning` เมื่อรูปสินค้าอยู่ครบ

**สิ่งที่ควรรู้ก่อนรอบหน้า:**
- `ci-baseline.json` ว่าง → **ชุดที่ล้มอีกครั้งคือของใหม่จริง** · อย่าใส่รายการกลับเพื่อให้ CI เขียว ให้แก้ที่ต้นเหตุ
- หลายชุดเคยวัด **สภาพเครื่อง** แทน **ตัวโค้ด** (tmpdir กับ app อยู่คนละดิสก์ · working tree ที่แอปเขียนทับ · โฟลเดอร์ที่ setup ติดตั้งเอง · โฟลเดอร์ที่ gitignore) — เวลาเทสต์ล้มบนเครื่องหนึ่งแต่ผ่านอีกเครื่อง ให้ถามก่อนว่า "ข้อเท็จจริงที่ยืนยันคือเรื่องไหน" ไม่ใช่ "เครื่องนี้ต่างยังไง"
- `validate-release.sh` ต้อง Python ที่ `import imageio_ffmpeg` ได้ · CI ติดตั้งให้แล้วใน workflow (เครื่องนี้ติดตั้งด้วย `python3 -m pip install --break-system-packages imageio_ffmpeg`)
- **รอยตำหนิที่รู้อยู่และยังไม่แก้:** สไลเดอร์ Denoise Guidance ใน `ReferenceManager.jsx` เปิดถึง 0.85 แต่ `api.js` clamp ที่ 0.75 (และ Social Agency ที่ 0.75) — ค่าที่ส่งจริงคือ 0.75 เสมอ; ถ้าจะแก้ให้แก้ที่สไลเดอร์ ไม่ใช่ที่ clamp
- `mac.sh:55` ยังอ่าน `git ls-files app/dist` ซึ่งว่างเปล่ามาตั้งแต่ `app/dist/` ถูก gitignore · ยังไม่ได้แก้ เพราะเป็นโค้ดตัวเรียกแอป — เป็นงานค้างที่จงใจทิ้งไว้
- เทสต์ที่สร้าง fixture ด้วย `git clone` **ห้ามอ่านสถานะของ checkout ที่ตัวเองรันอยู่** (branch, remote, working tree) — สามระบบนี้มีสภาพต่างกันจริง: เครื่อง local อยู่บน branch · sandbox อยู่บน branch · CI เป็น detached HEAD · เทสต์ที่ผ่านสองในสามเครื่อง แปลว่ายังไม่ได้พิสูจน์บนเครื่องที่สาม

---

## 7. บันทึกการสืบหา commit `5be0bd0` / `1d7d26c` (session `arena/01a0f037…`, 2026-09-30)

**คำขอ:** ตรวจว่า commit `5be0bd0` และ `1d7d26c` ยังอยู่ไหม แล้ว push `1d7d26c` ไปที่ `origin/arena/01a0eb60-luke-ai-studio-enterprise` โดยไม่ใช้ force push

**ผลสรุป: ไม่พบทั้งสอง commit ที่ไหนเลย → ไม่มีอะไรให้ push** (ไม่มี object = push ไม่ได้ ไม่ใช่เรื่อง force/ไม่ force)

| ที่ที่ตรวจ | วิธีตรวจ | `5be0bd0` | `1d7d26c` |
|---|---|---|---|
| sandbox (clone ของ Arena) | `git cat-file -t` · `git fsck --lost-found` · `git reflog --all` | ❌ | ❌ |
| sandbox หลัง `git fetch --unshallow` (ประวัติเต็ม 209 commits) | `git rev-list --all --objects` · สแกนทุก commit object ด้วย `git cat-file --batch-all-objects` | ❌ | ❌ |
| branch อื่นทั้งหมดบน GitHub (36 refs) | `git ls-remote origin` · `git fetch origin <sha>` | ❌ | ❌ |
| GitHub API 2 endpoint | `/commits/<sha>` → HTTP 422 · `/git/commits/<sha>` → HTTP 404 | ❌ | ❌ |
| เครื่อง Mac `/Volumes/AI` | `git cat-file -t` · `git log` · `git merge-base` | ❌ `Not a valid object name` | ❌ `Not a valid object name` |

**สิ่งที่พบเพิ่มบนเครื่อง Mac (จาก output ที่ผู้ใช้รันเอง 2026-09-30):**
- อยู่บน branch **`cutout-tmp`** ที่ track `origin/main` — `git status -sb` ขึ้น `## cutout-tmp...origin/main` **ไม่มี `[ahead N]`** แปลว่าซิงก์กับ `origin/main` อยู่ → **ไม่มี commit ค้างให้ push บนเครื่องนั้น**
- `luke-image-gate.patch` (untracked, 29 Sep 10:28) — **ไฟล์ว่าง 0 ไบต์** จึงไม่มีแพตช์อยู่ในนั้น ไม่ใช่ที่กู้ของด่านตรวจภาพ

**ข้อสรุปเชิงสาเหตุ:** commit สองตัวนี้น่าจะถูกสร้างใน sandbox ของ session ก่อน (คนละเครื่องกับ Mac) แล้วไม่เคยถูก push — พอ sandbox ถูกล้าง object จึงหายถาวร ตรงกับรูปแบบที่หัวข้อ 2 เตือนไว้แล้ว (`แพตช์เดิมที่ทำบน Mac … ไม่เคยถูก push และกู้คืนไม่ได้`) · **ตัวเนื้องานไม่หาย** เพราะงานชุดเดียวกัน (img2img + คำเตือน + เช็กบ็อกซ์) ขึ้น `main` แล้วเป็น `5d64236` + `f83ee8d` → merge `24c2a64` และไฟล์จริงอยู่ใน `main` ครบ (`scripts/server/social-agency-runtime.cjs`, เทสต์ 2 ชุด)

**ปิดเคส (สแกนครบทุกสำเนาบนเครื่อง Mac, 2026-09-30):** ไล่หา `.git` ทั้งหมดใต้ `/Users/ekky` และ `/Volumes` (maxdepth 7) ได้ **16 repo** แล้วสั่ง `git -C <repo> cat-file -e 5be0bd0` / `1d7d26c` ทุกตัว → **ไม่พบทั้งสอง sha ที่ไหนเลยแม้แต่ที่เดียว** · `/Volumes/AI` เอง: `git log --branches --not --remotes` **ว่าง** (ไม่มี commit ค้างให้ push) และ `git log origin/main..HEAD` **ว่าง** (branch `cutout-tmp` ตรงกับ `origin/main`) ⇒ **ไม่มีสำเนาที่กู้ได้ และไม่มีอะไรต้อง push — เคสนี้ปิด** · กู้ได้เฉพาะ "เนื้องาน" ที่อยู่ใน `main` แล้วเท่านั้น

**บทเรียนสำหรับรอบหน้า:** งานที่ทำใน sandbox ต้อง **commit + push + merge เข้า `main` ทันทีใน session เดียวกัน** · ห้ามอ้างอิง sha จาก session ก่อนแบบลอยๆ ในบทสนทนา — ให้อ้าง sha ที่อยู่ใน `main` แล้วเท่านั้น (บทสนทนาเก่าไม่ตามมา, sandbox เก่าถูกล้าง) · SHA ที่ไม่เคย push จะกู้จาก GitHub ไม่ได้แม้จะรู้ sha ก็ตาม

**กับดักของ zsh บนเครื่อง Mac (เจอซ้ำ 2 ครั้งใน session นี้):** คำสั่งที่ยกมาให้คัดลอกมักมีคำอธิบายภาษาไทยต่อท้ายด้วย `#` — zsh แบบ interactive ที่ **ไม่ได้เปิด** `interactivecomments` จะถือ `#` เป็นตัวอักษรธรรมดา แล้วส่งข้อความที่ตามหลังเป็น argument ของคำสั่ง (อาการ: `rm: #: No such file or directory`, `fatal: couldn't find remote ref #`, `git cat-file: too many arguments`) → แก้ถาวรครั้งเดียวด้วย `echo 'setopt interactivecomments' >> ~/.zshrc` แล้ว**เปิด terminal ใหม่** (ค่า `setopt` สั่งในหน้าต่างเดิมไม่ติดไปหน้าต่างใหม่ — คนละ shell)
