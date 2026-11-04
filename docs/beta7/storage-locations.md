# Storage locations — เลือกเองว่าโฟลเดอร์ไหนอยู่ Internal / External SSD

> **นี่ไม่ใช่คู่มือย้ายแอป** เจ้าของระบุชัดว่า *"ไม่ได้อยากให้ย้าย แต่ต้องการสามารถเลือกได้
> ว่าต้องการเอาไว้ที่ไหน หรือโฟลเดอร์ไหนจะเป็น Internal หรือ external SSD"*
> ฉะนั้น **ไม่มีคำสั่งบังคับย้าย ไม่มี default ที่เปลี่ยน ไม่มีการย้ายตอนแอปทำงาน**
> ค่าเริ่มต้นคือ "ทุกโฟลเดอร์อยู่ใน checkout เหมือนเดิม" ทุกอย่างเป็น opt-in ต่อโฟลเดอร์

## หลักการ

`serve.cjs` ยังอ่าน `app/<id>` เหมือนเดิมทุกประการ — **ไม่มีโค้ด path ถูกแก้**
launcher (`mac.sh` / `linux.sh`) เรียก `scripts/setup/storage-layout.sh --apply`
**ก่อน**สตาร์ทเซิร์ฟเวอร์: ถ้าคุณเลือกที่อยู่ไว้ มันย้ายข้อมูลครั้งเดียว แล้วแทนที่
โฟลเดอร์ด้วย symlink ไปยังตำแหน่งที่เลือก แอปไม่รู้เลยว่าข้อมูลอยู่ SSD ลูกไหน

```
app/llm-models  ──symlink──▶  /Volumes/ExternalSSD/LUKE/llm-models   (external)
app/runtime-state ──(dir)──▶  อยู่ใน checkout บน Internal SSD          (internal)
app/dist          ──(dir)──▶  อยู่ใน checkout บน Internal SSD          (internal)
```

โค้ด / `.git` / `node_modules` / portable Node **อยู่ใน checkout เสมอ** (ต้องเร็ว)
ส่วนโฟลเดอร์ที่เลือกได้คือ 8 โฟลเดอร์ที่ gitignore อยู่แล้ว → ไม่กระทบ `sync.sh`,
`check-frontend-build.sh`, `git status` หรือ build stamp

## โฟลเดอร์ที่เลือกได้ (จาก `scripts/config/storage-folders.json`)

| id | ความหมาย | แนะนำ | เหตุผล |
| :--- | :--- | :--- | :--- |
| `llm-models` | GGUF / local LLM | **External** | หลาย GB โหลดครั้งเดียว อ่านช้าได้ |
| `speech-models` | Whisper | **External** | โมเดลถอดเสียง |
| `tts-models` | Kokoro TTS | **External** | โมเดลเสียง |
| `openvino-models` | OpenVINO / NPU | **External** | โมเดล NPU |
| `models` | Stable Diffusion | **External** | checkpoint ภาพ |
| `runtimes` | venv / image-to-video | **External** | runtime ที่โหลดเพิ่ม |
| `runtime-state` | ประวัติแชท / state / ledger | **Internal** | เขียนบ่อยมาก ต้องการ latency ต่ำ |
| `dist` | frontend ที่ build แล้ว | **Internal** | เสิร์ฟทุกคำขอ ต้องเร็ว |

"แนะนำ" เป็นเพียง **คำแนะนำที่แสดงใน UI** ไม่บังคับ — คุณเลือกสวนทางได้ทุกอัน

## วิธีเลือก (3 ทาง เขียนไฟล์เดียวกัน)

### 1. ในแอป (ง่ายสุด)
**Settings → Storage locations** → กด `Choose…` (ใช้ native folder picker ที่มีอยู่แล้ว
`/api/storage/choose-folder`) หรือ `Reset` เพื่อเอาคืนเข้า checkout
ตารางแสดง **Volume (Internal SSD / External SSD)**, คำแนะนำ, สถานะ
`In checkout / Applied / Pending restart` และป้าย "restart เพื่อ apply"

