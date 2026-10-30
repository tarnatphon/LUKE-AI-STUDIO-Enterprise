# โหลดสองโมเดลพร้อมกัน · แปลชื่อด้วยโมเดลเล็ก · governor ที่มองเห็นและปรับได้

สรุปจาก log ของเครื่อง 18 GB (M3 Pro) ที่โหลด SDXL ใช้เวลา 825 วินาที แล้วระหว่างนั้น
สั่งโหลด Qwen 9B ทับ → swap 5.24 GB, compressor 5.13 GB → governor ปลดโมเดลข้อความทิ้ง
→ ชื่ออังกฤษของสินค้าไม่เคยถูกแปล

แก้สามจุดแยกกัน แต่ต่อกันเป็นเรื่องเดียว: **อย่าโหลดพร้อมกัน · งานเบาใช้โมเดลเบา ·
ถ้า governor ตัดสินใจอะไร ต้องเห็นและปรับได้**

---

## 1. ห้ามโหลดสองโมเดลพร้อมกัน (และนับโมเดลที่ยังโหลดไม่เสร็จ)

**สาเหตุที่ budget เดิมไม่หยุด:** `evaluateModelMemoryBudget()` นับเฉพาะโมเดลที่ *resident*
แล้ว โมเดลที่กำลังอ่านจากดิสก์ยังไม่ตอบ request จึงมีขนาด 0 ในสายตาของมัน — เครื่องเลยดู
"ว่าง" ทั้งที่กำลังแบก 6.6 GB อยู่

สิ่งที่เพิ่ม:

| ไฟล์ | อะไร |
| :--- | :--- |
| `scripts/server/model-load-guard.cjs` | ตรรกะล้วน: `planLoadStart()` / `waitForOtherLoad()` / `inFlightBytes()` |
| `scripts/server/serve.cjs` | `imageModelLoadingBytes` + `llmModelLoadingBytes` ถูกนับใน `residentHeavyModelBytes()`; ก่อนเริ่มโหลดข้อความจะรอภาพ และก่อนเริ่มโหลดภาพจะรอข้อความ |

- **รอ ไม่ใช่ปฏิเสธ** — ปฏิเสธจะดูเหมือนแอปพัง การรอ 1–5 นาทีไม่มีใครเห็น
- รอได้สูงสุด **5 นาที** (ปรับได้ด้วย env `LUKE_MODEL_LOAD_WAIT_MS`, `0` = ไม่รอเลย)
- รอจนหมดเวลาแล้ว **เริ่มอยู่ดี** พร้อม log บรรทัดเดียวว่าทำไม — backend ที่ค้างต้องไม่ทำให้แอปค้างตาม
- log: `[llm] the image model is loading (6.6 GB) — waiting up to 5 min so both do not load at once`

## 2. งานแปลชื่อใช้โมเดลเล็ก

การแปลชื่อสินค้าไทย→อังกฤษคือ ~80 token ของงานพจนานุกรม ไม่ต้องใช้โมเดล 9B

| ไฟล์ | อะไร |
| :--- | :--- |
| `scripts/server/background-llm.cjs` | `chooseBackgroundModel()` + `createBackgroundLlmClient()` |
| `app/config/social-agency/background-model.json` | `enabled`, `maxSizeGb` (3.2), `minSizeGb`, `preferredModel` |
| `scripts/server/serve.cjs` | `makeSocialAgencyLlmClient()` ส่งงาน `purpose: "translate"` ไปที่ client นี้ |
| `scripts/server/social-agency-runtime.cjs` | `_llmTranslateForPrompt()` ส่ง `purpose: "translate"` |

กติกา:

1. **ตัวเล็กสุดที่โหลดไว้** และไม่เกิน `maxSizeGb` (ข้าม `mmproj`) — 3B Q4 ≈ 2 GB อยู่ข้าง SDXL ได้
2. `preferredModel` ที่ผู้ใช้ตั้งเองชนะ ถ้ามีไฟล์นั้นจริง
3. โหลดผ่าน **arena pool** (llama-server ของตัวเอง คนละ port) — ไม่ปลดโมเดลแชท และไม่เปลี่ยน
   โมเดลแชทที่ผู้ใช้เลือก; pool ปลดเองเมื่อ idle ตามนโยบายเดิม
