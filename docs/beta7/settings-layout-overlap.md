# หัวข้อ Settings แทรกกลางการ์ด Runtime cache — ทั้งที่ health ปกติ

> รายงานจากเจ้าของ: *"run cache มี Setting แทรกอยู่ตรงกลาง"* — ในภาพหน้า Settings
> (`localhost:1420`) ข้อความ **Settings & Parameters** ไปทับตัวเลข `0 B` ของการ์ด
> **Runtime cache** และปุ่ม `ทำความสะอาด` ไปอยู่ใต้บรรทัด subtitle

## 1. ผล 5 คำสั่ง health ที่ paste มาจาก Mac (2026-11-04 12:03)

```
checkout : aafccf4
bundle   : aafccf4
stale    : False
process  : aafccf4
restart  : False
```

sidebar ก็แสดง `1.0.0-beta.16 · main@aafccf4` + **`ตรงกับซอร์ส`** (เขียว) และปุ่ม/ขอบการ์ด
มีเส้นครบ

| สิ่งที่ตรวจ | ผล | สรุป |
| :--- | :--- | :--- |
| `bundle` ≠ `checkout` หรือ `stale : True` | ไม่เจอ | **ไม่ใช่ bundle เก่า** และไม่ใช่ `app/dist` ที่ build ไม่ตรงซอร์ส |
| browser cache `index.html` เก่า | `ตรงกับซอร์ส` ใน `build-info.mjs` เปรียบเทียบ stamp ใน JS ที่กำลังรันกับ `health.frontend.commit` → ผ่าน | **ไม่ใช่ tab ที่โหลด JS เก่า** |
| `process` ≠ `checkout` หรือ `restart : True` | `aafccf4` / `False` | **ไม่ใช่ process `serve.cjs` เก่า** — API/health เป็นโค้ดล่าสุด |
| `/api/storage/locations` 404 | ไม่มี (ของใหม่ครบ) | ไม่ใช่กรณี pull แล้วไม่ restart |

> ⚠️ **กับดักที่เจอ**: ข้อความ `ตรงกับซอร์ส` ใน sidebar **ไม่ได้ตรวจ process** —
> `diagnoseBuild()` (`app/frontend/src/lib/build-info.mjs`) ดูแค่ bundle ↔ dist ↔
> `health.source` ส่วน `restartRequired` มาจาก `PROCESS_SOURCE` ที่อ่านครั้งเดียวตอนบูต
> (`scripts/server/serve.cjs`) ดังนั้นเวลา pull แล้วไม่ restart จะได้ sidebar เขียว +
> `restart : True` ได้ ต้องอ่านบรรทัด `process` / `restart` เสมอ ไม่ใช่ดูสีเขียวอย่างเดียว

เมื่อทั้งสองฝั่งปกติ **ตำแหน่งของหัวข้อจึงต้องมาจาก JSX/CSS ใน bundle ที่โหลดใหม่แล้ว** —
process เก่ากระทบแค่ API/health ไม่มีทางย้าย DOM

## 2. ต้นตอจริง (โค้ด `aafccf4`)

แท็บ `settings` ใน `App.jsx` render สอง sibling เป็น **direct flex children** ของ
`.workspace-panel`:

```jsx
<WorkspacePanel tab="settings" ... overflow="auto">
  <div className="runtime-dashboard-shell">… RuntimeDownloadDashboard + TextModelManager …</div>
  <Settings … />   {/* root = .workspace-area */}
</WorkspacePanel>
```

ร่วมกับ CSS เดิม:

```css
.workspace-panel       { flex: 1 1 0; height: 0; overflow: hidden; flex-direction: column; }
.runtime-dashboard-shell { overflow: visible; }        /* global, LUKE_SETTINGS_SCROLL_FIX */
.workspace-area        { flex: 1; overflow-y: auto; }  /* nested scroll box */
```

