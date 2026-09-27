# ARENA_HANDOFF.md — บันทึกส่งต่องานระหว่าง session

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
| `main` | ดู sha ล่าสุดด้วย `git log -1 --oneline main` — ณ 2026-09-27 มี PR #12 (เก็บกวาด repo) และ PR #13 (sync ไฟล์นี้) merge แล้ว |
| เวอร์ชัน | `1.0.0-beta.16` (`app/version.json`, tag `v1.0.0-beta.16`) |
| PR ที่เปิดค้าง | **#20** — `ci/validation-workflow` → `main` (CI + ตัวรันชุดเทสต์ + แก้บั๊ก 503) — **CI เขียวแล้ว รอ merge** · PR #17 merge เป็น `940565e` แล้ว |
| branch อื่นบน GitHub | `main` + `ci/validation-workflow` (PR #20) · หลัง merge ให้ลบ branch ทิ้ง |
| งานค้างที่ทราบ | ดูหัวข้อ 6 — เหลือแก้บั๊กจริง 3 รายการจาก `ci-baseline.json` |

---

## 2. งานล่าสุดที่เข้า `main`

### PR #20 (2026-09-27) — CI + ตัวรันชุดเทสต์ (รอ merge — CI เขียวแล้ว)
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

**ข้อเสนอแนะรอบหน้า (ยังไม่ได้ทำ):**
- [ ] **ปิดงานรอบนี้ให้จบ** — merge PR #20 เข้า `main` แล้วลบ branch `ci/validation-workflow`
- [ ] แก้ 3 เรื่องที่เป็น**บั๊กโค้ดจริง** ใน `ci-baseline.json` (link safety, `validate-release.sh`, `test-config-write-fixed-point`)
- [ ] แก้ชุดที่เป็น**บั๊กเทสต์** — `test-route-declarations.cjs` · `test-sync-script.cjs` (เขียนไฟล์โดยไม่สร้างโฟลเดอร์ก่อน)
- [ ] ตัดสินใจเรื่องสภาพแวดล้อม — จะเอา `app/runtimes/`, `releases/` และการตรวจ file permission ออกจากขอบเขตเทสต์ CI ไหม
- [ ] ทำให้ `chmod` ใน `work-github.cjs` ล้มเหลวแบบดังกับข้อมูล แทนที่จะกลืนทิ้งใน `catch {}` — token ไม่ควรถูกเขียนแบบอ่านได้โดยไม่บอกผู้ใช้
