# ARENA_HANDOFF.md — บันทึกส่งต่องานระหว่าง session

> **อัปเดตล่าสุด:** 2026-10-06 (session `arena/01a10a92…` รอบ 5 — **ชิป RAM บอกให้ชัดว่าเป็นแรมของใคร**: เจ้าของงานส่งภาพหน้าจอ "เปิดแอปมายังไม่โหลดโมเดล ทำไม RAM 10/18" · คำตอบ: ตัวเลขนั้นคือ**ทั้งเครื่อง** แบบเดียวกับ Activity Monitor "Memory Used" (สูตรเดิม `total − (free + inactive + speculative)` ซึ่งตัด file cache ออกแล้ว → 10 GB คือเบราว์เซอร์/แอปอื่น/macOS จริง ๆ ไม่ใช่แอปนี้) · เซิร์ฟเวอร์ตัวนี้วัดเองได้ที่ ~63 MB RSS (รอบ 2) · **แก้ที่การแสดงผล:** telemetry เพิ่ม `server_rss_gb` (RSS ของโปรเซสเซิร์ฟเวอร์เอง) และชิปแสดงส่วนที่ LUKE รับผิดชอบข้างตัวเลขเครื่อง: `RAM: 10 / 18 GB · LUKE 0.1 GB` (= server RSS + โมเดลที่ค้างในโปรเซสของตัวเอง) + tooltip อธิบายฉบับประโยคว่า tab เบราว์เซอร์นับเป็นของเบราว์เซอร์ · เทสต์ gpu-memory-telemetry 37 → **43 checks** · eslint ทั้ง tree 0 problems · ยังไม่ merge)
> **อัปเดตล่าสุด:** 2026-10-05 (session `arena/01a10a92…` รอบ 4 — **"แรมไม่พอ" ไม่ใช่ทางตันอีกต่อไป: ปลด engine ที่โหลดคืนเองได้เพื่อเปิดทางให้โหลด + แก้บั๊กที่ทำให้ Generator ไม่ยอม restart backend ที่ถูกปลดไป** · `planMakeRoom()` ใหม่ใน `resource-governor.cjs` (all-or-nothing: ครอบคลุมไม่พอก็ไม่ปลดอะไรเลย) ต่อสายเข้า **ทั้งสองเส้นทางโหลด** (text + image) ก่อน `throw` ข้อความปฏิเสธ · image engine ปลดได้ทางนี้ทางเดียว (ไม่ใช้ timer — เซิร์ฟเวอร์ไม่เห็นการสร้างภาพจากเบราว์เซอร์จึงวัด idle ไม่ได้จริง) และไม่แตะ OpenVINO worker (route ของมันไม่ start คืนให้) · กัน Social Agency: run ค้างอยู่ หรือมีโพสต์ถึงกำหนดใน 10 นาที = ห้ามแตะ image · **แก้บั๊กจริงใน `Generator.jsx`:** `killBackend()` เก็บ `currentSettings` ไว้ → โค้ดเดิมเทียบ settings ตรงกันแล้วข้าม restart ทั้งที่ backend ตายไปแล้ว ตอนนี้เช็ค `status.running`/`ready` ก่อน · **แก้เหตุผลที่จดไว้ผิด:** tts/speech **ไม่มีโปรเซสค้าง** (Kokoro worker และ whisper-cli ถูก spawn ต่อคำขอแล้วจบตามผล, `system-speak` ใช้ `say` ของ macOS) → เพิ่มฟิลด์ `holdsProcess` ใน `ENGINE_RULES` ให้เหตุผลตรวจสอบได้ · เทสต์ 77 → **118 checks** · run-all **147 passed** (5 ตัวเดิมของสภาพแวดล้อม) · README เพิ่ม FAQ 1 ข้อ + แก้ 1 ย่อหน้า · **ต้อง build frontend ใหม่บน Mac** · ยังไม่ merge)
> **อัปเดตล่าสุด:** 2026-10-05 (session `arena/01a10a92…` รอบ 3 — **resource governor: คืนแรมให้เครื่องเมื่อโมเดลถูกทิ้งไว้ไม่ได้ใช้** · โมดูลใหม่ `scripts/server/resource-governor.cjs` (กฎ + เกณฑ์ตาม tier + parser ของ `vm_stat`/`sysctl vm.swapusage`/`/proc/meminfo` — pure ทั้งหมด นาฬิกาและ platform เป็นอาร์กิวเมนต์) + sweep ทุก 60 วิใน serve.cjs · **ตัดสินใจจากสัญญาณที่แปลว่าเครื่องขาดแรมจริง** (swap/compressor/MemAvailable) ไม่ใช่จากเปอร์เซ็นต์ที่ดูเยอะ · **ปลดเฉพาะ engine ที่โหลดคืนเองได้** (text ผ่าน `restoreReleasedMainModel()` ที่มีอยู่ + arena pool) และ**ไม่แตะ image backend** เพราะการสร้างภาพยิงจากเบราว์เซอร์ตรงเข้า backend → เซิร์ฟเวอร์ไม่เห็นคำขอที่ต้องใช้มันคืน (บันทึกเหตุผลไว้ใน `ENGINE_RULES` และโชว์ใน `/api/backend-status`) · swap ถือเป็น **lagging signal**: เกิน critical เท่านั้นจึงลงมือ มิฉะนั้นเป็นแค่หลักฐานเสริม เพราะ macOS ค้าง swap ไว้หลังเหตุการณ์จบแล้ว · เทสต์ใหม่ 77 checks · run-all **147 passed** · README เพิ่ม FAQ 3 ข้อ · ยังไม่ merge)
> **อัปเดตล่าสุด:** 2026-10-05 (session `arena/01a10a92…` รอบ 2 — **ทำให้ตัวแอปเบาขึ้นตามที่เจ้าของงานขอ**: เลิกโหลด AWS SDK ตอน boot (วัดจริง `77.4 → 63.2 MB RSS`, heap `16.0 → 9.4 MB`, โมดูล `89 → 61`) + โมดูลใหม่ `telemetry-demand.cjs` ให้ตัว sample ฮาร์ดแวร์ทั้ง 4 ตัว (`nvidia-smi` · `vm_stat` · `ps` · `llama-server --list-devices` ทั้งโปรเซส) **หยุดทำงานเมื่อไม่มี client ดูมอนิเตอร์เกิน 30 วิ** + frontend หยุด poll เมื่อแท็บถูกซ่อน · เทสต์ใหม่ 32 + 12 checks · **สำคัญ: วัดแล้วตัวเซิร์ฟเวอร์ไม่ใช่ตัวกินแรม (63 MB) — `16 / 18 GB` คือน้ำหนักโมเดล + cache ของ macOS · งานที่เหลือคือการ "ปลดโมเดลเมื่อไม่ใช้" ซึ่งต้องให้เจ้าของงานเลือก policy ก่อน (เช็กลิสต์ท้ายหัวข้อ 6)** · ยังไม่ merge)
> **อัปเดตล่าสุด:** 2026-10-05 (session `arena/01a10a92…` — **แก้ชิป VRAM บน macOS ที่ค้าง `0.0 / 18 GB` ตลอด**: โมดูลใหม่ `scripts/server/gpu-memory-telemetry.cjs` + `pollMetalVram()` ใน serve.cjs วัด resident set ของ backend ที่ถือ weights จริงผ่าน `ps -axo pid=,rss=` และใช้ **Metal working set (~14.3 GB)** เป็นเพดานแทน total RAM · เทสต์ใหม่ `test-gpu-memory-telemetry.cjs` 37 checks · eslint ทั้ง tree 0 problems · **push branch แล้วแต่ยังไม่เปิด PR/merge — เจ้าของงานขอดู diff ก่อน** (เช็กลิสต์ท้ายหัวข้อ 6))
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
| `main` | ดู sha ล่าสุดด้วย `git log -1 --oneline main` — ณ 2026-09-30 คือ `24c2a64` (merge ของ PR #26) · **PR #32 รออนุมัติ** (แก้ image prompt) |
| เวอร์ชัน | `1.0.0-beta.16` (`app/version.json`, tag `v1.0.0-beta.16`) |
| PR ที่เปิดค้าง | **ไม่มี** — PR #28 (สเกล steps ของ img2img + เทสต์) merged 2026-09-30 04:34Z เป็น `66863bf`; CI `validation suites` เขียวทั้ง workflow (runs 36669042409) · ก่อนหน้า: PR #26 (รูปสินค้าอ้างอิง → img2img + เตือนใน UI + แก้เช็กบ็อกซ์) **merged แล้ว** 2026-09-29 04:33Z เป็น `24c2a64` (commits ที่ push จริง: `5d64236` + `f83ee8d`) · ก่อนหน้า: #25 = `e21eb87`, #21 = `6397105` |
| branch บน GitHub (ตรวจด้วย `git ls-remote` 2026-09-30) | `main` `24c2a64` · `arena/01a0e089…` `2584762` · `arena/01a0e633…` `3095163` · `arena/01a0eb2c…` `6080dd5` · `arena/01a0eb60…` `24c2a64` · `arena/01a0ebd4…` `24c2a64` · `ci/validation-suites` `8274bde` — **ยังไม่ได้ลบ** (ข้อความเดิมที่ว่า "เหลือแค่ `main`" ไม่จริงแล้ว) · tag `v1.0.0-beta.16` = `fe84a3c` |
| งานค้างที่ทราบ | **ยืนยันฟีเจอร์ใหม่ (ป้าย/ปุ่มปฏิเสธ/โพสต์ 2 รูป/ขนาด 1024×600) บนเครื่อง Mac จริง — เช็กลิสต์ท้ายหัวข้อ 6** · งานยืนยัน img2img/steps ของ PR #26–#28 ยังอยู่ (ข้อถัดไปในหัวข้อ 6) · สร้างภาพ WSB-019 ใหม่ · หัวข้อ 6 เก่า **ปิดครบแล้ว** · งานที่จงใจทิ้งไว้อยู่ท้ายหัวข้อ 6 · **ไม่มี commit ค้างให้กู้** (เคสล่าสุดจบแล้วที่หัวข้อ 7.5) |

---

## 2. งานล่าสุดที่เข้า `main`

### งานนี้ รอบ 5 (session `arena/01a10a92…`, 2026-10-06 — **push branch แล้ว ยังไม่ merge**) — ชิป RAM บอกให้ชัดว่าตัวเลขนั้นเป็นของใคร
> เจ้าของงานเปิดแอปบน Mac แล้วเห็น `RAM: 10 / 18 GB` ทั้งที่ยังไม่ได้โหลดโมเดลสักตัว จึงถามว่าแอปกินแรมขนาดนั้นเลยหรือ
- **สืบก่อนตอบ:** ชิป RAM มาจาก `getTelemetry()` → บน macOS ใช้ `pollMacRam()` ที่อ่าน `vm_stat` แล้วคำนวณ `total − (free + inactive + speculative)` ซึ่งคือสูตรเดียวกับ "Memory Used" ของ Activity Monitor (ตัด file cache ที่ macOS กักไว้ทิ้ง) → **10 GB เป็นของทั้งเครื่องจริง**: tab เบราว์เซอร์หลายอัน + แอปอื่น + ตัว macOS + wired/compressor · ส่วน LUKE เซิร์ฟเวอร์วัดเองได้ในรอบ 2 ว่า ~63 MB RSS และโมเดลอยู่คนละโปรเซส (ตอนนี้ยังไม่มี → VRAM 0.0 ถูกต้องแล้ว)
- **สิ่งที่แก้ (แสดงผล ไม่ใช่เปลี่ยนสูตร):** `getTelemetry()` เพิ่ม `server_rss_gb` จาก `process.memoryUsage().rss` · `TopStatusBar.jsx` แสดง `· LUKE x.x GB` ต่อท้ายชิป (= server RSS + `vram_used_gb` ซึ่งเป็น RSS รวมของโปรเซสที่ถือโมเดล) และ tooltip เป็นประโยคเต็ม: ตัวเลขเครื่องคือแบบเดียวกับ Activity Monitor, ส่วนของ LUKE เท่าไร, และ UI ที่เห็นรันใน tab เบราเซอร์จึงนับเป็นของเบราว์เซอร์ · ถ้า `server_rss_gb` ยังไม่มี (เซิร์ฟเวอร์เวอร์ชันเก่า/Tauri) จะไม่แสดงส่วน LUKE เลยแทนที่จะโชว์ศูนย์ปลอม
- เทสต์ `test-gpu-memory-telemetry.cjs` **37 → 43 checks** — สูตรยังตัดของที่ reclaim ได้ทิ้ง · เซิร์ฟเวอร์รายงาน footprint ตนเอง · ชิปแสดงส่วน LUKE · tooltip พูดถึง Activity Monitor กับเบราว์เซอร์ · ค่าที่ยังไม่มาต้องไม่กลายเป็นศูนย์ · eslint ทั้ง tree **0 problems** (ต้องลง eslint ใหม่ใน `app/frontend/node_modules` เพราะ snapshot ไม่เก็บ node_modules — ห้าม `npm ci` ทั้งโปรเจกต์: ติดลงโฟลเดอร์ชั่วคราวแล้ว copy มา)
- **README:** เพิ่ม FAQ "เปิดแอปมายังไม่โหลดโมเดล ทำไม RAM 10/18"

### งานนี้ รอบ 4 (session `arena/01a10a92…`, 2026-10-05 — **push branch แล้ว ยังไม่ merge**) — make-room ตอนโหลด: เปลี่ยน "แรมไม่พอ ไป unload เอง" เป็นการปลดให้ แล้วโหลดต่อ
> งานที่รอบ 3 จงใจทิ้งไว้ ("ทำให้ image engine ปลดได้อย่างปลอดภัย") · สรุปแล้วทำ**คนละแบบ**กับที่จดไว้ และเป็นบั๊กจริงที่พบระหว่างสืบ
- **สิ่งที่สืบได้ก่อนเขียนโค้ด (สำคัญกว่าโค้ด):** มี engine ที่ถือโปรเซสค้างไว้จริงเพียง 3 ตัว — text (`llama-cli`), image (SD backend), arena (pool ของ `llama-cli`) · ส่วน **tts กับ speech ไม่มีอะไรค้าง**: `startTts()` ตรวจ runtime แล้วตั้ง flag/พอร์ตเฉย ๆ การสังเคราะห์เสียง `spawn(process.execPath, [TTS_WORKER])` **ต่อคำขอ** แล้วจบตามไฟล์เสียง · `synthesizeSystemTts()` ใช้ `say` ของ macOS (darwin เท่านั้น) ไม่แตะ Kokoro เลย · speech ก็เหมือนกัน: `transcribeWavBuffer()` spawn `backend.cli` ต่อคำขอ → **เหตุผลที่รอบ 3 จดไว้ ("tts restorable ไม่ได้เพราะ `/api/tts/system-speak` ไม่ auto-start") ผิด** และ "ปลด tts/speech" คือ no-op ที่ไม่มีวันคืนแรม → แก้ `ENGINE_RULES` ให้พูดความจริง พร้อมฟิลด์ใหม่ `holdsProcess` ให้เทสต์ยึดได้
- **ทำไม image จึงไม่เข้า timer sweep:** `api.js` ยิง `${baseUrl}/v1/images/generations` (และ `/sdapi/v1/img2img`) **จากเบราว์เซอร์เข้า backend ตรง ๆ** → เซิร์ฟเวอร์ไม่เคยเห็นการสร้างภาพแบบ interactive จึงตอบไม่ได้ว่า engine ว่างมากี่นาที (`engineLastUsedAt.image` จะเห็นเฉพาะงานฝั่งเซิร์ฟเวอร์) · ปลดตาม timer = แย่งโมเดลจากคนที่กำลังกดสร้างภาพอยู่
- **แต่ปลดตอนโหลดได้ — และนั่นคือจุดที่คุ้ม:** `planMakeRoom({shortfallGb, engines, policy})` (pure) เลือก engine ที่ `resident && makeRoom && !busy && sizeGb > 0` **เรียงจากใหญ่สุด** (ปลดน้อยตัวที่สุดต่อหนึ่งโหลด) แล้วรวมให้พอช่องว่าง · **all-or-nothing:** รวมไม่พอ → `CANNOT_MAKE_ROOM` และไม่ปลดอะไรเลย เพราะ "engine ตาย + โหลดถูกปฏิเสธ" แย่กว่าปฏิเสธอย่างเดียว · ช่องว่างคำนวณจากตัวเลขที่ budget วัดจริง (`estimateGb - availableGb`) ไม่ใช่ค่าเดา
- **ต่อสายทั้งสองเส้นทางโหลด:** `startLlmWithBackend()` และ `startBackend()` เดิม `if (budget.blocking) throw …` ทันที → ตอนนี้ถ้า blocking จะเรียก `makeRoomForLoad()` ก่อน แล้ว**วัด budget ใหม่** (resident bytes เปลี่ยนไปแล้ว) ถ้ายังไม่นั่นค่อยปฏิเสธด้วยข้อความเดิม · ทำได้สองทิศ: โหลดโมเดลแชทอาจกินที่ของ image model และโหลด image model อาจกินที่ของโมเดลแชท (ซึ่งโหลดคืนเองตอนข้อความถัดไป) · log `[governor] released … (X GB) so … can load; it starts again on demand` และบันทึก `lastRelease.code = "MEMORY_MAKE_ROOM"` + ฟิลด์ `for`
- **กับดักที่เจอตอนเขียน (ถ้าพลาดคือ hang ทั้งเซิร์ฟเวอร์):** `runExclusiveLlmOperation()` เป็น **promise queue ไม่ reentrant** และ `startLlm()` ถูกรัน **ข้างใน** คิวนี้ (`runExclusiveLlmOperation(() => startLlm(body))`) → ถ้า make-room ปลด text engine ผ่านคิวเดียวกัน มันจะต่อคิวรอตัวเอง = deadlock · แก้ด้วย `releaseEngine(id, decision, { insideLlmLock })`: เส้นทางโหลด text ส่ง `true` (เรียก `killLlm()` ตรง ๆ ตามแบบที่ arena ทำอยู่แล้ว) เส้นทางโหลด image ส่ง `false` (อยู่นอกคิว → ต่อคิวหลังงานแชทที่กำลังตอบ ไม่ตัดกลางคำตอบ)
- **สิ่งที่ไม่ยอมให้ถูกปลดเพื่อเปิดทาง:** OpenVINO worker — `generateWithOpenVino()` โยน `serviceUnavailable("… Load an OpenVINO NPU model first.")` ไม่ start คืนเอง → `governedEngines()` จึงนับ image เป็น resident เฉพาะ SD backend (`… && !openvinoProc`) · Social Agency — สร้างภาพผ่าน backend เอง (`setImageBackendProvider(() => http://127.0.0.1:${PORT_BACKEND})`) และ **scheduler ถูก start ตอน boot ทุกครั้ง** (`[social-agency] Scheduler active`) → เงื่อนไขเดิม "scheduler running" จะแปลว่าห้ามแตะ image ตลอดชีวิต จึงใช้ `activeCount > 0` (run ค้าง) **หรือ** โพสต์ถัดไปอยู่ภายใน `IMAGE_SCHEDULER_RESERVE_MS` = 10 นาที (tick ทำงานที่เวลาโพสต์จริง ไม่ใช่ล่วงหน้า) · อ่าน state ไม่ได้ = สมมติว่ามีคนอยากใช้ (`catch → true`) · และยัง busy ตอน `backendLoadState.active` / `generationState.active`
- **หน้าต่างที่เซิร์ฟเวอร์มองเห็นการสร้างภาพจริง ๆ (เจอตอนเขียน แล้วใช้เลย):** `Generator.jsx` poll `/api/generation-progress` **ทุก 1 วินาทีตลอดการสร้างภาพ** → route นั้นจึงประทับ `noteEngineUsed("image")` ให้ และ `governedEngines()` นับว่า busy ถ้า poll ล่าสุดอยู่ใน `IMAGE_POLL_GRACE_MS` = 5 วินาที · ผลสองอย่าง: (1) make-room จะไม่ยึด image backend กลางคันขณะที่เบราว์เซอร์กำลังสร้างภาพอยู่ (แม้คำขอจริงจะไม่ผ่านเซิร์ฟเวอร์) และ (2) `idleMinutes` ของ image ใน `/api/backend-status` เป็นค่าจริงเสียที (เดิมเป็น `null` ตลอดเพราะไม่มีใครประทับเวลาให้) · `markBackendReady()` ก็ประทับให้ด้วย เพื่อให้โมเดลที่เพิ่งโหลดเสร็จไม่ถูกนับว่า "ว่างตั้งแต่ไม่เคยใช้" · **ยืนยันจริงใน sandbox:** poll 1 ครั้ง → sweep ถัดมาเห็น `image.busy = true` · ปล่อย 22 วินาทีไม่ poll → sweep เห็น `busy = false, idleMinutes = 0`
- **บั๊กจริงฝั่ง frontend ที่ทำให้การปลด image ปลอดภัยได้:** `Generator.handleGenerate()` เช็ค `/api/backend-status` แล้วเทียบ **settings** เท่านั้นเพื่อตัดสินใจ restart แต่ `killBackend()` จงใจเก็บ `currentSettings` ไว้เพื่อให้ restart ใช้ต่อ → หลังถูกปลด (หรือหลัง crash) settings ตรงกันทุกช่อง โค้ดจึงข้าม restart แล้วยิงเข้า backend ที่ตายแล้ว = error · เพิ่มเงื่อนไขก่อนเทียบ settings: `if (!status.running && !status.ready && !status.loading?.active) needsRestart = true;` (ครอบเคส crash ด้วย) · **ไฟล์นี้คือเหตุผลที่ต้อง `npx vite build` บน Mac**
- เทสต์ `test-resource-governor.cjs` **77 → 118 checks** — ภาค 6 ใหม่ทั้งหมดสำหรับ `planMakeRoom` (ครอบคลุม/ไม่ครอบคลุม, ใหญ่สุดก่อน, busy ห้าม, ไม่ makeRoom ห้าม, flag ที่ไม่มีโปรเซสไม่ใช่แรม, ปิดผู้ว่าฯ = ปิดอันนี้ด้วย) · ภาค 7 ใหม่สำหรับ wiring (รวม deadlock guard, OpenVINO, scheduler reserve, และอ่าน `Generator.jsx` จริงเพื่อ assert เงื่อนไข restart) · eslint ทั้ง tree **0 problems** · `run-all` **147 passed · 5 failed · 1 skipped · 224.1s** (5 ตัวเดิมของสภาพแวดล้อม sandbox) · boot จริงใน sandbox 2 ครั้ง (port 4616/4617, sweep 15 วิ) → status โชว์ฟิลด์ `makeRoom` ของทุก engine และ image `busy: false` เมื่อไม่มีโพสต์ใกล้กำหนด
- **README:** เพิ่ม FAQ "โหลดถูกปฏิเสธเพราะแรม — แอป unload อะไรเองไหม" (อธิบาย all-or-nothing + สิ่งที่ไม่ยอมแตะ + วิธีปิด) และแก้ย่อหน้าที่เคยบอกว่า "ไม่ปลด image backend เลย" ให้ตรงความจริงใหม่

### งานนี้ รอบ 3 (session `arena/01a10a92…`, 2026-10-05 — **push branch แล้ว ยังไม่ merge**) — resource governor: ปลดโมเดลที่ถูกทิ้งไว้เมื่อเครื่องขาดแรมจริง
> เจ้าของงานเลือกข้ามคำถาม policy ("next") → ใช้ตัวเลือกที่แนะนำคือ **B: ปลดเมื่อความดันแรมสูง + เกณฑ์ปรับตาม tier** · นี่คือ GB จริง (รอบ 2 ลดได้แค่ส่วนของแอป = หลักสิบ MB)
- **ปัญหาเดิม:** แอปไม่เคยคืนอะไรเลย — โมเดลแชทค้างในแรมจนกว่าผู้ใช้จะกด unload เอง เครื่องที่ถูกถามคำถามเดียวเมื่อชั่วโมงที่แล้วจึงยังแบก weights หลาย GB ขณะที่ macOS บีบอัดโปรเซสอื่นและเริ่ม swap · มีข้อยกเว้นเดียวคือ arena pool (`idleUnloadMinutes` 45) และ arena พิสูจน์แล้วว่าแพตเทิร์น "ปลดแล้วโหลดคืนเองตอนแชทครั้งถัดไป" ใช้ได้จริง (`arenaReleasedMainModel` → เปลี่ยนชื่อเป็น `releasedMainModel` + ฟิลด์ `releasedBy`/`reason`/`releasedAt` เพื่อให้สองแหล่งใช้ร่วมกันได้)
- **`scripts/server/resource-governor.cjs` (ใหม่, pure ทั้งไฟล์):** `policyFor({tier, overrides})` เกณฑ์ตาม tier (low 10 นาที · mid 20 · high 45 ของเวลา idle; เพดาน swap/compressor/availableRatio ต่างกันตาม tier) + override จาก `app/runtime-state/resource-governor.json` (clamp: ค่าติดลบ/ขยะถูกเมิน, `idleMinutes: 0` = ปิดตัวจับเวลาแต่ critical ยังลงมือ, `enabled: false` = ปิดทั้งผู้ว่าฯ) · `parseMeminfo` / `parseSwapUsage` / `parseCompressorBytes` parser ของสัญญาณจริง · `assessMemoryPressure` → `ok|tight|critical` + เหตุผลเป็นข้อความที่มีตัวเลขให้ผู้ใช้ตรวจได้ · `planRelease` → เลือก engine เดียวที่ idle นานที่สุด (critical ไม่ต้องรอ idle) และ**ห้าม**ปลดเมื่อ `busy` (คำขอค้างอยู่ / arena กำลังรัน) / ไม่ restorable / เล็กกว่า `minimumReleaseGb` (0.5 GB — ปลดแล้วไม่คุ้มโหลดคืน)
- **สัญญาณที่เลือกใช้ (สำคัญที่สุดของการออกแบบนี้):** macOS = swap (`sysctl -n vm.swapusage`) + memory compressor (`vm_stat` "Pages occupied by compressor") — **จงใจไม่ใช้ free+inactive** เพราะมันคือ file cache ไม่ใช่ headroom (ใช้แล้วจะเรียกเครื่องสุขภาพดีว่า tight ทั้งวัน) · Linux = `MemAvailable` + swap จาก `/proc/meminfo` (อ่านไฟล์ ไม่ spawn อะไร) · Windows = **ไม่มีสัญญาณที่ถูกและเชื่อถือได้ → รายงานว่าไม่มีสัญญาณแล้วไม่ยุ่ง** (เดาผิด = แย่งโมเดลจากคนที่กำลังจะใช้) · **swap เป็น lagging signal:** macOS ค้าง swap ไว้หลัง spike จบแล้ว → เกิน `criticalSwapGb` เท่านั้นจึงลงมือเอง ต่ำกว่านั้นเป็นได้แค่หลักฐานเสริมเมื่อสัญญาณ active (compressor/available) แสดงความดันอยู่แล้ว
- **การต่อสายใน serve.cjs:** `sweepResourceGovernor()` ทุก 60 วิ (ไม่ gate กับ telemetry demand เพราะตัวนี้ปกป้องเครื่องตอนทำงาน ไม่ใช่ตอนมีคนดู) · `engineLastUsedAt` + `noteEngineUsed()` ประทับเวลาตอนโมเดลพร้อมใช้, รอบคำขอแชท (นับ `llmRequestsInFlight` ใน try/finally → ห้ามปลดกลางคำตอบ), และรอบ arena · `governedEngines()` แจกแจงทั้ง 5 engine พร้อม `notRestorableBecause` ของตัวที่ไม่แตะ · status ออกที่ `GET /api/backend-status` → `resourceGovernor` (tier/pressure/decision/engines/lastRelease) · sweep ที่พังจะ log warn ไม่ throw (รันบน timer → unhandled rejection จบโปรเซสได้)
- **ยืนยันจริงใน sandbox (Linux):** boot ด้วย `LUKE_RESOURCE_GOVERNOR_FILE=/tmp/gov.json` (`{"sweepMs":15000}`) → status แสดง `tier: "low"`, อ่าน `/proc/meminfo` จริง (`availableRatio 0.88`, `availableGb 3.39`), decision `NO_PRESSURE`, และ engine ทั้ง 5 ตัวพร้อมเหตุผลที่ image/speech/tts ไม่ถูกแตะ · ส่วนการปลดจริงพิสูจน์บน Linux ไม่ได้ (ไม่มี llama backend ใน sandbox) → อยู่ที่เช็กลิสต์ Mac ท้ายหัวข้อ 6
- เทสต์ใหม่ `test-resource-governor.cjs` **77 checks** — parser ทั้ง 3 · เมทริกซ์เกณฑ์ตาม tier · เครื่องสุขภาพดีต้องไม่ถูกแตะ · swap ค้างอย่างเดียวต้องไม่ปลด · critical ไม่รอ idle แต่ busy ห้ามเด็ดขาด · เลือกล่าสุดที่ใช้ก่อน · ตัวเล็กเกินไม่คุ้ม · wiring ใน serve.cjs · และ 1 sweep ตัดสินจริงบนเครื่องที่รันเทสต์ · eslint **287 ไฟล์ 0 problems** · `run-all` **147 passed · 5 failed** (5 ตัวเดิมของสภาพแวดล้อม sandbox)
- **README:** เพิ่ม FAQ 3 ข้อ — "โมเดลแชทปลดตัวเอง" (รวมวิธีปิด/ปรับผ่าน `app/runtime-state/resource-governor.json`) · "VRAM บน macOS น้อยกว่าแรม" · "CPU/ดิสก์ทำงานตอนไม่ได้ใช้แอป"

### งานนี้ รอบ 2 (session `arena/01a10a92…`, 2026-10-05 — **push branch แล้ว ยังไม่ merge**) — ทำให้ตัวแอปเบาขึ้น: ไม่จ่ายค่า AWS SDK ตอน boot + หยุดวัดฮาร์ดแวร์ตอนไม่มีใครดู
> คำขอของเจ้าของงาน: "โปรแกรมกินแรมเยอะไปหน่อย อยากให้ประสิทธิภาพสูงสุดแต่อย่าดึงฮาร์ดแวร์เกินเหตุ เพราะสเปคแต่ละเครื่องไม่เท่ากัน" · **สิ่งแรกที่วัดคือสมมติฐานของตัวเอง แล้วมันผิด:** ตัวเซิร์ฟเวอร์ Node ไม่ใช่ตัวกินแรม — idle ที่ **63 MB RSS / heap 9.4 MB** เท่านั้น · ที่เห็น `RAM 16 / 18 GB` คือน้ำหนักโมเดล (llama.cpp / sd.cpp) + cache ของ macOS เอง · ดังนั้นรอบนี้จึงลด "ส่วนของแอป" ที่ลดได้จริง และหยุดงานพื้นหลังที่ทำไปโดยไม่มีใครใช้
- **`scripts/server/s3-compatible-storage-adapter.cjs` — โหลด AWS SDK เมื่อใช้จริง ไม่ใช่ตอน boot** · เดิม `require("@aws-sdk/client-s3")` + `lib-storage` อยู่หัวไฟล์ และ serve.cjs require adapter นี้ตอน start-up · เปลี่ยนเป็น accessor `s3Sdk()` / `storageSdk()` (7 จุดที่ `new …Command` ใช้ผ่าน accessor) · **วัดด้วย probe เดียวกันทั้งสองฝั่ง** (boot server แล้วทิ้งไว้ 12 วินาที): `89 modules / 77.4 MB RSS / heap 16.0 MB` → **`61 modules / 63.2 MB RSS / heap 9.4 MB`** (−14 MB RSS ≈ −18% · heap −41% · โมดูลหายจากกราฟ 28 ตัว) · ตัว adapter เดี่ยวๆ 25.6 MB → 3.0 MB · ของเดิมทำตามแบบ `work-project-search.cjs` ที่ require jszip/mammoth ในฟังก์ชันอยู่แล้ว · ผลข้างเคียงที่ดี: SDK หาย/พัง จะ fail เฉพาะงาน cloud ไม่ใช่ทั้งเซิร์ฟเวอร์ตอนเปิด
- **`scripts/server/telemetry-demand.cjs` (ใหม่) — วัดฮาร์ดแวร์เฉพาะตอนมีคนดู** · เดิมมีตัว sample 4 ตัววิ่งทุก 5 วินาทีตลอดชีพเซิร์ฟเวอร์: `nvidia-smi`, `vm_stat`, `ps` (ของรอบก่อน) และ **`llama-server --list-devices` ทั้งโปรเซส** (โหลด binary + init Vulkan/CUDA เพื่อพิมพ์เลข 2 ตัวแล้วจบ) — เบราว์เซอร์ปิดก็ยังปลุก GPU stack 17,280 ครั้ง/คืน · `TelemetryDemand` ถือ "มี client ขอ `/api/telemetry` ภายใน 30 วิไหม" (นาฬิกา inject ได้ → เทสต์ไม่ต้องรอจริง) · sampler ทุกตัวเรียก `allow()` ก่อน spawn · **ค่าที่อ่านครั้งล่าสุดถูกเก็บไว้** ไม่ใช่ล้าง → client ที่กลับมาได้คำตอบทันทีแล้วค่อยได้ตัวเลขใหม่ในรอบถัดไป · log บอกตอน pause/resume **อย่างละครั้ง** ไม่ใช่ทุก 5 วิ (ไม่งั้นตัวเลขค้างโดยไม่มีคำอธิบาย = ดูเหมือนพัง) · baseline ตอน boot ยังวัด 1 ครั้ง และ forced sample (หลัง backend โหลดเสร็จ) ยังข้าม gate ได้
- **`/api/telemetry`** — `note()` ทุก request (นี่คือหลักฐานเดียวว่ามีคนดู) + ถ้ากลับมาหลัง pause → `refreshTelemetryNow()` แบบไม่ await (ไม่หน่วงคำตอบด้วย GPU query)
- **`app/frontend/src/App.jsx`** — แท็บที่ถูกซ่อน **หยุด poll** (เดิม poll ทุก 1.5 วิตลอดแม้ไม่มอง) · กลับมาเห็น → ขอทันที 1 ครั้งแล้ว resume · ถอด listener ใน cleanup · ฝั่งเซิร์ฟเวอร์จึงเงียบตามหลัง 30 วิ **ต้อง build frontend ใหม่บน Mac** (`mac.sh` self-heal ให้ หรือ `cd app/frontend && npx vite build`)
- เทสต์ใหม่ 2 ชุด: `test-telemetry-demand.cjs` (32 checks — logic ของ gate + wiring ครบทุก sampler + ฝั่ง frontend) · `test-lazy-cloud-sdk.cjs` (12 checks — สแกนทั้ง `scripts/server` ว่าไม่มี heavy require อยู่หัวไฟล์, require adapter แล้ว `require.cache` ต้องไม่มี `@aws-sdk`, สร้าง instance แล้วก็ยังไม่มี, **แต่เรียกใช้จริงต้องโหลด** — laziness ที่ไม่โหลดอะไรเลยคือฟีเจอร์พัง)
- eslint ทั้ง tree: **285 ไฟล์ · 0 problems**
- **สิ่งที่วัดแล้ว *ไม่ได้* แตะ (ต้องถามเจ้าของงานก่อน เพราะเป็นการแลก UX):** โมเดลหลัก (`llmProc`) และ image backend (`backendProc`) **ไม่เคยถูกปลดเมื่อไม่ใช้** — arena pool มี idle unload 45 นาทีอยู่แล้ว (`idleUnloadMinutes`) และ arena มีกลไก "ปลดโมเดลหลักแล้วโหลดคืนอัตโนมัติ" (`arenaReleasedMainModel` + `restoreReleasedMainModel()`) ซึ่งพิสูจน์แล้วว่าแพตเทิร์น "ปลดแล้วโหลดคืนเอง" ใช้ได้จริงใน production · ส่วน `describeRuntimeConcurrency()` **เตือนอย่างเดียวไม่ห้าม** (`MULTIPLE_HEAVY_MODELS`) → text + image ค้างพร้อมกันได้ นั่นคือที่มาของ GB จริง · ตัวเลือกอยู่ที่เช็กลิสต์ท้ายหัวข้อ 6

### งานนี้ (session `arena/01a10a92…`, 2026-10-05 — **push branch แล้ว ยังไม่ merge**: เจ้าของงานขอดู diff ก่อน) — ชิป VRAM บน macOS อ่านค่าจริง
> อาการที่เจ้าของงานรายงานจากเครื่อง 18 GB M3 Pro: `CPU: 17.6% · RAM: 16 / 18 GB · VRAM: 0.0 / 18 GB` ทั้งที่โหลดโมเดลและสร้างภาพอยู่ · สรุปสั้นๆ: **GPU ทำงานปกติ แต่แอปไม่มีทางอ่านค่ามันบน macOS** — ตัวเลข used จึงค้างที่ 0 เสมอ
- **ต้นเหตุ (ยืนยันจากโค้ด ไม่ใช่การเดา):** `getTelemetry()` มีแหล่งข้อมูล VRAM เพียง 2 ทาง คือ `nvidia-smi` (macOS ไม่มีคำสั่งนี้) และ `llama-server --list-devices` ซึ่ง (ก) `getLlamaTelemetryBackendPath()` ไม่มี branch ของ darwin เลย poll ไม่เคยรัน และ (ข) ถึงเพิ่มก็ไม่มีประโยชน์ เพราะ Metal ตอบ `recommendedMaxWorkingSetSize` เป็น total และ `currentAllocatedSize` **ของโปรเซสที่เรียก** เป็น free → โปรเซส `--list-devices` ที่เพิ่ง spawn เห็นของตัวเอง ~0 MB ไม่ใช่ของ backend ที่รันอยู่ · ส่วน total 18 GB มาจาก `getGpuInfo()` ที่รายงาน unified memory ทั้งก้อนเป็น VRAM
- **`scripts/server/gpu-memory-telemetry.cjs` (ใหม่)** — โมดูล pure: `residentBytesFromPs(output, pids)` บวก RSS (KiB) เฉพาะ pid ของเราจาก listing `ps -axo pid=,rss=` (pid ว่าง = 0 เสมอ ไม่ใช่ "ไม่กรอง" แล้วบวกทั้งเครื่อง) · `gpuMemorySummary({platform, gpuName, totalRamBytes, workingSetGb, ratio, residentBytes})` คืนค่าเฉพาะ darwin (Windows/Linux ยังใช้ nvidia-smi / device list ของ llama.cpp ซึ่งเป็นตัวเลขระดับการ์ดที่แม่นกว่า) · **เพดาน = working set ที่เรียนรู้แล้ว** (`memoryCalibration.workingSetGb()`) ไม่ใช่ total RAM — คือตัวเลขเดียวกับที่ memory planner ใช้ปฏิเสธการโหลด · ยังไม่เรียนรู้ → fallback `unifiedWorkingSetRatio` (0.78) เหมือน planner · **ไม่ clamp used ที่ total** เพราะ used > เพดานคือสัญญาณก่อน `kIOGPUCommandBufferCallbackErrorOutOfMemory`
- **`scripts/server/serve.cjs`** — `pollMetalVram()` ทุก 5 วิ (darwin เท่านั้น): ไม่มี backend รัน → ไม่ spawn `ps` เลย รายงาน 0 กับเพดานจริง · มี → `execFile("ps", PS_ARGS)` argv คงที่ ไม่มี pid ไปโผล่ใน command line (ตรงกฎชุด `test-command-argument-containment`) · `ps` ล้ม → **คงค่าเดิม** ไม่กระพริบเป็น 0 · pid ที่วัด: `llmProc` + `backendProc` (sd.cpp) + `openvinoProc` + ทุก instance ของ arena pool · `getTelemetry()` เรียงลำดับอำนาจใหม่เป็น nvidia → Metal (darwin) → llama device list และเปลี่ยนชื่อตัวแปรเป็น `deviceVram`
- **เทสต์ใหม่ `scripts/validation/test-gpu-memory-telemetry.cjs` (37 checks)** — ส่ง platform เป็นอาร์กิวเมนต์เสมอ จึงพิสูจน์พฤติกรรม macOS ได้บน Linux/CI ตามบทเรียน "ห้ามเทสต์อ่านสภาพเครื่องที่ตัวเองรันอยู่" · มีส่วนที่รัน `ps` จริงบนเครื่องที่รันเทสต์เพื่อยืนยัน parser กับ output จริง · ส่วนที่เหลือ assert การต่อสายใน serve.cjs (รวม assert ว่า `getLlamaTelemetryBackendPath()` **ยังไม่มี** darwin branch และมีคอมเมนต์อธิบายเหตุผลไว้)
- ผลบนเครื่อง 18 GB M3 Pro หลังแก้: `VRAM: 6.7 / 14.3 GB` (ตัวอย่างเมื่อ llama.cpp ถือ 5.2 GB + sd.cpp 1.5 GB) แทน `0.0 / 18 GB`
- **ยังไม่ได้ยืนยันบน Mac จริง** (sandbox เป็น Linux, darwin path ไม่ทำงานที่นี่) — เช็กลิสต์ท้ายหัวข้อ 6

### PR นี้ (session `arena/01a0f582…`, 2026-10-01) — ป้ายรายการ + ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้" + โพสต์ Facebook 2 รูป (ภาพ AI + รูปสินค้า 500px) + ขนาดภาพ 1024×600
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

**ค้างของ session `arena/01a10a92…` (2026-10-06) รอบ 5 — ชิป RAM (branch เดิม push แล้ว ยังไม่ merge):**
- [ ] **build frontend ใหม่บน Mac** (`TopStatusBar.jsx` เปลี่ยน) แล้วดูชิปบนขวา: ต้องเป็นรูปเช่น `RAM: 10 / 18 GB · LUKE 0.1 GB` ตอนยังไม่โหลดโมเดล และตัวเลข LUKE ต้องขยับเมื่อโหลดโมเดล (บวกกับชิป VRAM ที่ขึ้นเช่นกัน)
- [ ] **เทียบข้ามแอป:** เปิด Activity Monitor คู่กัน → ช่อง "Memory Used" ต้องใกล้กับตัวเลขซ้ายของชิป (ต่างกันได้นิดหน่อยเพราะคนละวินาที) · ส่วนต่างระหว่างตัวเลขเครื่องกับตัวเลข LUKE คือเบราว์เซอร์/แอปอื่น/macOS ตามที่ tooltip บอก
- [ ] **hover ชิป RAM** ต้องเห็นประโยคอธิบายส่วนแบ่งของ LUKE (server process + models) และหมายเหตุว่า tab เบราว์เซอร์นับเป็นของเบราว์เซอร์

**ค้างของ session `arena/01a10a92…` (2026-10-05) รอบ 4 — make-room ตอนโหลด + Generator restart (branch เดิม push แล้ว ยังไม่ merge):**
- [ ] **build frontend ใหม่บน Mac เสมอสำหรับรอบนี้** (`Generator.jsx` เปลี่ยน): `cd /Volumes/AI && git fetch origin && git checkout arena/01a10a92-luke-ai-studio-enterprise && git pull && cd app/frontend && npx vite build` แล้ว `bash mac.sh`
- [ ] **ยืนยัน make-room บน Mac (ต้องมีโมเดล 2 ตัวที่รวมกันเกิน working set ~14.3 GB):** โหลด image model ค้างไว้ → โหลดโมเดลแชทตัวใหญ่ที่เคยขึ้น "Not enough memory to load this model" → terminal ต้องขึ้น `[governor] released Image model … (X GB) so … can load; it starts again on demand` และโหลดต่อจนสำเร็จ · `curl -s localhost:8080/api/backend-status | python3 -m json.tool | grep -A8 lastRelease` ต้องเห็น `code: "MEMORY_MAKE_ROOM"` และ `for: "<ชื่อโมเดล>"`
- [ ] **ยืนยันฝั่ง Generator:** หลัง image backend ถูกปลดไปแล้ว (จากข้อบน หรือจงใจทำให้ตายเองก็ได้) → กลับไปที่ Generator แล้วกด Generate **ต้องโหลด backend คืนเอง** (เห็น progress bar ตอน restart) ไม่ใช่ connection refused — นี่คือบั๊กที่แก้ในรอบนี้
- [ ] **ยืนยันว่า Social Agency ไม่ถูกขัด:** ถ้ามีโพสต์ในปฏิทินภายใน 10 นาที → `engines[].image.busy` ต้องเป็น `true` ใน `/api/backend-status` และ make-room ต้องข้าม image (log จะขึ้น `CANNOT_MAKE_ROOM` ถ้าไม่มีอย่างอื่นให้ปลด) · ทดสอบง่ายสุด: ตั้งเวลาโพสต์ให้ถึงใน 5 นาทีแล้วลองโหลดโมเดลแชทตัวใหญ่
- [ ] **ยืนยันว่าไม่ deadlock:** โหลดโมเดลแชทขณะที่มีโมเดลค้างอยู่ต้องจบ (ไม่ hang) — เคสนี้คือกับดัก `runExclusiveLlmOperation` ที่แก้ด้วย `insideLlmLock` ถ้า hang ให้ดูว่า `startLlm` ถูกเรียกนอกคิวจากเส้นทางไหนเพิ่มอีกไหม (ตอนนี้มี 4 จุด: route 2 จุด, `restoreReleasedMainModel()`, และ auto-select ตอน benchmark)
- [ ] **ยืนยันหน้าต่าง 5 วินาทีบน Mac:** เปิด Generator สร้างภาพ 1 ใบ ระหว่างสร้างให้รัน `curl -s localhost:8080/api/backend-status | python3 -m json.tool | grep -A9 '"image"'` → `busy` ต้องเป็น `true` และ `idleMinutes` ต้องเป็นเลข (ไม่ใช่ `null`) · สร้างเสร็จแล้วรอเกิน 5 วินาที → `busy` ต้องกลับเป็น `false` (นี่คือตัวกันไม่ให้ make-room ยึดโมเดลกลางคัน)
- [ ] **ตรวจ OpenVINO (เฉพาะเครื่อง Intel/NPU):** image engine ต้องไม่ถูกนับเป็น resident ขณะใช้ OpenVINO worker (`!openvinoProc`) เพราะ route ของมันไม่ start คืนเอง

**ค้างของ session `arena/01a10a92…` (2026-10-05) รอบ 2 — ทำให้แอปเบาขึ้น (branch เดิม push แล้ว ยังไม่ merge):**
- [x] **ตัดสินใจ policy การปลดโมเดลเมื่อไม่ใช้ — ทำแล้วในรอบ 3** (เจ้าของงานตอบ "next" → ใช้ตัวเลือก B: pressure-based + tier-adaptive + override ได้ใน `app/runtime-state/resource-governor.json`) · เหลือแค่ยืนยันบน Mac ตามข้อล่าง
- [ ] **ยืนยัน governor บน Mac:** ใช้แชท 1 ครั้ง → ปล่อยทิ้งไว้ (หรือเปิดแอปอื่นกินแรมจน swap ขึ้น) → ดู terminal ต้องเห็น `[governor] …releasing Chat model …; it reloads by itself…` แล้ว `curl -s localhost:8080/api/backend-status | python3 -m json.tool | grep -A20 resourceGovernor` ต้องเห็น `pressure.level` เป็น `tight`/`critical` และ `lastRelease` · **ส่งข้อความแชทอีกครั้ง → โมเดลต้องโหลดคืนเอง** และ log ขึ้น `[llm] restored <model>, released by governor (…)`
- [ ] **ตรวจว่าไม่ปลดพร่ำเพรื่อ:** เครื่องที่แรมเหลือเฟือต้องเห็น `decision.code = "NO_PRESSURE"` ตลอด และ swap ค้างจาก spike เก่า (เช่น used 1.5 GB แต่ compressor ต่ำ) ต้อง**ไม่**ทำให้ปลด — เหตุผลต้องขึ้นว่า "swap outlives the spike"
- [ ] **ถ้าอยากปิด:** เขียน `app/runtime-state/resource-governor.json` = `{"enabled": false}` (ไฟล์อยู่ใน runtime-state ซึ่ง gitignore → pull ไม่ชน) · หรือตั้ง `{"idleMinutes": 0}` เพื่อปิดเฉพาะตัวจับเวลา แต่คงการปลดตอน critical
- [x] **ทำให้ image backend ปลดได้อย่างปลอดภัย — ทำแล้วในรอบ 4 แต่คนละแบบกับที่จดไว้:** ไม่ปลดตาม timer (เซิร์ฟเวอร์มองไม่เห็นการสร้างภาพจากเบราว์เซอร์ → วัด idle ไม่ได้จริง) แต่ปลดเมื่อมีโหลดจะถูกปฏิเสธเพราะแรมไม่พอ + แก้ `Generator.jsx` ให้เช็ค `status.running` ก่อนข้าม restart (รายละเอียดในหัวข้อ 2 รอบ 4) · **ส่วนที่จดไว้ว่า `/api/tts/system-speak` ทำให้ tts restorable ได้นั้นผิด:** `synthesizeSystemTts()` ใช้ `say` ของ macOS ไม่แตะ Kokoro และ Kokoro worker ถูก spawn ต่อคำขอ → tts/speech ไม่มีแรมค้างให้คืน
- [ ] **ตัวเลือกเดิมที่ยังไม่ทำ (บันทึกไว้):** (รอบนี้ลดได้แค่ส่วนของแอป ซึ่งวัดแล้วแค่ 63 MB): `A` ไม่ปลดอัตโนมัติเหมือนปัจจุบัน (เตือนอย่างเดียว) · `B` ปลดเมื่อความดันแรมสูง (available ต่ำกว่าเกณฑ์) แล้วโหลดคืนเองเมื่อถูกเรียก · `C` ปลดตามเวลา idle (เช่น 20 นาที) ปรับตาม tier ของเครื่อง · `D` ห้าม text + image ค้างพร้อมกันบนเครื่องแรมน้อย (โหลด image → ปลด text อัตโนมัติ แบบที่ arena ทำอยู่แล้วกับ `arenaReleasedMainModel`) — เครื่องมือมีครบแล้ว: `killLlm()`, `killBackend()`, `restoreReleasedMainModel()`, `evaluateModelMemoryBudget()`, `getHardwareSpecs().tier`
- [ ] **ยืนยันบน Mac:** ปิดแท็บ/ปิดเบราว์เซอร์ → log ต้องขึ้น `[telemetry] nobody has asked … — hardware sampling paused` ภายใน ~30 วิ และ `resumed` เมื่อกลับมา · เปิด Activity Monitor แล้วเช็คว่าไม่มี `vm_stat` / `ps` เกิดทุก 5 วินาทีตอนไม่มีใครดู
- [ ] **ยืนยันว่าตัวเลขไม่ค้าง:** สลับออกจากแท็บ 1 นาทีแล้วกลับมา → ชิปต้องเป็นค่าใหม่ภายใน ~5 วินาที (ไม่ใช่ค่าก่อนไป) เพราะ route เรียก `refreshTelemetryNow()` ให้แล้ว
- [ ] **ยืนยัน cloud storage ยังใช้ได้จริง** (Connectors/Storage → เชื่อม provider → list/upload/download) เพราะ AWS SDK ตอนนี้โหลดตอนใช้ครั้งแรก — ถ้า dependency หาย จะเห็น error ตรงนั้น ไม่ใช่ตอน boot (จงใจ)
- [ ] **build frontend ใหม่หลัง pull** เพราะ `App.jsx` เปลี่ยน (`cd app/frontend && npx vite build` หรือให้ `mac.sh` self-heal)
- [ ] เช็คว่า RSS ตอน idle บน Mac ลดจริงเทียบก่อน/หลัง: `ps -o rss= -p $(pgrep -f serve.cjs)` — บน sandbox Linux วัดได้ 77.4 → 63.2 MB

**ค้างของ session `arena/01a10a92…` (2026-10-05) — ชิป VRAM บน macOS (branch push แล้ว ยังไม่ merge):**
- [ ] **ตัดสินใจว่าจะ merge ไหม** — เจ้าของงานเลือก "แก้ใน sandbox ก่อน ให้ดู diff ยัง merge" · branch `arena/01a10a92-luke-ai-studio-enterprise` อยู่บน origin แล้ว (base = `446d113` = `main`) · ถ้าเอา → เปิด PR → merge → `cd /Volumes/AI && bash sync.sh`
- [ ] **ยืนยันบนเครื่อง Mac เท่านั้น (sandbox เป็น Linux พิสูจน์ไม่ได้):** โหลดโมเดลข้อความ 1 ตัว → ชิป VRAM ต้องขยับจาก `0.0` เป็นค่าจริง และ **total ต้องเป็น working set (~14.3 GB) ไม่ใช่ 18 GB** · ถ้ายังเห็น `0.0 / 18 GB` แปลว่า `app/runtime-state/memory/gpu-working-set.json` ยังไม่ถูกเรียนรู้ (fallback จะเป็น `0.0 / 14.04`) หรือ poll ไม่ได้รัน — grep log ด้วย `ps -axo pid=,rss=` ไม่จำเป็น แต่ตรวจได้ว่า `llmProc.pid` ตรงกับ backend ที่รันอยู่
- [ ] **ตรวจว่าไม่กระทบแพลตฟอร์มอื่น:** บน Windows/Linux ชิปต้องอ่านค่าเดิม (nvidia-smi / llama device list) เพราะ `gpuMemorySummary` คืน `null` เมื่อ platform ไม่ใช่ darwin และ poll ไม่ถูก register
- [ ] **(ถ้าอยากได้ต่อ)** ทำให้ชิประบุว่าเป็น unified memory ใน UI เช่น title `Apple M3 Pro · unified` — ตอนนี้ frontend ยังแสดงคำว่า "VRAM" ตามเดิม และ `ModelManager.jsx` ใช้ `vram_total_gb - vram_used_gb` เฉพาะกรณี `hasNvidiaGpu` จึงไม่กระทบการโหลดโมเดลบน Mac

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
