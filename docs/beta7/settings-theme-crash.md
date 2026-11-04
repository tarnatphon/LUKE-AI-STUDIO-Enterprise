# หน้า Settings ขึ้น "Workspace could not be loaded. ae.map is not a function"

> รายงานจากเจ้าของ (2026-11-04 12:56, หลังอัปเดต `main@f3a7153`): *"not working"* —
> หน้า Settings แสดงเฉพาะกล่อง error ของ `WorkspaceErrorBoundary` พร้อมข้อความ
> `ae.map is not a function` และปุ่ม Retry / Return Home

## 1. ไม่ใช่ bundle เก่า / process เก่า / layout ทับ

- sidebar แสดง `1.0.0-beta.16 · main@f3a7153` → โหลด bundle ล่าสุด (PR #90) แล้ว
- ข้อความ `ae.map is not a function` เป็นชื่อตัวแปรที่ถูก minify ใน production chunk
- การค้นหาใน bundle จริงพบ `ae.map(...)` อยู่ใน `Settings-*.js` ตรงโค้ด **`Color Themes` / `theme-card-btn`**
- เมื่อ render component จริงผ่าน Vite SSR ใน sandbox (ไม่มี browser) ได้ error ชื่อเต็ม:

```
RENDER THREW: THEMES.map is not a function
```

นี่คือ **runtime error ตอน render** → `WorkspaceErrorBoundary` จับและแทนที่ทั้ง workspace ด้วยหน้า error
(ไม่ใช่ stale bundle ที่ PR #89 แก้ ไม่ใช่ stale process และไม่ใช่ flex overlap ที่ PR #90 แก้)

## 2. ต้นตอ 3 ชั้นที่เจอในโค้ด

| # | ปัญหา | ผล |
| :--- | :--- | :--- |
| **1** | `app/frontend/src/themes.js` ส่งออก `THEMES` เป็น **object** (`{ midnightGlass: {...}, ... }`) แต่ `Settings.jsx:1763` และ `TopStatusBar.jsx:169` เรียก `THEMES.map(...)` เหมือน array | เปิด section **Appearance & Themes** หรือกดปุ่มธีมบนแถบสถานะ → throw ทันที |
| **2** | UI ใช้ field `t.bg` / `t.primary` / `t.secondary` / `t.type` แต่ catalog มีแค่ `{ id, name, colors }` | ต่อให้ `.map` ผ่าน การ์ดสีก็จะว่าง / `undefined` |
| **3** | id ใน catalog (`midnightGlass`, `cyberStudio`, `studioMinimal`) **ไม่มี** `html[data-theme="..."]` ใน `App.css` (CSS มี `dark`, `light-nord`, `light-sakura`, `dark-cyberpunk`, `dark-forest`, `dark-dracula`, `dark-oled`) | กดเลือกธีมแล้วสีไม่เปลี่ยนแม้ไม่ error |

ทำไมเพิ่งเจอ: section `Appearance & Themes` ถูกเก็บสถานะเปิด/ปิดใน `localStorage`
(`settings_section_appearance`) ถ้าปิดอยู่จะไม่มีทางเดินโค้ดนี้ → error แฝงอยู่จนกว่าจะมีคนเปิด section
หรือเปิด dropdown ธีม หลังอัปเดต/hard refresh จึงโผล่

## 3. สิ่งที่แก้

| ไฟล์ | แก้ |
| :--- | :--- |
| `themes.js` | คง `THEMES` object เดิมไว้ (compat) แต่เพิ่ม **`THEME_LIST`** = array 8 ธีมที่ id **ตรง CSS จริง** พร้อม `bg/primary/secondary/type` ที่อ่านค่าจาก CSS variables ของ theme นั้น · `DEFAULT_THEME = "dark"` · `canonicalThemeId()` แปลง legacy id → `dark` / `dark-cyberpunk` / `dark-oled` และ id ไม่รู้จัก → default |
| `Settings.jsx` | import + render จาก `THEME_LIST`; `count={THEME_LIST.length}` แทน `count={2}` ที่แข็งไว้ |
| `TopStatusBar.jsx` | import + render dropdown จาก `THEME_LIST`; เพิ่ม prop `initialThemeMenuOpen = false` (ค่าเดิมทุกอย่างเหมือนเดิม ใช้ให้ SSR test เปิด dropdown ได้) |
| `App.jsx` | `document.documentElement.setAttribute("data-theme", canonicalThemeId(theme))` → theme ที่บันทึกไว้ใน localStorage แบบเก่ายังใช้ได้ และทุก id ที่เลือกใหม่มี CSS รองรับ |
| `test-theme-catalog.cjs` | ใหม่ **41 checks**: SSR render จริงของ `Settings` (ไม่ throw + 8 การ์ด + ชื่อครบ + `showHeader={false}` ยัง suppress หัวข้อ), SSR render dropdown เปิด/ปิด, shape ของ catalog, ทุก id มี CSS block, สี swatch ตรง CSS variables, legacy/unknown id resolve, ไม่มี `THEMES.map` ตกค้าง |

ไม่แตะ `serve.cjs` / API / build chain / CSS เดิม

## 4. เช็คบน Mac หลัง merge

```bash
cd /volumes/ai
git fetch origin && git checkout main && git pull --ff-only
./mac.sh          # ปิดแอปให้สนิทก่อน; launcher rebuild dist เอง
```

แล้ว **Cmd+Shift+R** สิ่งที่ควรเห็น:

- หน้า Settings กลับมาแสดงหัวข้อ + runtime dashboard + เนื้อหา Settings (ไม่มีกล่อง `Workspace could not be loaded.`)
- เปิด **Appearance & Themes** → มีการ์ดธีม 8 ตัว พร้อมชื่อและวงกลมสี
- กดเลือกธีม → สีทั้งแอปเปลี่ยนจริง (`<html data-theme="...">` ตรง selector ใน CSS)
- ปุ่มPalette บนแถบสถานะ → dropdown เปิดได้ ไม่พัง
- ค่า `theme` เก่าใน localStorage (เช่น `midnightGlass`) ยังใช้งานได้ ไม่ต้องล้าง cache

ถ้ายังเจอ error ให้ paste ข้อความในกรอบ `load-error-detail` + ผล 5 คำสั่ง health
(ดู [`settings-page-stale-ui.md`](settings-page-stale-ui.md)) มาพร้อมภาพหน้าจอครับ
