# หน้า Setting ไม่เปลี่ยน / ดูผิดปกติ — สาเหตุที่เจอ + วิธีเช็คบน Mac

> รายงานจากเจ้าของ: *"ตรวจสอบแล้วในหน้า Setting ยังไม่ทำงานตามที่ควรจะเป็น ไม่มีอะไร
> เปลี่ยนแปลงตามที่ทำมาล่าสุดในส่วนของหน้า Setting ทุกอย่างยังดูผิดปกติหมด เส้น/เคเบิ้ลหายบาง"*

## สาเหตุ 3 ชั้น (ตรวจพบในโค้ดจริง ไม่ใช่การเดา)

| # | สาเหตุ | อาการ | สถานะ |
| :--- | :--- | :--- | :--- |
| **1** | `Settings.jsx` + `OnlineSurfacesPanel.jsx` เรียก `m3-button-filled` / `m3-button-outlined` **14 จุด** แต่ CSS มีจริงคือ `m3-btn-filled` / `m3-btn-outlined` — และ `.m3-btn-outlined` คือตัวที่ให้ `border: 1px solid` | ปุ่มไม่มีสไตล์ **ขอบ/เส้นหาย** หน้า Settings ดูเพี้ยนมาตั้งแต่ PR #79 | ✅ แก้แล้ว (+ panel ใหม่ใช้ `settings-small-button` ที่ไม่มี → แก้เป็น `m3-btn m3-btn-*`) + เทสต์สแกนว่าทุก class มีนิยามจริง |
| **2** | ถ้า hashed asset `.js/.css` หาย เซิร์ฟเวอร์เดิม **fallback ไป `index.html` แต่คง MIME เป็น JS** → browser พยายาม parse HTML เป็น JavaScript | SPA ไม่บูต **ทุกหน้าดูผิดปกติพร้อมกัน** มักเกิดตอน browser ยังแคช `index.html` เก่าหลัง build ใหม่ | ✅ asset ที่หายตอบ **404 พร้อมข้อความอ่านได้** เฉพาะ SPA route ที่ไม่มีนามสกุลจึงได้ `index.html` |
| **3** | `/api/health` อ่าน commit ของ checkout ใหม่ทุก 15 วิ แต่ **ไม่เคยบอกว่า process `serve.cjs` บูตตอน commit ไหน** → หลัง `git pull` โดยไม่ restart: bundle ใหม่ / API เก่า / health ดูปกติ | "ไม่มีอะไรเปลี่ยน" ทั้งที่ pull แล้ว — panel ใหม่โหลดขึ้นมาแต่ `/api/storage/locations` 404 | ✅ เพิ่ม `process.shortCommit` + `restartRequired` ใน health; panel อธิบาย 404 ว่าให้ quit แล้วเปิด `./mac.sh` ใหม่ |

**เพิ่มเติมเพื่อให้เห็นของใหม่**: section `Storage locations` **เปิดโชว์อัตโนมัติครั้งแรก** ที่เจอ (หลังจากนั้นจำค่าที่คุณเปิด/ปิดไว้เหมือน section อื่น) — ก่อนหน้านี้มันถูกพับอยู่จึงอาจถูกมองว่า "ไม่มีอะไรเปลี่ยน"

---

## ✅ เช็คบน Mac ภายใน 1 นาที (copy-paste ได้เลย)

```bash
cd /volumes/ai
git log --oneline -1
cat app/dist/build-info.json
curl -sS --max-time 5 http://127.0.0.1:1420/api/health | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('source',{}); f=d.get('frontend',{}); p=d.get('process',{}); print('checkout :', s.get('shortCommit')); print('bundle   :', f.get('shortCommit')); print('stale    :', f.get('stale')); print('process  :', p.get('shortCommit')); print('restart  :', d.get('restartRequired'))"
curl -sS -o /dev/null -w 'locations API: %{http_code}\n' http://127.0.0.1:1420/api/storage/locations
grep -l 'Storage locations' app/dist/assets/*.js | head -3
```

### อ่านผล

| ผล | แปลว่า | ทำอะไร |
| :--- | :--- | :--- |
| `checkout` ไม่ใช่ commit ล่าสุด (`aa05e7e` หรือใหม่กว่า) | **ยังไม่ได้ pull** — นี่คือสาเหตุอันดับหนึ่ง | ทำขั้นตอนถัดไป |
| `stale : True` | bundle เก่า | `./mac.sh` ใหม่ (PR #86 rebuild เอง) |
| `restart : True` หรือ `process : None` | เซิร์ฟเวอร์ process ยังเป็นโค้ดเก่า | **ปิดแอปให้สนิท** แล้วเปิด `./mac.sh` ใหม่ |
| `locations API: 404` | API ยังไม่มี = process เก่า | ปิดแอพ + เปิดใหม่ |
| `grep` ไม่ขึ้นชื่อไฟล์ | bundle ไม่มี panel ใหม่ | `./mac.sh` เพื่อ rebuild |
| `checkout = bundle`, `stale : False`, `restart : False`, `locations API: 200` และ `grep` เจอ | ของใหม่ครบแล้ว | **Hard refresh** browser (Cmd+Shift+R) หรือเปิด tab ใหม่ |

> ถ้า `process : None` / `restart : None` แปลว่าเซิร์ฟเวอร์ที่กำลังรันเป็น **เวอร์ชันก่อนหน้า** การแก้ health นี้ยังไม่ได้โหลดเข้าหน่วยความจำ — ต้อง restart อย่างเดียว

---

## วิธีอัปเดตให้ถูกต้อง (สำคัญ: ต้องปิดแอปก่อน)

```bash
cd /volumes/ai
git fetch origin && git checkout main && git pull --ff-only
./mac.sh
```

- `git pull` อย่างเดียว **ไม่พอ** — `serve.cjs` ถูกโหลดเข้าหน่วยความจำตอนสตาร์ท ต้อง quit แล้วรัน launcher ใหม่
- `./mac.sh` จะพิมพ์ ` [dist] bundle was built from ... rebuilding the frontend.` ถ้า stamp ไม่ตรง (PR #86) แล้วตรวจ stamp ซ้ำก่อนเปิดแอป
- **ไม่ต้อง** `npx vite build` เอง / ไม่ต้องย้าย `/volumes/ai` / ไม่ต้องแก้ `node_modules_mac`
- หลังแอปขึ้น ให้ **Cmd+Shift+R** (หรือเปิด tab ใหม่) เพื่อไล่ `index.html` ที่แคชไว้

ถ้าทำครบแล้วยังเพี้ยน ให้ paste ผล 5 คำสั่งข้างบน + ข้อความ `[dist]` / `[storage]` ที่ launcher พิมพ์มาได้เลยครับ

---

## สิ่งที่ถูกล็อกไม่ให้กลับมา

`test-settings-storage-ui.cjs` — **21 checks** รวม **สตาร์ทเซิร์ฟเวอร์จริง**บน throwaway checkout:
ทุก class ปุ่มใน 3 panel มีนิยามใน CSS จริง · `.m3-btn-outlined` ยังมี `border` · section ใหม่เปิดครั้งแรก · health มี process stamp · **asset หาย → 404 ไม่ใช่ HTML** · SPA route ยัง fallback ได้ · bundle จริงเสิร์ฟเป็น JS · `/api/storage/locations` ตอบ 8 โฟลเดอร์ · bundle มีข้อความ `Storage locations` และไม่มี `m3-button-*` ตกค้าง
