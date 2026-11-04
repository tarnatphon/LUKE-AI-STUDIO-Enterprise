# เก็บ 4 จุดที่เหลือจาก audit หน้า Settings

> ผู้ใช้เลือกชัด: **เชื่อมฟังก์ชันกลับให้ใช้งาน** + **เชื่อม UI ให้ครบ 11 routes**
> (ตรวจโค้ดจริงพบ **11** routes ไม่ใช่ 9 — มี `recovery-certification/run` เพิ่ม; และ `count={8}`
> แข็งไว้ **2 ที่** คือ Online surfaces กับ Storage locations)

## 1. หัวข้อตาราง `Volume` / `Suggested` สับสน

`StorageLocationsPanel.jsx` แสดงทั้ง "ดิสก์ที่โฟลเดอร์อยู่ตอนนี้" และ "คำแนะนำว่าควรอยู่ดิสก์ไหน"
แต่หัวข้อสั้นเกินจนอ่านไม่ออกว่าเป็นคนละความหมาย → แก้เป็น

| เดิม | ใหม่ | ความหมาย |
| :--- | :--- | :--- |
| `Volume` | **`Current volume`** | ดิสก์ที่โฟลเดอร์อยู่ตอนนี้ (external/internal/unknown) + tooltip |
| `Suggested` | **`Suggested volume`** | คำแนะนำของ LUKE (External/Internal) + tooltip |

## 2. ฟังก์ชัน/คอมโพเนนต์ที่ "หาย" (dead)

| ของ | สถานะเดิม | สิ่งที่ทำ |
| :--- | :--- | :--- |
| `handleBenchmarkTextBackend` | ประกาศไว้ ไม่มีปุ่มเรียก และ `PerformancePanel` ก็ไม่มี benchmark UI | **เชื่อมกลับ**: ปุ่ม *Benchmark text backends* ใน Text Generation (disabled ตอนไม่มี model โหลด / กำลังรัน) |
| `handleThinkingToggle` | ประกาศไว้ ไม่มี switch; `enableThinking` ถูกส่งเข้า `startLlm` แต่ผู้ใช้เปลี่ยนไม่ได้ | **เชื่อมกลับ**: `PremiumToggle` *DeepThink (reasoning mode)* พร้อมคำอธิบายตาม `supportsThinking` |
| `HardwareTierBadge` | มี `specs.tier` ส่งมาจาก server แล้วแต่ไม่เคยแสดง | **เชื่อมกลับ**: แสดงใต้หัวข้อหน้า Settings (ถ้าไม่มี tier จะ return null เหมือนเดิม) |
| `CollapsibleCard` | ถูก `SectionHeader` แทนไปแล้วจริง | **ลบ** component + CSS rules/comments ที่ไม่ใช้ (15 rules ใน `Settings.css` / `App.css`) |

## 3. `count={8}` ที่แข็งไว้ 2 ที่

- **Online surfaces** → `count={ONLINE_SURFACE_SWITCH_COUNT}` (`export const … = SWITCHES.length` จาก `OnlineSurfacesPanel.jsx`)
- **Storage locations** → `count={storageFolderCount}` จาก callback `onFoldersChange` ที่ panel เรียกหลัง `/api/storage/locations` ตอบจริง (ใช้ `useRef` กัน effect วิ่งซ้ำ)
- section ใหม่ **Storage administration** → `count={STORAGE_ADMIN_ACTIONS.length}`

## 4. 11 routes `/api/storage/*` ที่ไม่มี frontend caller

เดิมเป็น API ที่มีอยู่จริงบน server แต่ไม่มีปุ่มในแอป = ฟีเจอร์ที่ผู้ใช้แตะไม่ได้
เพิ่ม **`Storage administration`** (section ใหม่ใน Settings เปิดครั้งแรกอัตโนมัติ) ที่เชื่อมครบทุก route
ในที่เดียว โดยใช้ class/button ที่มีอยู่แล้ว ไม่แตะ 6 panels เดิม ไม่แตะ `serve.cjs`

