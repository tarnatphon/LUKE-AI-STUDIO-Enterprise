# ARENA_HANDOFF.md — บันทึกส่งต่องานระหว่าง session

> **อัปเดตล่าสุด:** 2026-09-27 (session `arena/01a0df14-luke-ai-studio-enterprise`)
>
> **วิธีใช้ไฟล์นี้:** ท้ายทุก session ให้แก้หัวข้อ "งานค้าง" ด้านล่าง แล้ว **commit + push ให้เรียบร้อย**
> ทุก session ของ Arena จะ clone ใหม่จาก `main` เสมอ — ไฟล์หรือโค้ดที่ไม่ได้ push จะ**ไม่ตามมา** session ถัดไป

---

## 1. สถานะปัจจุบัน

| รายการ | ค่า |
|---|---|
| `main` | `1a2286d` — merge PR #10 (2026-09-26) |
| เวอร์ชัน | `1.0.0-beta.16` (`app/version.json`, tag `v1.0.0-beta.16`) |
| PR ที่เปิดค้าง | ไม่มี |
| งานค้างที่ทราบ | ไม่มี (ดูหัวข้อ 6) |

---

## 2. งานล่าสุดที่เข้า `main` — PR #10 (2026-09-26)

1. **Luke AI Workflow builder** (workspace ใหม่) — ต่อ AI หลายขั้นเป็นสายงานเดียว
   Chat (LLM) → สร้างภาพ → TTS → STT → จัดข้อความ → เงื่อนไข → ผลลัพธ์, ตัวแปร `{{input}}` / `{{ชื่อโหนด}}`
   Backend: `scripts/server/ai-workflow-runtime.cjs` (`/api/ai-workflow/*`)
2. **รูปสินค้าจากเว็บตาม SKU → ใช้เป็น Reference ตอนสร้างภาพปฏิทิน**
   - ปุ่ม "ดึงรูปสินค้าจากเว็บ" (ทั้งชุด/รายตัว) ดึง og:image / JSON-LD / รูปใหญ่สุด แล้วเก็บในเครื่อง
   - ปุ่ม "🎲 สุ่ม 1 สินค้า/วัน" ดึงรูปมาพร้อมสินค้าอัตโนมัติ
   - รูปสินค้าถูกแนบเป็น Reference (Appearance Lock) ตอนสร้างภาพโพสต์ — เปิด/ปิดได้ใน Settings ของลูกค้า
   - รูป demo 10 รูปฝังใน `app/config/social-agency-seeds/`
3. **Social Agency › Workflow tab** — โหนด "คะแนนไวรัล", ปุ่มรันเลย/อนุมัติ/ยกเลิก, ตัวกรองประวัติ, progress bar, export รายงาน

PR ก่อนหน้า (merge แล้วทั้งหมด): #4 Social Agency v2.3 · #5 release beta.16 · #6 validation 87/87 · #7 fix live publish · #8 Thai prompt auto-translate · #9 English-native imagePrompt

---

## 3. ⚠️ หลัง `git pull main` บนเครื่องจริง ต้อง build frontend ใหม่เสมอ

`app/dist/` **ไม่อยู่ใน git** — ถ้าไม่ build จะเห็น UI เวอร์ชันเก่า

```bash
git checkout main && git pull
cd app/frontend && npm install && npx vite build
# แล้วรัน server ตามปกติ: mac.sh / linux.sh / windows.bat
```

---

## 4. สถานะ branch อื่นบน GitHub (ตรวจเมื่อ 2026-09-27)

| branch | สถานะ | ควรทำ |
|---|---|---|
| `arena/01a03c94…`, `01a065e2…`, `01a08988…`, `01a08f7a…`, `01a09e4b…`, `01a0de84…` | merge เข้า `main` ครบแล้ว (`ahead_by = 0`) | ลบได้ |
| `backup/volumes-ai-20260914` | WIP จากเครื่อง local 14 ก.ย. (งาน image-to-video สำหรับโพสต์ Social Agency: `videoJob`, `setImageToVideoJobs`, progress bar) — **โค้ดทั้งหมดอยู่ใน `main` แล้วในรูปแบบที่พัฒนาต่อยอด** (ตรวจทีละบรรทัด: ~540 บรรทัดที่เพิ่ม พบครบ ยกเว้น 6 บรรทัดที่ `main` แก้ต่อ เช่น `_imageGenBody(prompt, ref)` รองรับรูปสินค้าอ้างอิง) ส่วนที่เหลือใน diff เป็น `app/dist/` และ `app/runtime-state/` ซึ่ง gitignore แล้ว | **ห้าม merge** — ลบได้ |

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

_(ไม่มีงานค้างจาก session ก่อน — เพิ่มรายการที่นี่ก่อนจบ session)_

**ข้อเสนอแนะ (ยังไม่ได้ทำ, รอตัดสินใจ):**
- [ ] ลบไฟล์สำรองจากการ patch ที่หลุดเข้า git (~1.3 MB, 15 ไฟล์): `*.p5w-orig`, `*.p5w2-orig`, `*.p5x-orig`, `*.p5y-orig`, `*.p5z-orig` ใน `app/frontend/src/…` และ `scripts/server/…` รวมถึง `p5w-audit.txt`, `p5w-dump.txt` ที่ root
- [ ] ลบ branch `backup/volumes-ai-20260914` และ arena branch เก่าที่ merge แล้ว (ตารางข้อ 4)
