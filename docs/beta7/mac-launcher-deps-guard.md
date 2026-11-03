# mac.sh — frontend dependency guard

> "แอปยังบอก Running! อยู่ แต่ `vite build` พัง" — ปัญหาที่เจอบน `/Volumes/AI`

## อาการที่เจอจริง

```
failed to load config from /Volumes/AI/app/frontend/vite.config.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from
  /Volumes/AI/app/frontend/vite.config.js.timestamp-...mjs
```

แต่ `./mac.sh` ยังพิมพ์ `Running!` / `Web UI: http://localhost:1420` เหมือนปกติ และ `npm ci` ที่รันไปก่อนหน้าก็สำเร็จ

## ต้นเหตุ

`mac.sh` เก็บ dependencies ของ frontend ไว้ใน `app/frontend/node_modules_mac` แล้วทำให้ `app/frontend/node_modules` เป็น **symlink** ชี้ไปหามัน (เพื่อให้สลับ `node_modules_linux` / `node_modules_windows` ได้ต้าย้ายโปรเจกต์ข้ามเครื่อง)

ลำดับที่พัง:

1. `npm install` / `npm ci` **ลบ symlink** แล้วสร้าง `node_modules` เป็นโฟลเดอร์จริง (`npm warn reify Removing non-directory .../node_modules`)
2. มีการเปลี่ยนชื่อ/ลบ `node_modules_mac` → symlink เดิมกลายเป็น **dangling link**
3. `mac.sh` เช็ค `[[ -d node_modules && ! -L node_modules ]]` → **false** (ลิงก์ลอย `-d` ไม่ผ่าน) → ข้าม migration
4. `rm -f node_modules` → `mkdir -p node_modules_mac` → `ln -sf node_modules_mac node_modules`
   → **สร้างโฟลเดอร์ว่างขึ้นมาใหม่แล้วชี้ symlink ไปหามัน เงียบๆ ทุกครั้งที่เปิดแอป**

ผล: ไม่มี `vite` ให้ resolve → `npm run build` ตายด้วย `ERR_MODULE_NOT_FOUND` → self-heal ของ `mac.sh` (บรรทัด `npm run build >/dev/null 2>&1`) **กลืน error** → แอปยังขึ้นเพราะ `serve.cjs` เสิร์ฟ `app/dist` ที่ build ค้างไว้ ไม่ต้องการ vite ตอน runtime

บน external drive (`/Volumes/AI`) การ `rm -rf` + `mv` โฟลเดอร์หลายหมื่นไฟล์ซ้ำทุกรอบคือต้นตอ **"โหลดช้ามาก"** ด้วย

## สิ่งที่แก้

| ก่อน | ตอนนี้ |
| :--- | :--- |
| สร้าง symlink ชี้โฟลเดอร์ว่างเสมอ | `has_frontend_deps()` ตรวจ **`vite/package.json` + `vite/bin/vite.js`** ในเป้าหมาย **ก่อน** `ln -sfn` |
| `mkdir -p "$MAC_NODE_MODULES"` ไม่มีเงื่อนไข | ลบออก — ถ้าไม่มี vite จะ **ไม่สร้าง symlink** และตั้ง `FRONTEND_DEPS_INCOMPLETE=1` |
| โฟลเดอร์จริงจาก `npm install` ย้ายทับของดีเสมอ | ย้ายเฉพาะเมื่อโฟลเดอร์นั้นมี vite หรือ `node_modules_mac` ไม่มี vite (ไม่งั้นทิ้งโฟลเดอร์ incomplete แล้วเก็บของดีไว้) |
| เงียบ | พิมพ์ `[deps] ... refusing to link to an empty folder.` |
| ยังพิมพ์ `Running!` ทั้งที่ build Chain พัง | ถ้า **setup จะไม่รัน** (`SETUP_REASON` ว่าง = เครื่องติดตั้งแล้ว) → **`exit 1`** พร้อมคำสั่งซ่อมแบบก็อปปี้ได้ |
| — | fallback ของ filesystem ที่ไม่รองรับ symlink (exFAT/FAT32) ก็ถูกตรวจเช่นกัน |

### ทำไมไม่ห้ามเครื่องติดตั้งใหม่
เช็คเอาท์ใหม่ยังไม่มี dependencies เลย และ `SETUP_REASON` จะถูกเซ็ตอยู่แล้ว (ไม่มี portable Node และ/หรือ ไม่มี `app/dist/index.html`) → `setup.sh` ถูกเรียก → มันสร้าง symlink ของตัวเองแล้ว `npm install --prefer-offline` ใส่เข้าไป → **first-time setup ยังทำงานเหมือนเดิม** guard ข้าม ไม่ `exit`

### ถ้าเจอ error นี้ตอนเปิดแอป
```bash
cd /Volumes/AI/app/frontend
rm -rf node_modules
npm ci                 # ต้องมี npm cache หรือเน็ตครั้งเดียว
cd /Volumes/AI && ./mac.sh
```

## หลักฐาน

`node scripts/validation/test-mac-deps-guard.cjs` — **26 checks** แบ่งเป็น

- static: `bash -n`, guard อยู่ **ก่อน** `ln -sfn`, ไม่เหลือ `mkdir -p "$MAC_NODE_MODULES"`, fatal guard อยู่ **หลัง** `SETUP_REASON` ทุกเงื่อนไขและมี `-z "$SETUP_REASON"`, `setup.sh` ยังลง deps ได้
- **รันโค้ดจริง**: ตัด `mac.sh` ก่อน first-time setup block ไปรันใน throwaway repo บน Linux โดย stub `uname -s` → `Darwin` และ stub `ln` ให้ล้มเหลวเฉพาะตอน probe symlink (จำลอง exFAT)
  - `node_modules_mac` มี vite → link ใช้ได้
  - **dangling symlink → ไม่มี empty symlink เกิดขึ้น** (`FLAG=1`, `LINK=NONE`, `VITE=no`)
  - `node_modules_mac` มีแต่empty → ปฏิเสธเช่นกัน
  - `npm install` สร้างโฟลเดอร์จริงที่มี vite → ถูก migrate + link
  - โฟลเดอร์จริงที่ไม่มี vite **ไม่ลบ** `node_modules_mac` ที่สมบูรณ์
  - fallback exFAT ทั้งสองกรณี

`node scripts/validation/test-mac-launch-files-tracked.cjs` ยังผ่าน (guard ไม่ได้เพิ่มไฟล์ที่ต้องมากับ git)

## หมายเหตุสำหรับ `/Volumes/AI`

- ถ้าจะ `npm ci` / `npm install` ให้ทำ **ก่อน** `./mac.sh` แล้ว `npx vite build` ต่อทันที — อย่าทำหลัง `mac.sh` สร้าง symlink แล้ว
- `app/dist/` ถูก gitignore และ `vite.config.js` ฝัง `git rev-parse HEAD` ลง bundle → **ทุก pull ต้อง build ใหม่**
- external drive ถูกอ่านทั้ง `git`, `node_modules` และ `app/dist` ทุก launch ถ้ายังช้าหลังแก้ ตัวแปรสุดท้ายคือย้าย repo ไป internal SSD
