# ARENA_HANDOFF.md — บันทึกส่งต่องานระหว่าง session

> **อัปเดตล่าสุด:** 2026-10-06 (session `arena/ccbe7be3…` — **โมเดลภาพเข้า model cache + โหลดจากสำเนาบนดิสก์ภายในเมื่อมีสำเนาอยู่จริง** — งานชุดนี้ session ก่อนทำไว้แต่ **ไม่เคยถูก push → หายไปกับ sandbox อีกครั้ง (เคสที่ 4)** จึงถูก**เขียนใหม่ทั้งชุดจากโค้ดจริงใน `main`** ไม่ใช่จากข้อความส่งต่อ · cache รองรับ **โฟลเดอร์** (Core ML bundle หลายหมื่นไฟล์) · แก้ **บั๊กที่ทำให้ cache ไม่เคยถูกใช้เลย**: loader มองหาในโฟลเดอร์คนละที่กับที่ปุ่ม "Copy" เขียนไว้ ทั้งโมเดลภาพและโมเดลข้อความ · `/api/model-cache/status` ตอบ `POST` ตามที่ panel เรียกจริง (เดิม GET อย่างเดียว → panel อ่าน 404 แล้วไม่แสดงอะไรเลย) และลิสต์โมเดลภาพด้วย · `coreml_server.py` อ่าน reference config จากสำเนาในเครื่องก่อนเน็ต (`app/runtime-state/huggingface-cache`, ตั้งค่าใหม่ด้วย `LUKE_IMAGE_MODEL_CACHE`) · เทสต์ใหม่ `test-image-model-cache.cjs` 72 checks + probe Python · **วิธีนำขึ้น Mac ดูหัวข้อ 7.6** · งานนี้ยังไม่ merge — เปิด PR ค้างไว้ ดูหัวข้อ 1)
> **อัปเดตล่าสุด:** 2026-10-02 (session `arena/01a0fb7f…` — **แก้ image prompt ไม่ตรงสินค้า**: `buildTemplateImagePrompt`/`buildTemplateAnimatePrompt` ดึงคำอังกฤษจาก `product.name` และ `product.detail` เพิ่มเติมจาก `product.category` เมื่อ category เป็นภาษาไทย ไม่ต้อง fallback เป็น "product" อีก · smoke 104 + ชุด Social Agency 70 = 174 passed · PR #32)
> **อัปเดตล่าสุด:** 2026-10-01 (session `arena/01a0f582…` — **งานชุด "ป้าย + ปุ่มปฏิเสธรูป + รูปสินค้าจริงแนบโพสต์ Facebook" สร้างใหม่ทั้งชุด** เพราะงานชุดเดียวกันจาก session ก่อนหน้า**ไม่เคยถูก push ขึ้น GitHub และหายไปกับ sandbox** (ซ้ำรูปแบบเคส `5be0bd0`/`1d7d26c` — รายละเอียดการตรวจอยู่ท้ายหัวข้อ 7) · **ป้ายรายการ** (`entry.tags` ≤8 ป้าย × ≤24 ตัวอักษร ผ่าน PATCH calendar + ชิปบนการ์ดปฏิทิน + กรอง/ค้นหาตามป้าย) · **ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้"** ในด่านตรวจภาพ: ล็อก fingerprint รูปที่ปฏิเสธ + ล้างผลตรวจ + สร้างภาพใหม่อัตโนมัติ · ภาพใหม่ที่ไบต์เดิมถูกบล็อกซ้ำเอง · **โพสต์ Facebook 2 รูป**: ภาพ AI รูปแรก + รูปสินค้าจริงรูปที่สองแบบไม่แก้ไขอะไรนอกจากย่อด้านยาว 500px (canvas ในเบราว์เซอร์ แคช `<sku>.ref500.jpg` เซิร์ฟเวอร์ไม่เพิ่ม dependency) ส่งแบบ unpublished photos + `feed`+`attached_media` · **ขนาดภาพปฏิทินตั้งได้รายลูกค้า** (default 1024×600 แบนเนอร์) · เทสต์ใหม่ 3 ชุด 30 checks · run-all **147 passed · 0 failed · 0 known-failing · 1 skipped**) 
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
| `main` | ดู sha ล่าสุดด้วย `git log -1 --oneline main` — ณ 2026-10-06 คือ `446d113` (merge ของ PR #33) · **PR #34 รออนุมัติ** (โมเดลภาพเข้า model cache — หัวข้อ 2) |
| เวอร์ชัน | `1.0.0-beta.16` (`app/version.json`, tag `v1.0.0-beta.16`) |
| PR ที่เปิดค้าง | **PR #34** — `feat(model-cache): cache image models + actually load the internal-disk copy` · branch `arena/ccbe7be3…` ที่ `5748573` (push แล้ว 2026-10-06) · CI `validation suites` รันอยู่ · **ถ้า PR นี้ merge แล้วให้ลบแถวนี้** · local: run-all **148 passed / 1 failed / 1 skipped** — ตัวที่ fail คือ `validate-release.sh` ต้องการ `imageio_ffmpeg` (CI ติดตั้งให้, ดูหัวข้อ 6) |
| branch บน GitHub (ตรวจด้วย `git ls-remote` 2026-10-06) | ⚠️ **พบงานชุดใหม่ที่ยังไม่ merge:** `arena/01a10a92…` = `a65ccfa` (7 commits, 2026-10-05→06 — GPU/VRAM telemetry + resource governor + ชิป RAM บน status bar, 2,737 insertions, เทสต์ 4 ชุดใหม่) **push แล้วแต่ไม่มี PR** — handoff ของ branch นั้นเขียนไว้เองว่า "push branch แล้ว ยังไม่ merge" ทั้ง 6 รอบ · merge เข้า `main` สะอาดยกเว้น `ARENA_HANDOFF.md` ที่ชนกันแบบแก้ง่าย (`serve.cjs` auto-merge ได้) → **ต้องตัดสินใจก่อนว่าเอาอะไรก่อน หลัง เพราะ PR #34 ก็แก้ `serve.cjs` เช่นกัน** · branch อื่นที่ค้างอยู่ (ตามเอกสารรอบก่อน): `arena/01a0e089…` `2584762` · `arena/01a0e633…` `3095163` · `arena/01a0eb2c…` `6080dd5` · `arena/01a0eb60…`/`01a0ebd4…` `24c2a64` · `arena/01a0f086…` `0ec34bd` · `arena/01a0fb4e…` `e4ca933` · `arena/01a0fb7f…` `9f7668f` · `arena/01a0fba6…` `2984f23` · `ci/validation-suites` `8274bde` — ทุกตัวที่ merge แล้วควรลบ · tag `v1.0.0-beta.16` = `fe84a3c` |
| งานค้างที่ทราบ | **PR #34 ยังไม่ merge → งานยังไปไม่ถึง Mac** · เช็กลิสต์ยืนยันบน Mac ของงาน cache รูปอยู่หัวข้อ 7.6 (4 ข้อ) · **ตัดสินใจเรื่อง branch `arena/01a10a92…`** (งาน telemetry/governor ที่ค้างบน GitHub ไม่มี PR — ข้อถัดไปในตาราง branch) · สร้างภาพ WSB-019 ใหม่ · หัวข้อ 6 เก่า **ปิดครบแล้ว** · **ไม่มี commit ค้างให้กู้จาก sandbox ของ session ก่อน** — ตรวจครบทุกทางแล้วที่หัวข้อ 7.6 (เคสที่ 4 ของการทำงานหาย เพราะไม่ได้ push ภายใน session นั้น)

---

## 2. งานล่าสุดที่เข้า `main`

### PR นี้ (session `arena/ccbe7be3…`, 2026-10-06) — โมเดลภาพเข้า model cache + โหลดจากสำเนาบนดิสก์ภายในเมื่อมีสำเนา
> ⚠️ **เขียนใหม่ทั้งชุด** — session ก่อนทำไว้แล้วแต่ไม่เคย push จึงหายไปกับ sandbox (ดูหัวข้อ 7.6) สเปกชุดนี้จึงถูกสร้างใหม่จากการอ่านโค้ดจริงใน `main` ไม่ใช่จากการคาดเดา

- **`scripts/server/model-cache.cjs` รองรับ "โฟลเดอร์"** — เมื่อก่อน `cachePlan` ปฏิเสธทุกอย่างไม่ใช่ไฟล์ (`stat.isFile()`) ซึ่งโมเดลภาพที่ติดตั้งจริงเป็น **โฟลเดอร์ Core ML** (`unet.mlmodelc/`, `text_encoder.mlpackage/`, …) ทั้งโฟลเดอร์ → ไม่เคยเข้าเกณฑ์จะแคชเลย · เพิ่ม `treeFingerprint()` (นับไฟล์ + รวมไบต์ + mtime ล่าสุด, ข้าม `.DS_Store`, ตาม symlink แบบถอดเป็นไฟล์จริงเพราะ HF snapshot ใช้ symlink) และ `fingerprintMatches()` ที่ใช้กับทั้งไฟล์และโฟลเดอร์ · `primeCache` คัดลอกโฟลเดอร์เข้าชื่อ `.partial` ก่อนแล้วค่อย rename = โฟลเดอร์ที่ค้างครึ่งเดียวจะไม่ถูกเสนอเป็นแคช · ตรวจจำนวนไฟล์+ไบต์ของสำเนากับต้นฉบับ**ก่อน**เขียน manifest เสมอ
- **แก้บั๊กที่ทำให้ cache ไม่เคยถูกใช้** — ตัวโหลด (`startLlmWithBackend`) เรียก `cachePlan(modelPath)` แบบไม่บอกดิสก์ ซึ่งชี้ไปที่ `app/runtime-state/model-cache` (โฟลเดอร์ของแอป = อยู่ Volume เดียวกับโมเดล ซึ่ง `primeCache` ปฏิเสธการคัดลอก) ขณะที่ปุ่ม Copy ใน `Settings > Performance` เขียนสำเนาไว้ที่ `internalCacheRoot()` (`~/Library/Application Support/LUKE AI STUDIO/model-cache` บน Mac) → **มีสำเนาอยู่บนดิสก์ภายในอยู่แล้วแต่ไม่มีใครหาเจอ** · เพิ่ม `cachedCopyFor()` ที่ค้น **ทั้งสองที่** (ดิสก์ภายในก่อน) โดยยืนยัน fingerprint ทุกครั้ง แล้วให้ทั้งตัวโหลดโมเดลข้อความและตัวโหลดโมเดลภาพใช้ร่วมกัน
- **โมเดลภาพได้ path จากสำเนาแล้วจริง** — ใน `startBackend`:คำนวณ `imageLoadPath` จาก `cachedCopyFor(imageModelPath)` แล้วส่งค่านี้ให้ `--model` **ทั้งสอง backend** (Core ML และ stable-diffusion.cpp) แทน `currentSettings.model` · ใช้เฉพาะตอน `pathInside(cachedPath, cacheDir)` ผ่าน · memory budget ยังวัดจาก path จริงของผู้ใช้ · log บอกว่าโหลดจากดิสก์ภายในกี่ GB / กี่ไฟล์
- **`/api/model-cache/status` ตอบ `POST`** — panel เรียก POST มานานแล้วแต่ route รับเฉพาะ GET → ได้ 404 เงียบ ๆ แล้วไม่แสดงข้อมูลแคชเลย และ `useInternalDisk` ที่ panel ส่งไปใน body ถูกทิ้ง (hardcode `false`) ตอนนี้รับทั้ง GET/POST และเคารพค่าที่ส่งมา · ลิสต์**ทั้งโมเดลข้อความและโมเดลภาพ** (ใหม่: `cacheableModelPaths()`, ติด `kind`/`label`/`name`/`fileCount` ให้ UI แสดงด้วย) · ส่วน dropdown "Draft model" กรองเหลือเฉพาะ `kind !== "image"` เพราะ llama.cpp ใช้ได้แต่ GGUF
- **`/api/model-cache/prime` รับโมเดลภาพ** — ยังไม่รับ path จาก request (basename แล้ว lookup กลับเข้าไปในโฟลเดอร์โมเดลเหมือนเดิม) แต่เพิ่ม `scope: "text"|"image"` กันชื่อชนกันระหว่างสองโฟลเดอร์ · refuse case เดิม (`../../etc/passwd`, `/etc/hosts`) ยัง 400 · *"คัดลอกไปก็ไม่มีประโยชน์"* (ดิสก์เดียวกัน) เดิมตอบ **500** ตอนนี้ตอบ **400 พร้อมเหตุผล** (ตั้ง `statusCode` ใน `model-cache.cjs`)
- **`coreml_server.py` อ่านจากสำเนาก่อน** — `load_reference_pipeline()` เรียก `from_pretrained(..., local_files_only=True, cache_dir=app/runtime-state/huggingface-cache)` ก่อน ถ้าไม่มีสำเนาจึงดาวน์โหลด**ครั้งเดียว**แล้ว stays on disk · `use_auth_token` ยังส่งตามเดิม (ไม่พังกับ repo ที่ต้อง login) แต่ fallback เป็น `token=`/ไม่มีเมื่อ diffusers เวอร์ชันใหม่เปลี่ยนชื่อ kwarg · ไม่มี `use_auth_token=True` เดี่ยว ๆ อีก · error สุดท้ายบอกชัดว่าขาดแค่ config ไม่ใช่ weight · `LUKE_IMAGE_MODEL_CACHE` ย้ายโฟลเดอร์ได้ · `/health` ตอบ `reference_cache` ด้วย
- **worker ยังระบุรุ่นโมเดลได้แม้โฟลเดอร์ชื่อเป็น hash** — `serve.cjs` ส่ง `--model-version <สิ่งที่ผู้ใช้เลือก>` เพิ่ม และ `infer_model_version()` พับ `_`/ช่องว่างเป็น `-` ด้วย (ชื่อที่ cache สร้างคือ `<sha12>-Stable_Diffusion_v1-5` ซึ่งเดิมหาไม่เจอแล้ว fallback เป็น v1-5 = โหลด scheduler/tokenizer ผิดตัวกับโมเดล XL)
- **UI** (`PerformancePanel.jsx`) — รายการที่ต้องคัดลอกบอกชนิด (Text model / Image model) + อธิบายว่าโมเดลภาพได้ประโยชน์มากที่สุด · ส่ง `scope` ตามชนิด
- **เทสต์**: `scripts/validation/test-image-model-cache.cjs` (72 checks: fingerprint โฟลเดอร์, คัดลอก/ยืนยัน/คัดลอกใหม่เมื่อโมเดลเปลี่ยน, symlink, `cachedCopyFor` หาเจอทั้งสองดิสก์, asserts ว่า `--model` เป็น path ที่ resolve แล้ว, route ตอบ POST/ลิสต์โมเดลภาพ/ปฏิเสธ path outside folder) + `scripts/validation/helpers/coreml-reference-cache-probe.py` (17 checks บนตัว `coreml_server.py` จริงโดย stub torch/numpy/diffusers — พิสูจน์**ลำดับ**การเรียก คือมีสำเนาแล้วไม่แตะเน็ต) · suite นี้ skip ตัวเองถ้าเครื่องไม่มี python3
- **`validate-release.sh`** — เพิ่ม `py_compile` ให้ `coreml_server.py` และ probe · เดิมไม่มีอะไรคอมไพล์ worker ตัวนี้เลย ทั้งที่เป็นไฟล์เดียวที่รันเฉพาะบน Apple Silicon
- **รันแล้วบน Linux:** ชุดใหม่ 72 passed / 0 failed · `test-llm-performance` 56/0 · `test-api-route-methods` PASS · `test-api-cors-policy` / `test-frontend-bundle-budgets` / `test-static-file-containment` / `test-frontend-dist-freshness` / `test-runtime-state-not-in-git` PASS หลัง build frontend · `run-all` ทั้งชุด 145 ผ่าน (เหลือเฉพาะที่ต้อง `imageio_ffmpeg` ซึ่ง CI ติดตั้งให้ — ดูหัวข้อ 6)
- **ยังไม่ได้ยืนยันบน Mac (เช็กลิสต์อยู่หัวข้อ 7.6):** โหลด Core ML จริงจากสำเนาดิสก์ภายใน · สำเนาโฟลเดอร์ Core ML ขนาดจริง · เริ่มงานแบบ offline ไม่มีเน็ต

### PR #30 (session `arena/01a0f582…`, 2026-10-01 — merged แล้ว) — ป้ายรายการ + ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้" + โพสต์ Facebook 2 รูป (ภาพ AI + รูปสินค้า 500px) + ขนาดภาพ 1024×600
> สร้างใหม่ทั้งชุด: session ก่อนทำงานชุดนี้ไว้แล้วแต่**ไม่เคย push** → หายทั้งชุด (ดูท้ายหัวข้อ 7) — สเปกมาจากการคุยกับเจ้าของงานใหม่ทั้งหมดใน session นี้
- **ป้ายรายการ (tags)** — `entry.tags` เก็บถาวรใน runtime-state · ผ่าน `PATCH /api/social-agency/calendar/:entryId` ฟิลด์ `tags` (แทนที่ทั้งชุด) · `_normalizeTags`: trim/ยุบช่องว่าง/dedupe ไม่สนตัวพิมพ์ ≤ **8 ป้าย/รายการ × ≤24 ตัวอักษร** (ไทยได้) ผิดกฎ throw ทันที · `listCalendar` ค้นหา `q` เจอจากป้าย · UI: แถว "ป้าย" ในหน้าโพสต์ (ชิปกด × เอาออก + พิมพ์เพิ่ม + เสนอป้ายที่เคยใช้ในลูกค้าเดียวกัน 6 อัน) + ชิปป้ายเล็กบนการ์ดปฏิทิน (3 อัน เกินขึ้น `+N`) + ตัวกรอง "ป้าย" บนแถบฟิลเตอร์
- **ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้"** — `POST /api/social-agency/entry-image/reject` · จด fingerprint ลง `entry.imageRejections[]` (เก็บ 20 รายการล่าสุด) + **ล้าง `imageReview` ทันที** + ด่านตรวจเป็นสถานะ `rejected` → ส่งจริงไม่ได้เด็ดขาด (dry-run ใช้ได้) · **สร้างภาพใหม่อัตโนมัติ** หลังปฏิเสธ (ส่ง `regenerate:false` เพื่อปิด) · ภาพใหม่ที่ไบต์ตรงกับรูปที่เคยปฏิเสธ → ด่านตรวจคืนสถานะ `rejected` เอง · แม้กด "ตรวจภาพแล้ว" ทับก็ไม่ปลดล็อก (เช็ก fingerprint ก่อนผลตรวจเสมอ) · ปุ่มแดงอยู่ในด่านตรวจภาพทั้งหน้าโพสต์ และ `RunsTab` แสดงเหตุผลตามเดิม
- **โพสต์ Facebook 2 รูป (ตามที่เจ้าของงานเลือก)** — [1] ภาพ AI สร้างตามปกติ (settings img2img/denoise เดิม) [2] **รูปสินค้าจริงแบบไม่แก้ไขอะไร ยกเว้นย่อด้านยาวสุดให้เท่ากับ 500px คงสัดส่วน** (รูปเล็กกว่า 500px อยู่แล้วใช้ต้นฉบับ) · วิธีย่อ: `ensureProductRef500()` ใน `lib.js` ใช้ canvas ของเบราว์เซอร์ (JPEG q0.92) แล้ว `POST /api/social-agency/products/ref-image-500` แคชเป็น `app/outputs/sa-products/<client>/<sku>.ref500.jpg` — **เซิร์ฟเวอร์ไม่มี dependency ใหม่** · endpoint นี้มี GET เช็กสถานะด้วย · ทริกเกอร์: เปิดหน้าโพสต์ 1 ครั้งก็สร้างให้เงียบๆ · ส่งจริง: อัปโหลด 2 รูปแบบ `published=false` (ภาพ AI ก่อน) แล้ว `POST /{pageId}/feed` + `attached_media` ลำดับเดียวกัน · ไม่มีรูป/ปิดตั้งค่า → โพสต์รูปเดียวเหมือนเดิม · อัปโหลดรูปที่ 2 พลาด → โพสต์เฉพาะภาพ AI + note ในผลรัน · ยังไม่มี `ref500` → แนบต้นฉบับ + note บอกวิธีให้ระบบสร้าง · ผลรันมี `mediaKind: "multi-photo"` + `attachedProductRef`
- **ขนาดภาพปฏิทินตั้งได้รายลูกค้า** — `settings.imageWidth/imageHeight` (default **1024×600** แบนเนอร์ ปัดทวี 8 ช่วง 256–1536) ผ่านหน้า Connectors · ใช้ทั้ง txt2img (`size`) และ img2img (`width`/`height`) · `imageJob` บันทึก `width`/`height` · Generator ไม่กระทบ (ค่า global เดิม)
- เทสต์ใหม่ 3 ชุด: `test-social-agency-entry-tags.cjs` (11) · `test-social-agency-image-reject.cjs` (10) · `test-social-agency-fb-ref-multi-photo.cjs` (9) — mock ทั้งหมด รวม Graph API (อัปโหลดลำดับ/`attached_media`/fallback/ปิดตั้งค่า) · run-all **147 passed · 0 failed**
- **ยังไม่ได้ยืนยันบน Mac:** โพสต์ 2 รูปจริงบนเพจจริง · คุณภาพภาพ 1024×600 จาก backend จริง · ป้าย/ปุ่มปฏิเสธในงานจริง (เช็กลิสต์ท้ายหัวข้อ 6)

### PR #29 (session `arena/01a0f086…`, 2026-09-30 — merged เป็น `a86fb7c`, CI เขียว) — docs: บันทึกว่า PR #28 merged เป็น 66863bf ไม่มี PR ค้าง
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

**ค้างของ session `arena/01a0fb7f…` (2026-10-02) — PR #32:**
- [ ] **merge PR #32** แล้ว `git pull` บน Mac
- [ ] **ยืนยัน image prompt บน Mac:** สร้างภาพปฏิทิน 1 ใบ → ดู image prompt ต้องไม่เป็น `"product (SKU)"` ถ้าสินค้ามีคำอังกฤษในชื่อหรือรายละเอียด · ถ้าสินค้าเป็นภาษาไทยล้วนทุกฟิลด์ ยังคงเป็น `"product"` (ข้อจำกัดของ SD ที่อ่านภาษาไทยไม่ได้) · **แนะนำ:** เพิ่มคำอธิบายสินค้าภาษาอังกฤษใน `category` หรือ `detail` เพื่อให้ prompt แม่นขึ้น

**ค้างของ session `arena/01a0f582…` (2026-10-01) — ทำบนเครื่อง Mac เท่านั้น (เช็กลิสต์ฟีเจอร์ใหม่):**
- [ ] **อัปเดต + build:** `cd /Volumes/AI && git pull && cd app/frontend && npm install && npx vite build` แล้วรัน server ตามปกติ (`mac.sh`)
- [ ] **ขนาดภาพใหม่:** สร้างภาพปฏิทินสินค้า **WLB-006** 1 ใบ → ภาพต้องออกขนาด **1024×600** (แบนเนอร์) · `imageJob.width/height` ในไฟล์สถานะต้องเป็น 1024/600 · ปรับค่าได้ใน Connectors › ขนาดภาพปฏิทิน
- [ ] **ป้าย (concept + pencil case):** หน้ารายการ (ปฏิทิน) ต้องมีชิปป้าย · เปิดหน้าโพสต์ → แถว "ป้าย" พิมพ์ `concept` แล้ว Enter แล้วพิมพ์ `pencil case` → ป้ายขึ้นบนการ์ดรายการทันที · ช่องค้นหาพิมพ์ `concept` ต้องเจอ · ตัวกรอง "ป้าย" ต้องมีให้เลือก
- [ ] **ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้":** ในด่านตรวจภาพกดปุ่มแดง → ระบบต้อง**สร้างภาพใหม่ให้อัตโนมัติ** + สถานะเป็น "รูปนี้ถูกปฏิเสธ" ระหว่างรอ · ภาพใหม่เสร็จ → ต้องตรวจภาพใหม่ก่อนส่งได้ (สถานะกลับ "ยังไม่ได้ตรวจ") · **สั่งส่งจริงตอนถูกปฏิเสธต้องถูกบล็อก**
- [ ] **โพสต์ Facebook 2 รูป:** เปิดหน้าโพสต์ของรายการ WLB-006 1 ครั้ง (ให้ระบบสร้าง `WLB-006.ref500.jpg`) → ตรวจว่าไฟล์เกิดใน `app/outputs/sa-products/<ลูกค้า>/` → ส่งจริงบนเพจ: โพสต์ต้องมี **2 รูป (ภาพ AI ก่อน → รูปสินค้า 500px หลัง)** แคปชัน/UTM เหมือนเดิม · ปิดตั้งค่าใน Connectors ("แนบรูปสินค้าจริง…") แล้วโพสต์ถัดไปต้องกลับเป็นรูปเดียว
- [ ] **grep สถานะ:** `grep -o '"tags": \[[^]]*\]\|"width": [0-9]*\|"height": [0-9]*\|"imageRejections": \[\]' /Volumes/AI/app/runtime-state/social-agency/<ลูกค้า>.json | tail` — หลังใช้ฟีเจอร์ต้องเห็น `"tags"`, `"width": 1024`, `"height": 600` และ `"imageRejections"` ตามที่ทำ

**ค้างของ session `arena/01a0eb60…` (2026-09-29) — ทำบนเครื่อง Mac เท่านั้น (ของเก่าที่ยังไม่ได้ยืนยัน):**
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

## 7.5 บันทึกเคสงานหายของ session ก่อน (session `arena/01a0f582…`, 2026-10-01) — "งานชุดป้าย/reject/รูปสินค้าแนบโพสต์"

**คำขอที่เข้ามา:** ข้อความส่งต่อจาก session ก่อนบอกให้ session ใหม่ `git push origin arena/01a0f086…` → เปิด PR → merge พร้อมเช็กลิสต์บน Mac (WLB-006 · หน้ารายการขึ้น `concept` + `pencil case` · ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้" · ลิงก์ Reference ในแคปชัน)

**ผลสรุป: PR นั้นเสร็จไปแล้ว แต่งานชุดใหม่หายทั้งชุด → สร้างใหม่ใน session นี้ (หัวข้อ 2)**
- ตรวจแล้ว: PR #29 (branch `arena/01a0f086…`) **merged เป็น `a86fb7c` เมื่อ 2026-09-30 04:40 UTC** (merge commit มี tip ของ branch เป็น parent ที่สอง) · CI `validation` บน `main` เขียว · ไม่มี PR ที่เปิดค้าง → **push branch เดิมซ้ำเป็น no-op**
- แต่งานที่ข้อความอ้าง (WLB-006, ป้าย, ปุ่มปฏิเสธ, Reference ในโพสต์) **ไม่มีบน GitHub เลย**: ไล่ branch ทุกตัว + `refs/pull/*` ทั้งหมด (#1–#29) · GitHub Events API หลัง 04:40 UTC ของ 30 ก.ย. **ไม่มี push แม้แต่ครั้งเดียว** · สแกน git object ทุกชิ้นบน origin (3,917 blobs) หา `WLB-006` / `pencil case` / `ห้ามใช้รูปนี้` / `ติดป้าย` = **0 ผลลัพธ์** → งานอยู่แค่ใน sandbox ของ session ก่อนและไม่เคยถูก push = **กู้คืนไม่ได้** (เครื่อง Mac ก็ไม่มี เพราะดึงของจาก GitHub เท่านั้น)
- **การสร้างใหม่ใน session นี้** ใช้สเปกที่คุยกับเจ้าของงานใหม่ทั้งหมด (มีการเปลี่ยนจากของเดิม 2 จุดตามที่เจ้าของงานเลือก: Reference เป็น **รูปที่ 2 ในโพสต์เดียว** แทนลิงก์ในแคปชัน · กดปฏิเสธแล้ว**สร้างใหม่อัตโนมัติ** · เพิ่มขนาดภาพ 1024×600 ตั้งได้)
- **บทเรียนซ้ำ (เดิมจากเคส 5be0bd0):** งานที่ทำใน sandbox ต้อง **commit + push + merge เข้า `main` ภายใน session เดียวกันทุกครั้ง** ถ้า session จะจบแล้วยัง merge ไม่ได้ ให้ย้อนกลับไปทำให้จบก่อน — อย่าปิด session ทิ้ง commit ไว้ใน sandbox · ข้อความส่งต่อที่บอกให้ session ถัดไป "push branch เดิม" ใช้ไม่ได้ถ้า branch นั้นไม่เคยถูก push

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

---

## 7.6 บันทึกเคสงานหายรอบที่ 4 (session `arena/ccbe7be3…`, 2026-10-06) — "cache สำหรับโมเดลภาพ + โหลดจากสำเนาดิสก์ภายใน"

**คำขอที่เข้ามา:** ข้อความส่งต่อจาก session ที่ปิดไปแล้วระบุว่า *"การแก้ไขบันทึกอยู่ใน working tree ของ repo นี้แล้ว … แต่ไม่ได้อยู่บน GitHub"* และบอกให้ session ใหม่ "ส่งต่อการแก้ไขขึ้น GitHub"

**ผลสรุป: ไม่มีอะไรให้ส่งต่อ — งานนั้นไม่มีอยู่ใน sandbox ของ session นี้ และกู้คืนไม่ได้** (นี่คือเคสที่ 4 ของรูปแบบเดียวกัน: `5be0bd0`/`1d7d26c` → `01a0f086…`→`01a0f582…` → `01a0fba7…` (PR #32/#33 ซึ่งรอดเพราะถูก push) → เคสนี้)

| ที่ที่ตรวจ | วิธีตรวจ | ผล |
|---|---|---|
| working tree ของ session นี้ | `git status --porcelain` (รวม `--ignored`) | **ว่าง** — ไม่มีการแก้ไขใด ๆ |
| stash | `git stash list` | ว่าง |
| object ทั้งหมด + reflog | `git fsck --lost-found --no-reflogs` · `git reflog` · `git for-each-ref` | ไม่มี dangling object · ประวัติเริ่มที่ `clone: from github.com/...` เท่านั้น |
| refs บน GitHub | `git branch -a` · `gh pr list --state all` | `main` = `446d113` (merge PR #33) · **PR ล่าสุดคือ #33** ไม่มี PR เรื่อง image cache |
| ที่อื่นบน sandbox | `find / -maxdepth 2 -name .git` · `/tmp/arena-workspace` | มี repo เดียวคือ checkout ที่ clone ใหม่ · ไฟล์ว่าง/ไม่มี patch |

**สาเหตุ (ยืนยันแล้วทุกเคสที่ผ่านมา):** sandbox ของแต่ละ session เป็นเครื่องชั่วคราวที่ clone จาก `main` ใหม่เสมอ — ไฟล์ที่ไม่ได้ commit+push **ภายใน session นั้น** จะถูกล้างไปพร้อม sandbox การที่ข้อความส่งต่อพูดว่า "บันทึกอยู่ใน working tree แล้ว" จึงจริงตอนที่ session นั้นยังเปิดอยู่ และไม่เป็นจริงทันทีที่ session ปิด (ถ้อยคำนี้ทำให้เข้าใจว่ามีของให้กู้ ทั้งที่ไม่มี object อยู่เลย)

**สิ่งที่ทำแทนการกู้:** อ่านโค้ดจริงใน `main` แล้ว**เขียนงานชุดนั้นขึ้นใหม่** (หัวข้อ 2 "PR นี้") — ระหว่างไล่โค้ดเจอบั๊กที่ยังไม่มีใครสังเกต 2 ตัว ซึ่งงานชุดเก้าน่าจะเขียนทับไว้โดยไม่เจตนา: (1) cache เคยใช้ได้กับไฟล์เดี่ยวเท่านั้น โมเดลภาพเป็นโฟลเดอร์จึงไม่เข้าเกณฑ์เลย (2) **ตัวโหลดมองหาสำเนาคนละโฟลเดอร์กับที่ระบบเขียนสำเนาไว้** ทำให้อาการ "มีสำเนาบนดิสก์ภายในแต่ไม่เคยถูกใช้" ยังอยู่ทั้งที่มีไฟล์ครบ — ทั้งคู่ถูกแก้และเขียนเทสต์คุมไว้ใน PR นี้

**กติกาซ้ำที่ต้องไม่พลาดอีก:** งานในทุก session ต้อง `commit → push → เปิด PR → merge เข้า `main` ให้จบใน session เดียวกัน` ถ้าจะปิด session โดย merge ไม่ทัน ให้ push branch ไว้ **และ** เขียน sha ที่ push จริงลงหัวข้อ 1 (sha ที่ยังไม่ push ห้ามเขียนลงเอกสาร)

### วิธีเอางานชุดนี้ไปใช้บน Mac (หลังจาก PR merge แล้วเท่านั้น)

```bash
cd <โฟลเดอร์ repo บน Mac>          # ตามปกติคือ /Volumes/AI/LUKE-AI-STUDIO-Enterprise
git fetch origin
git checkout main
git pull --ff-only
cd app/frontend && npm install && npx vite build
cd ../.. && ./mac.sh
```

> ⚠️ **ต้อง build ใหม่** เพราะ `app/dist/` ไม่อยู่ใน git (หัวข้อ 3) ถ้าข้ามขั้นนี้ UI จะยังเป็นแบบเก่าและจะไม่เห็นรายการโมเดลภาพใน `Settings > Performance` เลย
> ⚠️ zsh บน Mac ไม่เปิด `interactivecomments` โดยค่าเริ่มต้น — ห้ามวางบรรทัดที่มี `#` ต่อท้ายคำสั่ง (ดูท้ายหัวข้อ 7.5)

### เช็กลิสต์ยืนยันบน Mac (ยังไม่มีใครทำ)

1. `Settings > Performance` → เปิด "Use the internal disk…" → ต้องเห็น **both** ไฟล์ GGUF *และ*โฟลเดอร์ Core ML พร้อมคำว่า `Image model` (เดิมไม่แสดงอะไรเลย เพราะ POST ถูก 404)
2. กด Copy ที่โมเดลภาพ → รอเสร็จ → log ของ server ต้องมี `[backend] Loading <ชื่อโมเดล> from the internal disk cache (… GB, … files)` ตอนโหลดครั้งถัดไป (ถ้ายังขึ้นว่ามาจาก external volume แปลว่า `cachedCopyFor` มองไม่เห็นสำเนา — ให้ grep `manifest.json` ใน `~/Library/Application Support/LUKE AI STUDIO/model-cache/`)
3. โหลดโมเดลภาพตอน **ปิดเน็ต**: log ต้องมี `[coreml-npu] Reference config for … read from the local copy in …` ไม่ใช่ข้อความ "No usable local copy"
4. ขนาดโฟลเดอร์ cache บนดิสก์ภายใน (`du -sh ~/Library/Application\ Support/LUKE\ AI\ STUDIO/model-cache`) ต้องเท่ากับขนาดโมเดลที่เลือก และ **ต้นฉบับบน external volume ต้องยังอยู่** (ข้อนี้คือเหตุผลที่ copy ไม่ใช่ move)