4. **บทสนทนายังเป็นของโมเดลแชท** — เฉพาะ request ที่ระบุ `purpose: "translate"` เท่านั้นที่ถูกเปลี่ยนเส้นทาง
5. โหลดไม่ได้/ไม่มีไฟล์ → ถ้าโมเดลแชทพร้อมก็ใช้ตัวนั้นต่อ พร้อม log ครั้งเดียว/นาที; ถ้าไม่มีอะไรเลยก็โยน error
   (ไม่คืนค่าว่างเงียบ ๆ — หน้าสินค้าจะขึ้น "แปลอัตโนมัติไม่ได้")
6. โหลดครั้งเดียวใช้ได้ทุกคำ (`ensureLoaded` ถูกเรียกครั้งเดียวต่อรอบ)

ดูว่าตัวไหนถูกเลือก: `GET /api/background-model`

## 3. Governor ที่มองเห็นและปรับได้

| ไฟล์ | อะไร |
| :--- | :--- |
| `scripts/server/resource-governor-settings.cjs` | field ที่แก้ได้ + validate + อ่าน/เขียนไฟล์ |
| `scripts/server/serve.cjs` | `GET`/`POST /api/resource-governor` |
| `app/frontend/src/components/GovernorSettingsCard.jsx` | การ์ดใน Settings → Performance |
| `app/frontend/src/components/PerformancePanel.jsx` | ต่อ fetch + save/reset |

การ์ดบอกสามอย่าง: **ตอนนี้เครื่องเป็นอย่างไร** (level + เหตุผลจริงจาก `assessMemoryPressure`),
**governor ตัดสินใจอะไรล่าสุด**, และ **ตัวเลขที่ใช้ตัดสิน** (แก้ได้ทีละช่อง)

ค่าที่แก้ได้: `enabled`, `idleMinutes`, `minimumReleaseGb`, `criticalSwapGb`, `tightSwapGb`,
`criticalCompressorGb`, `tightCompressorGb`, `availableRatioTight`, `availableRatioCritical`, `sweepMs`

กติกาการบันทึก:

- เก็บเฉพาะ key ที่ governor รู้จัก — key แปลก ๆ ถูกปฏิเสธพร้อมเหตุผล (ทั้งจาก API และจากไฟล์ที่แก้ด้วยมือ)
- ค่าที่เป็นไปไม่ได้ (ติดลบ, ratio > 1, `critical < tight`) **ไม่ถูกบันทึก** และบอกว่าทำไม
- override คือ "สิ่งที่ผู้ใช้เปลี่ยน" เท่านั้น — ที่เหลือมาจาก tier ของเครื่อง (`low`/`mid`/`high`)
- `null` = คืนช่องนั้นให้ค่า default; `{ reset: true }` = ลบไฟล์ override ทั้งไฟล์
- ไฟล์จริง: `app/runtime-state/resource-governor.json` (ไม่อยู่ใน git)
- `sweepMs` มีผลเมื่อเริ่มแอปครั้งถัดไป (interval ถูกตั้งตอนบูต); ค่าอื่นมีผลรอบ sweep ถัดไป

## เทสต์

```bash
node scripts/validation/test-model-load-guard.cjs             # 11 checks
node scripts/validation/test-background-llm.cjs               # 14 checks
node scripts/validation/test-resource-governor-settings.cjs   # 18 checks
```

- **model-load-guard**: นับ in-flight · รอแล้วเริ่มต่อ · หมดเวลาแล้วเริ่มพร้อมเตือน · ปิดการรอ ·
  loop จริงด้วยนาฬิกาปลอม · สายไฟใน `serve.cjs` (ข้อความรอภาพ / ภาพรอข้อความ / in-flight ถูกเคลียร์)
- **background-llm**: เลือกตัวเล็กสุด · ข้าม mmproj · เพดานต่ำไป = ไม่เลือก · preferred ชนะ ·
  งานแปลไม่แตะโมเดลแชท · บทสนทนาไม่ถูกเปลี่ยนเส้นทาง · fallback · โหลดครั้งเดียว ·
  เริ่มได้แม้โมเดลแชทไม่โหลด · ส่ง `purpose`
- **resource-governor-settings**: validate ทุกแบบ · merge/null/reset · กรองไฟล์ที่แก้มือ ·
  describe ตรงกับ policy จริง · route มีจริง · SSR ของการ์ด (level, เหตุผล, ค่าที่แก้, reset, สถานะว่าง)