### 2. CLI
```bash
bash scripts/setup/storage-layout.sh --list                    # ดูตาราง + volume
bash scripts/setup/storage-layout.sh --set llm-models /Volumes/ExternalSSD/LUKE/llm-models
bash scripts/setup/storage-layout.sh --set runtime-state "/Users/me/Library/Application Support/LUKE/state"
bash scripts/setup/storage-layout.sh --reset llm-models       # เอาคืนเข้า checkout
bash scripts/setup/storage-layout.sh --choose                 # เมนูโต้ตอบ
bash scripts/setup/storage-layout.sh --detect /Volumes/SSD/X  # internal / external
```

### 3. แก้ไฟล์ตรงๆ
```bash
cp storage-layout.conf.example storage-layout.conf
```
รูปแบบ `id=/พาธ/สัมบูรณ์` ต่อบรรทัด, `#` คือคอมเมนต์
ไฟล์นี้ **gitignored / mode 600 / machine-local** → แต่ละเครื่องเลือกต่างกันได้
ไม่ถูกส่งขึ้น GitHub ไม่หายตอน `git pull`

## แล้วเมื่อไหร่ย้าย?

`--set` / `Reset` ใน UI / แก้ไฟล์ **เขียน config เท่านั้น** ไม่แตะข้อมูล
(สำคัญมาก: `runtime-state` และ `dist` ถูกเขียน/อ่านตลอดเวลาที่แอปทำงาน)

ปิดแอปแล้วเปิดใหม่ตามปกติ:
```bash
cd /Volumes/AI && ./mac.sh        # หรือ ./linux.sh
```
launcher จะพิมพ์เช่น
```
  [storage] llm-models: now at /Volumes/ExternalSSD/LUKE/llm-models (external SSD)
```
และ **รันซ้ำกี่ครั้งก็เงียบ** (idempotent) ถ้าแก้ใจ `--reset` แล้ว restart
ข้อมูลจะถูกย้ายกลับเข้า `app/<id>` เป็น directory จริงเหมือนเดิม

## ความปลอดภัยที่ถูก lock ด้วยเทสต์

| กรณี | ผล |
| :--- | :--- |
| external SSD **ไม่ได้เสียบ** | ข้ามโฟลเดอร์นั้น + เตือน **ไม่สร้าง** `/Volumes/<name>` บนดิสก์ภายใน (กันโมเดลหลาย GB หลุดไปอยู่ boot disk) |
| ปลายทางมีข้อมูลอยู่แล้ว | ปฏิเสธ ไม่ merge เงียบๆ |
| copy ไม่ครบ (นับไฟล์ไม่เท่า) | **ไม่ลบของเดิม** |
| ปลายทาง = `/`, root ของ repo, `.git`, `app/frontend`, ตัวเอง, โฟลเดอร์จัดการอื่น, relative path, ไฟล์ | ปฏิเสธ 400 / exit 1 |
| `--apply` มีปัญหา | **ไม่ทำให้แอปไม่เปิด** — ข้ามโฟลเดอร์นั้นแล้วเสิร์ฟต่อ (`\|\| true`) |
| `git pull` / `sync.sh` / build stamp | ไม่กระทบ (ทุกโฟลเดอร์ gitignore) |

การย้ายใช้ `cp -pR` → ตรวจจำนวนไฟล์ → ค่อยลบของเดิม → สร้าง symlink
(ไม่ใช้ `mv` ข้าม volume แบบดิบๆ) และ `runtime-state`/`dist` ถูกย้ายตอนที่
เซิร์ฟเวอร์ยังไม่สตาร์ทเท่านั้น

## ตรวจสอบ
```bash
bash scripts/setup/storage-layout.sh --list
curl -sS http://127.0.0.1:1420/api/storage/locations | python3 -m json.tool
node scripts/validation/test-storage-locations.cjs     # 58 checks
```

> ถ้าต้องการให้โฟลเดอร์ใหม่เพิ่มเข้า list ให้แก้ **`scripts/config/storage-folders.json`**
> ที่เดียว — bash launcher กับ Node API อ่านไฟล์เดียวกัน และเทสต์จะจับถ้าสองฝั่งหลุดกัน