1. flex column ความสูงจำกัด **หด** `.runtime-dashboard-shell` ให้เตี้ยกว่าการ์ดจริง
2. `overflow: visible` ปล่อยการ์ด cleanup **วาดล้นออกมา**ใต้กล่องที่ถูกหด
3. `.workspace-area` เปิด scroll ซ้อนอีกชั้น และหัวข้อ `Settings & Parameters` ถูก paint
   **ทีหลัง** → ทับกลางการ์ด Runtime cache พอดีตามภาพ (หัวข้อทับ `0 B`)

นี่คือ layout overlap ไม่ใช่ stale bundle/process → `Cmd+Shift+R`, rebuild หรือ restart
อย่างเดียว **ไม่มีทางหาย**

## 3. สิ่งที่แก้

| ไฟล์ | แก้ |
| :--- | :--- |
| `App.jsx` | `WorkspacePanel` ใส่ `data-tab={tab}` เพื่อ scope CSS · แท็บ settings มีหัวข้อ `Settings & Parameters` เป็น element **แรก** · ส่ง `showHeader={false}` ให้ `<Settings>` |
| `Settings.jsx` | เพิ่ม prop `showHeader = true` และ wrap หัวข้อด้วย `{showHeader && …}` → standalone render ยังมีหัวข้อ, แท็บ settings ไม่ render ซ้ำ |
| `App.css` | แทน global `.runtime-dashboard-shell { overflow: visible }` ด้วยบล็อก `LUKE_SETTINGS_LAYOUT_FIX` ที่ scoped `[data-tab="settings"]`: children `flex: 0 0 auto` (ไม่หด), `.workspace-area { overflow: visible }` (ไม่มี scroll ซ้อน), หัวข้อได้ padding 28px เดียวกับเนื้อหา → **panel (`overflow="auto"`) เป็น scroll container เดียว** |
| `scripts/validation/test-settings-layout.cjs` | ใหม่ **41 checks**: โครงสร้าง DOM, ลำดับหัวข้อ, `showHeader` gating, CSS cascade ที่อ่านค่าจริง, จำลอง flex ทั้งแบบเก่า (reproduce overlap) และแบบใหม่ 3 ขนาดหน้าจอ (ไม่ทับ + ยังเลื่อนได้), และเช็คว่า tab อื่นไม่ถูกกระทบ |

 scoped เฉพาะ settings tab → Chat / Generator / AI Library / Speech ยังใช้ scroll เดิมได้
ไม่ต้องแตะ `serve.cjs`, API หรือ build chain

## 4. เช็คบน Mac หลัง merge

```bash
cd /volumes/ai
git fetch origin && git checkout main && git pull --ff-only
./mac.sh          # ต้องปิดแอปให้สนิทก่อน (PR #86 rebuild dist เอง)
```

แล้ว **Cmd+Shift+R** สิ่งที่ควรเห็น:

- `Settings & Parameters` อยู่ **บนสุด** ของหน้า (ไม่มีข้อความโผล่กลางการ์ด Runtime cache)
- การ์ด `Runtime cache` แสดง `0 B` / path / ปุ่มทำความสะอาดได้เต็ม ไม่มีตัวอักษรทับ
- scrollbar **เดียว** เลื่อนผ่านหัวข้อ → runtime dashboard → เนื้อหา Settings

ถ้ายังทับ ให้ paste ผล 5 คำสั่ง health + ข้อความ `[dist]`/`[storage]` ที่ launcher พิมพ์
(ดูชุดคำสั่งใน [`settings-page-stale-ui.md`](settings-page-stale-ui.md)) มาพร้อมภาพหน้าจอครับ

---

## ถัดมา: หน้าโหลดไม่ขึ้นเลย (`ae.map is not a function`)

หลัง PR #90 เจ้าของเจอ `Workspace could not be loaded. ae.map is not a function` แทน —
นั่นเป็น **runtime error ตอน render** จาก `THEMES.map` (catalog เป็น object ไม่ใช่ array)
ไม่ใช่ layout/stale อีกต่อไป ดูการ reproduce ใน sandbox และการแก้ทั้งระบบธีมที่
[`settings-theme-crash.md`](settings-theme-crash.md) (`test-theme-catalog.cjs` **41 checks**)
