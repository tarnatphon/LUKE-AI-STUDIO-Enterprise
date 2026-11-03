# Work folder grants — why a saved folder can "lose permission", and the one-click fix

อาการที่เจอบน Mac ตอน `./mac.sh`:

```
[work] restored folder access for this session (project-…): /Users/ekky/Documents/Lumiloo/Open-Generative-AI-main
[work] 1 saved folder(s) could not be granted — open Edit project to pick them again.
[work]   · /Users/ekky/Desktop/Super AI Trader — The selected Work folder is no longer available.
```

ไม่ใช่ error และไม่เกี่ยวกับ online surfaces / free credit — แอปเปิดทำงานได้ปกติ โฟลเดอร์อีกอันยัง restore สำเร็จ

## ทำไมถึงโผล่

| สิ่ง | อยู่ที่ไหน | อายุ |
| :--- | :--- | :--- |
| รายการ `sourceFolders` | browser `localStorage` key `chat_projects` (`App.jsx`) | ถาวร |
| สิทธิ์อ่านโฟลเดอร์ (grant) | **หน่วยความจำของ server** (`work-folder-grants.cjs`) | หายทุก restart |

`stripGrants()` ตัด grant id ทิ้งก่อนเขียนลง storage เสมอ (ไม่งั้นแอปจะหลงเชื่อ id ของ session ที่ตายไปแล้ว) → ทุกครั้งที่เปิดแอป `App.jsx` จึงพยายาม re-grant **ทุก** โฟลเดอร์ที่ project เคยเซฟไว้ ผ่าน `POST /api/work/folder/restore` ถ้าโฟลเดอร์ถูกย้าย/เปลี่ยนชื่อ/ลบ `fs.realpathSync()` จะ fail → server คืน `failed: [{ root, error }]` และพิมพ์ warning **ซ้ำทุกรอบจนกว่า path จะถูกลบออกจาก project**

## สิ่งที่เพิ่มเข้ามา (ปุ่ม Forget missing folders)

`failed` เดิมถูกทิ้งหลังจากพิมพ์ลง console ตอนนี้ถูกเก็บและแสดงผล:

1. `App.jsx` — `recordFailedFolders()` เก็บ `failed` จากทั้ง **restore ตอนเปิดแอป** และ **force restore ตอนโฟกัสหน้าต่าง / เปิด Work** เป็น `failedProjectFolders[projectId]` (trim / dedupe / ไม่สร้าง object ใหม่ถ้าไม่เปลี่ยน)
2. `Sidebar.jsx` → `ChatProjects.jsx` ส่งต่อเข้า Edit project
3. `MissingFoldersBanner.jsx` — แถบสีแดงด้านบน dialog แสดง **ชื่อ path + เหตุผลจาก server ทุกอัน** + ปุ่ม **Forget missing folders** + ข้อความ "Files on disk are not deleted"
4. กดปุ่ม **ครั้งเดียวจบ** (ไม่ต้องกด Save ซ้ำ):
   - `forgetMissingFolders()` (pure helper ใน `work-grants.mjs`) คำนวณ plan: เฉพาะ path ที่ยังอยู่ใน draft และมี failure จริง (กันแถบเด้งกลับมา)
   - `pruneProjectFolders()` ลบออกจาก `sourceFolders` / `folderGrants` / `sessionGrants` ของ project **และเขียนลง `setProjects` ทันที** → localStorage อัปเดต → รอบหน้าไม่มี warning
   - grant id ที่เคยผูกกับ path นั้นถูก `POST /api/work/folder/revoke`
   - เคลียร์ state แถบ + อัปเดต draft/editor ให้แถบหายไปทันที
   - **ไม่แตะไฟล์บน disk** เลย (เป็นการลบ "การอ้างอิง path" ไม่ใช่ลบโฟลเดอร์)

ถ้าโฟลเดอร์ยังอยู่แต่ย้ายที่ → ใช้ **Add folder / Grant folder access** ใน dialog เดิมเลือก path ใหม่แทนได้เลย

## วิธีใช้บน Mac

1. เปิดแอป → สลับเป็นโหมด **Work**
2. ที่ project ใน sidebar กด **⋯ (Edit project)**
3. เห็นแถบ "N saved folders could not be granted" พร้อมชื่อ path
4. กด **Forget missing folders** → แถบหาย → ปิด dialog ได้เลย (ไม่ต้อง Save)

## หลักฐาน

- `node scripts/validation/test-work-grant-restore.cjs` — 56 checks รวม shape ของ `failed` (`root` + `error`) และ pure plan ของการลบ
- `node scripts/validation/test-work-missing-folders-ui.cjs` — 19 checks **render แถบจริงผ่าน Vite SSR** (นับจำนวน, ชื่อ path, เหตุผล, ปุ่มเดียว, singular/plural, empty = ไม่ render, escape `<script>`, editor ยัง render)
- `node scripts/validation/test-frontend-chat-projects.cjs` — wiring App → Sidebar → editor + CSS
- `node scripts/validation/run-all.cjs --include-python --timeout 300 --no-report` → 190 passed / 0 failed

> ⚠️ หลัง `git pull` ต้อง `cd app/frontend && npm install && npx vite build` ทุกครั้ง เพราะ `app/dist/` ถูก gitignore