| # | Route | Method | Payload ที่ UI ส่ง |
| :-- | :--- | :--- | :--- |
| 1 | `/api/storage/status` | GET | — (โหลดอัตโนมัติ) |
| 2 | `/api/storage/resolve` | POST | — |
| 3 | `/api/storage/recovery-certification` | GET | — (โหลดอัตโนมัติ) |
| 4 | `/api/storage/recovery-certification/run` | POST | — |
| 5 | `/api/storage/credentials/status` | POST | `credentialReference` |
| 6 | `/api/storage/credentials/delete` | POST | `providerId`, `credentialReference` |
| 7 | `/api/storage/health/select` | POST | `capability` (default `write`) |
| 8 | `/api/storage/providers/select` | POST | `capability` (default `write`) |
| 9 | `/api/storage/lifecycle/protect` | POST | `path` |
| 10 | `/api/storage/lifecycle/unprotect` | POST | `path` |
| 11 | `/api/storage/watcher/interval` | POST | `intervalMs` (default `60000`, แปลงเป็นตัวเลข) |

- GET read-only โหลดตอนเปิด section; **ทุก action ที่เปลี่ยน state ต้องกดปุ่ม** ไม่มี auto-run
- validate field ที่จำเป็นฝั่ง UI + server ยัง validate/path-containment เหมือนเดิม
- ผลลัพธ์ล่าสุดแสดงใน `<pre>` (ตัด 3,000 ตัวอักษร), error แสดง `role="alert"`
- ไม่เก็บ/ไม่แสดง credential value — ส่งแค่ reference ตามที่ API ต้องการ

## 5. สิ่งที่ล็อกไม่ให้กลับมา

`test-settings-audit-followups.cjs` — **33 checks**:

- หัวข้อใหม่ + tooltip, ไม่เหลือ `>Volume</th>` / `>Suggested</th>`
- ไม่เหลือ `count={8}`, count ทั้ง 3 section มาจากข้อมูลจริง
- handler ทั้งสองมี caller จริง / badge ถูก render / ไม่เหลือ `CollapsibleCard` หรือ CSS ของมัน / CSS ที่ยังใช้ไม่หาย
- **คำนวณ route gaps ใหม่จาก `serve.cjs` + ทุก frontend module → ต้องเป็น `[]`**; panel ประกาศครบ 11 route, method ตรง server, field ตรง payload, ปุ่มมี `data-testid` ทุกตัว
- **SSR render จริง** (Vite, ไม่มี browser): panel ใหม่ render 11 ปุ่ม + หน้า Settings ทั้งหน้า render โดยไม่ throw และมีปุ่ม Benchmark / switch DeepThink / hardware badge / section ใหม่ / ไม่มีหัวข้อซ้ำ

ชุดเดิมที่รันซ้ำแล้วผ่าน: eslint · settings-layout · theme-catalog · settings-storage-ui ·
storage-locations · frontend-api-contract · api-route-methods · bundle-budgets

## 6. บน Mac หลัง merge

```bash
cd /volumes/ai
git fetch origin && git checkout main && git pull --ff-only
./mac.sh          # ปิดแอปให้สนิทก่อน; launcher rebuild dist เอง
```

แล้ว **Cmd+Shift+R** → เปิด **Settings** เลื่อนลงไป **Storage administration** (เปิดอยู่ครั้งแรก)
ลอง *Read destination status* / *Run certification* และดูปุ่มทั้ง 11 ตัว

### ยังรอข้อมูลจากคุณ (ข้อ 1 ของงานนี้)

งาน **"ยืนยันหน้าจอ Mac หลัง PR #91"** ยังทำไม่เสร็จเพราะยังไม่มีภาพ + ผล 5 คำสั่ง health
ส่งมาครับ หลัง pull ครั้งนี้ให้ paste ผลชุดเดิม (ดู [`settings-page-stale-ui.md`](settings-page-stale-ui.md))
พร้อมภาพหน้า Settings มาได้เลย ผมจะอ่านให้ว่า `checkout/bundle/process/stale/restart` ตรงหรือไม่
และหน้าตาหลังแก้ครบ 4 จุดเป็นยังไง
