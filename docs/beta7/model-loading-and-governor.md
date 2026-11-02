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

### บอกให้เห็นว่า "ยังไม่มีโมเดลเล็ก"

เครื่องที่ไม่มี GGUF เล็กเลยจะยังใช้โมเดลแชทแปลชื่ออยู่ — ต้องพูดออกมา ไม่ใช่เงียบ

| ไฟล์ | อะไร |
| :--- | :--- |
| `social-agency-runtime.cjs` | `setBackgroundModelProvider()` + `subjectAutofillStatus().backgroundModel` (ตอบกลับเท่านั้น ไม่ถูกเขียนลงไฟล์ข้อมูล) |
| `scripts/server/serve.cjs` | ฉีด `() => makeSocialAgencyLlmClient().status()` ตอนสร้าง runtime |
| `ProductsTab.jsx` | แถวที่ยังขาดชื่ออังกฤษบอกตรง ๆ: *"ยังไม่มีโมเดลเล็กระดับ 2–3 GB — งานแปลชื่อจึงใช้โมเดลแชท … โหลดได้ที่ Settings → Text Models"* และเมื่อมีแล้วจะบอกชื่อ+ขนาดที่ใช้แปล |
| `BackgroundModelCard.jsx` | การ์ดใน Settings → Performance: เลือกแล้ว (ชื่อ+ขนาด+เหตุผล) / ยังไม่มี (เพดาน + ทางแก้) / ปิดไว้ / กำลังอ่าน |

provider ที่ throw จะได้ `backgroundModel: null` แล้วหน้าจอยังทำงานต่อ (ไม่ล้มทั้งหน้า)

### ทางออกในคลิกเดียว

บอกว่ามีปัญหาแล้วปล่อยให้ไปหา GGUF เองบนอินเทอร์เน็ต คือตอบครึ่งเดียว — แอปมีแคตตาล็อก
ที่เซ็นแล้วและคิวดาวน์โหลดอยู่แล้ว

- `scripts/server/background-model-suggestion.cjs` เลือก **ตัวเล็กสุดในแคตตาล็อก** ที่ยังไม่โหลด,
  อยู่ในเพดาน และเครื่องมี RAM พอ (`minimumRamBytes` + reserve) — ฟังก์ชันบริสุทธิ์ ทดสอบได้โดยไม่ต้องมีไฟล์
- `GET /api/background-model` แนบ `suggestion: { modelId, variantId, filename, label, sizeGb }` (หรือ `null` + `suggestionReason`)
- การ์ดในหน้า Performance มีปุ่ม `Download <ชื่อ> (<GB>)` → `POST /api/text-models/download-queue`
  (คิว/เช็กซัม/แถบความคืบหน้าเดิมของ Text Models) **ไม่มีอะไรถูกโหลดเองโดยไม่กด**
- ไม่มีอะไรให้เสนอ → ไม่มีปุ่ม แต่บอกเหตุผล

### ติดตามดาวน์โหลดจากที่เดียวกับที่กด

กดแล้วต้องไปดูอีกแท็บว่าจะเสร็จเมื่อไร — เป็นความสับสนแบบเดียวกับที่ทำให้ทั้งเรื่องนี้เริ่มต้น

- `describeDownload(items, suggestion)` (ใน `background-model-suggestion.cjs`) จับคู่ด้วย
  `modelId`+`variantId` แล้วคืน `state / percent / bytes / speed / queuePosition / error`
  — ถ้า `percent` ไม่มา ก็คำนวณจากไบต์ และไม่เกิน 100
- `GET /api/background-model` แนบ `download` มาด้วย
- การ์ดในหน้า Performance แสดงแถบความคืบหน้า + บรรทัดเดียวรู้เรื่อง
  (`Queued (position 2)` · `Downloading 42% · 870 MB of 2 GB · 12 MB/s` ·
  `Downloaded — translations use it from the next product name` · error ของจริง)
- หน้า Performance poll ทุก 3 วินาที **เฉพาะตอนที่ยังดาวน์โหลดอยู่** และหยุดเองเมื่อจบ

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
node scripts/validation/test-model-load-guard.cjs             # 12 checks
node scripts/validation/test-background-llm.cjs               # 17 checks
node scripts/validation/test-resource-governor-settings.cjs   # 18 checks
node scripts/validation/test-background-model-ui.cjs          # 7 checks
node scripts/validation/test-background-model-download.cjs    # 20 checks
```

- **model-load-guard**: นับ in-flight · รอแล้วเริ่มต่อ · หมดเวลาแล้วเริ่มพร้อมเตือน · ปิดการรอ ·
  loop จริงด้วยนาฬิกาปลอม · สายไฟใน `serve.cjs` (ข้อความรอภาพ / ภาพรอข้อความ / in-flight ถูกเคลียร์)
- **background-llm**: เลือกตัวเล็กสุด · ข้าม mmproj · เพดานต่ำไป = ไม่เลือก · preferred ชนะ ·
  งานแปลไม่แตะโมเดลแชท · บทสนทนาไม่ถูกเปลี่ยนเส้นทาง · fallback · โหลดครั้งเดียว ·
  เริ่มได้แม้โมเดลแชทไม่โหลด · ส่ง `purpose`
- **resource-governor-settings**: validate ทุกแบบ · merge/null/reset · กรองไฟล์ที่แก้มือ ·
  describe ตรงกับ policy จริง · route มีจริง · SSR ของการ์ด (level, เหตุผล, ค่าที่แก้, reset, สถานะว่าง)
- **background-model-ui**: SSR ของแท็บ สินค้า (ยังไม่มีโมเดลเล็ก / มีแล้ว / ไม่มีชื่อขาด) และ
  การ์ดในหน้า Performance ทั้งสามสถานะ
- **background-model-download**: เลือกตัวเล็กสุด · ข้ามที่โหลดแล้ว (รวม path) · RAM ไม่พอ = ไม่เสนอ ·
  ไม่มีอะไร fit = ไม่มีปุ่มแต่มีเหตุผล · แคตตาล็อกจริงมีตัวที่ fit · route/ปุ่มผูกกับคิวเดิม ·
  ติดตามดาวน์โหลด (queued/downloading/completed/failed, คำนวณ % จากไบต์, แถวใหม่สุด, โมเดลอื่นไม่ถูกหยิบ) ·
  poll เฉพาะตอนยังโหลดอยู่ · SSR ของปุ่มและแถบความคืบหน้าในทุกสถานะ
