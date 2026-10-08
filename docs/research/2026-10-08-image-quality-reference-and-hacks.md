# วิจัย: คุณภาพการเจนภาพ · Reference Image · แฮ็กที่ควรทำ
**วันที่:** 2026-10-08 · **ตรวจจาก commit:** `7e264af` (branch `arena/68f04c57…`) · **สถานะ:** เอกสารวิจัย (ยังไม่แก้โค้ด)

เอกสารนี้ตอบ 3 คำถามที่ตั้งไว้ก่อนลงมือ:
1. **Create Image** — ทำยังไงให้ประสิทธิภาพใกล้ ChatGPT Image 2 / และมี reference อะไรที่ไวรัสบนเว็บ+YouTube
2. **Reference Image** — ทำยังไงให้ผลออกมาใกล้ต้นฉบับ และ "ใช้งานง่ายโดยไม่ต้องตั้งอะไร"
3. **แฮ็ก** — มีอะไรที่ทำแล้วดีขึ้นทันที / ทำแล้วดีกว่าเดิม แนะนำมาเลย

---

## 0) TL;DR — คำตอบสั้น 3 ข้อ

| คำถาม | คำตอบสั้น |
|---|---|
| **1. ทำไมยังไม่ใกล้ GPT Image 2** | ไม่ใช่เพราะ engine แต่เพราะแอปโหลดได้แค่ **เช็คพอยต์ไฟล์เดียว (SD1.5/SDXL)** แล้วเจนแบบ UNet-era ส่วนคู่แข่งที่ใกล้สุดที่รันในเครื่องได้คือกลุ่ม **instruction / edit model** (Qwen-Image-Edit 2511, Qwen-Image-2.1, FLUX.1-Kontext, Z-Image Turbo, FLUX.2-klein) ซึ่ง **backend ที่แอปใช้อยู่ (`stable-diffusion.cpp`) รองรับแล้วทุกตัว** — Qwen Image Edit ตั้งแต่ ต.ค. 2025, Z-Image ธ.ค. 2025, FLUX.2 ม.ค. 2026 · กำแพงอยู่ที่แอปไม่รองรับ "โมเดลหลายไฟล์" ไม่ใช่ที่ engine |
| **2. Reference ไม่ตรงต้นฉบับ** | มี 3 สาเหตุราก **(ก)** ฟิลด์ `reference_images` ที่แอปส่งไป backend **ถูกเมิน** (upstream ไม่อ่านฟิลด์นี้ทั้งบน `/v1/images/generations` และ `/sdapi/v1/img2img`) **(ข)** ทางเดียวที่ทำงานจริงตอนนี้คือยัดรูปอ้างอิงเป็น `init_image` แล้ว denoise ต่ำ → ได้ "โครง" เดิม แต่ไม่ได้ "ตัวตน" เดิม และยิ่ง denoise ต่ำ prompt ยิ่งไม่มีผล **(ค)** ไม่มีโมเดล identity (IP-Adapter/PhotoMaker) ในเส้นทางนี้ + backend ที่แอปมี (master-721, 24 มิ.ย. 2026) **ยังไม่มี IP-Adapter** (upstream เพิ่งเพิ่ม 24 ก.ค. 2026) |
| **3. แฮ็กที่แนะนำ** | 15 ข้อ เรียงตาม "ผลตอบแทน ÷ แรง" อยู่ที่ **หัวข้อ 7** — 5 ข้อแรกทำได้วันนี้โดยไม่ต้องโหลดโมเดลอะไรเพิ่ม (ซึ่งรวมบั๊ก localStorage ที่ทำให้ reference หาย/หน่วง) |

---

## 1) วิธีตรวจ (ทำซ้ำได้)

* อ่านโค้ดจริงใน repo (เลขบรรทัดอ้างอิงท้ายหัวข้อ)
* เทียบกับเอกสาร upstream `leejet/stable-diffusion.cpp` **ที่แท็กที่แอปใช้จริง** `master-721-8caa3f9` (24 มิ.ย. 2026) และที่ `master` ปัจจุบัน `master-945-a1ded76` (6 ต.ค. 2026)
  * `examples/server/api.md` (สคีมาของ `/v1/…`, `/sdapi/v1/…`, `/sdcpp/v1/…`)
  * `docs/edit.md`, `docs/qwen_image_edit.md`, `docs/kontext.md`, `docs/ip_adapter.md`, `docs/photo_maker.md`, `docs/adetailer.md`, `docs/image_preprocessing.md`, `docs/esrgan.md`, `docs/caching.md`
  * API ของ GitHub: releases / commits รายไฟล์ (เพื่อหาว่าฟีเจอร์ไหน "เข้ามาหลัง 721")
* Web research: สถานะตลาดโมเดล ต.ค. 2026 + คลิป/บทความที่ไวรัส (หัวข้อ 9)

---

## 2) สถานะจริงของแอปตอนนี้ (Audit)

### 2.1 เส้นทางการเจนภาพ

```
Generator.jsx ──generateImage()──► api.js ──► http://127.0.0.1:<port_backend>/v1/images/generations   (txt2img)
                                          └─► http://127.0.0.1:<port_backend>/sdapi/v1/img2img        (เมื่อมี init image)
backend  = scripts/server/serve.cjs startBackend()  → spawn  sd-server --model <ไฟล์เดียว> …
```

* `scripts/server/serve.cjs:6942-6950` สร้าง argv ของ backend โดยมีแค่ `--model`, `--steps`, `--cfg-scale`, `--sampling-method`, `--threads`, `--listen-port` (+ `--vae-tiling`, `--vae-on-cpu`, `--fa`/`--diffusion-fa`) → **ไม่มี** `--diffusion-model`, `--vae`, `--llm`, `--llm_vision`, `--ip-adapter`, `--clip_vision`
* `scripts/server/serve.cjs:8001` ข้อความ error ที่แอปเขียนเองยืนยันว่า *"แอปนี้โหลดได้เฉพาะ SD 1.5/SDXL ไฟล์เดียว — โมเดลอย่าง Z-Image, Qwen, Flux … ต้องใช้ `--diffusion-model` พร้อมไฟล์ VAE/text encoder"*
* รุ่น backend ที่แอปดาวน์โหลด: Windows = `master-721` (CPU/CUDA) และ `master-669` (Vulkan) — `serve.cjs:7322,7330,7338`, `scripts/setup/setup.ps1:283,336,413`; Linux = `master-685-19bdfe2` — `scripts/setup/setup.sh:43` → **ตามหลัง upstream 3.5 เดือน**

### 2.2 เส้นทาง Reference — 5 ข้อบกพร่องที่ทำให้ "ไม่ตรงต้นฉบับ"

| # | หลักฐาน | ปัญหา | ผลที่ผู้ใช้เห็น |
|---|---|---|---|
| R1 | `api.js:1352-1353` (txt2img) และ `api.js:1447-1449` (img2img) ส่ง `reference_images` / `reference_settings` / `reference_mode` | upstream **ไม่อ่านฟิลด์เหล่านี้** · `/v1/images/generations` รองรับแค่ `prompt, n, size, output_format, output_compression` (+ `<sd_cpp_extra_args>` ใน prompt) · `/sdapi/v1/img2img` รองรับแค่ฟิลด์ txt2img + `init_images, mask, denoising_strength` | เสีย payload ฟรีทุกครั้งที่เจน (และเข้าใจผิดว่า "ส่ง reference ไปแล้ว") |
| R2 | `social-agency-runtime.cjs:379-382` ความเห็นของทีมเอง | *"bundled backend ignores `reference_images` … (a bag came back as a dress)"* | เหมือน R1 แต่มีหลักฐานภาคสนามแล้ว |
| R3 | `Generator.jsx:672` `primaryReferenceSource = baseImage \|\| getBestReferenceSource()` | รูปอ้างอิงถูกใช้เป็น **`init_image`** (img2img, SDEdit) → ได้ "องค์ประกอบ/โทน" เดิม แต่ identity เปลี่ยนเมื่อ denoise สูง และ prompt ไม่ทำงานเมื่อ denoise ต่ำ | "หน้าคล้ายแต่ไม่ใช่คนเดิม" หรือ "คนเดิมแต่ฉากไม่เปลี่ยน" |
| R4 | `img2img-steps.cjs` + `api.js:1314-1322` | ทีมแก้ถูกต้องแล้ว (สเกล steps ÷ denoise) แต่ default `denoiseGuidance = 0.38` (`Generator.jsx:213`, `ReferenceManager.jsx:646`) ต่ำเกินกว่าจะเปลี่ยนฉาก และ 0.6+ ก็ทำ identity พัง — ไม่มีค่ากลางที่ถูกทั้งคู่ เพราะไม่มีโมเดล identity | ผู้ใช้ต้อง "ตั้งเอง" และยังไม่ได้ผลที่ต้องการ |
| R5 | `ReferenceManager.jsx:646-653` | สไลเดอร์ที่โชว์ให้ผู้ใช้ (`Face Similarity`, `Reference Strength`, `Denoise Guidance`, checkbox 4 ตัว) **ไม่มีผลกับ backend เลย** — มีผลแค่ต่อข้อความ prompt boost (`api.js:182-234`) | "ตั้งไปก็ไม่มีอะไรเปลี่ยน" ตรงกับที่ผู้ใช้บอกว่า *"อยากใช้งานง่ายโดยไม่ต้องตั้งอะไร"* |

### 2.3 Backend ที่แอปมี vs upstream (ตัวตัดสินความสามารถ)

| ฟีเจอร์ upstream | วันที่เข้า upstream | มีใน `master-721` (ที่แอปใช้)? |
|---|---|---|
| `/v1/images/edits` (multipart `image[]` → reference จริง) | ธ.ค. 2025 | ✅ มี |
| `ref_images[]` ในสคีมา native + `sd_cpp_extra_args` ฝังใน prompt | ธ.ค. 2025 | ✅ มี |
| Qwen-Image-Edit / Kontext / Z-Image / FLUX.2 | ต.ค. 2025 – ม.ค. 2026 | ✅ engine รองรับ (แอปโหลดไม่ได้เพราะหลายไฟล์) |
| PhotoMaker (SDXL) | พ.ย. 2025 | ✅ CLI มี |
| Hires fix (`enable_hr`, `hr_*`) | เม.ย. 2026 | ✅ มี |
| **IP-Adapter (SD1.5/SDXL)** + **IP-Adapter Plus** | 24 ก.ค. / 2 ส.ค. 2026 | ❌ ไม่มี |
| **ADetailer** (ซ่อมหน้า/มืออัตโนมัติ) | 14 ก.ค. 2026 | ❌ ไม่มี |
| `ref_image_args` + preset ต่อโมเดล (`vae_input_max_pixels`, `resize_before_vae`, `vlm_resize_mode`…) | ก.ย. 2026 | ❌ ไม่มี |
| `image_preprocess` (crop/pad/resize/canny ต่อ input) | 22 ก.ย. 2026 | ❌ ไม่มี |
| Conditioning cache ปรับได้ (`cache_mode`) | 23 ก.ย. 2026 | ❌ ไม่มี |
| **Qwen-Image-2.1** (7B, 10 refs, RGBA, 2K) | 20 ก.ย. 2026 | ❌ ไม่มี |

> **ข้อสรุปสำคัญ:** งานใหญ่ที่สุดไม่จำเป็นต้องอัป binary ก่อน — แค่เปลี่ยน "วิธีเรียกใช้" backend ที่มีอยู่ (ใช้ `ref_images` จริง) + ทำ "โมเดลหลายไฟล์" ก็ได้คุณภาพระดับ edit model ทันที ส่วนการอัปเป็น `master-945` ค่อยเก็บของแถม (IP-Adapter, ADetailer, ref presets, Qwen-2.1, cache)

### 2.4 ปัญหาเชิงประสิทธิภาพ/ความทนทานที่เจอระหว่างตรวจ (ไม่เกี่ยวกับคุณภาพภาพโดยตรง แต่ผู้ใช้รู้สึกได้)

* **P1 — Reference เก็บเป็น base64 ใน localStorage**: `Generator.jsx:229` เขียน `referenceImages` (มี `src` เป็น data URL) ลง `localStorage` โดยไม่มีเพดานขนาด — 5 MB quota จะเต็มที่ ~3 รูป และเมื่อเต็มจะ **เงียบ** (`catch` แค่ `console.warn` ที่ `:231`)
* **P2 — ส่ง base64 รูปอ้างอิงซ้ำทุกรอบ**: `Generator.jsx:245-260` ใส่ `src` (data URL) ของ **ทุกรูปที่เปิดใช้** ลง payload → 20 รูป × ~1.5 MB = ข้อความ JSON ~30 MB ต่อการเจน 1 ครั้ง (ทั้งที่ backend ไม่ใช้ฟิลด์นี้เลยตาม R1)
* **P3 — 2 ทางอัปโหลดซ้อนกัน**: `ReferenceManager.jsx` อัปโหลดขึ้น asset registry (`/api/references/upload`, `api.js:2236`) **และ** เก็บ data URL ไว้ในเครื่อง — ข้อมูลชุดเดียวกันมี 2 ที่ ไม่มีตัวตัดสินว่าอันไหนคือ source of truth
* **P4 — ไม่มี progress/cancel จริงของ backend**: ใช้ endpoint แบบ synchronous ของ compat layer ขณะที่ upstream มี `/sdcpp/v1/img_gen` (async job + `preview` + `cancel`) ตั้งแต่ยุค 721 → ที่แอปคำนวณ progress เองด้วย timer (`Generator.jsx:600-660`) คือการชดเชยข้อนี้

---

## 3) ภูมิทัศน์โมเดล ต.ค. 2026 (ภาพที่ควรรู้)

| โมเดล | ที่มา | เปิดน้ำหนัก | เด่นเรื่อง | ข้อจำกัด |
|---|---|---|---|---|
| **GPT Image 2.5** (Flare/Sunburst) | OpenAI, 8 ก.ย. 2026 | ❌ cloud | ที่ 1–2 ของแทร็ก Arena หลายหมวด, edit ต่อเนื่องหลายรอบนิ่ง, "reference-photo preservation" | ต้องเน็ต/ค่าใช้จ่าย/ถูกเซ็นเซอร์ |
| **Nano Banana 2 / Pro** | Google | ❌ cloud | identity consistency ข้ามภาพ, multi-ref (~14–20 รูป) | ถูก safety filter บ่อยกับงานแฟชัน/editorial |
| **Qwen-Image-2.1** | Alibaba, 20 ก.ย. 2026 | ✅ | 7B DiT + 8B vision-LLM, **10 reference images**, RGBA จริง, 2K, คะแนนสูงสุดในกลุ่ม open-weight | ต้อง GPU 16–24 GB (มี INT8/offload); sd.cpp รองรับ day-0 |
| **Qwen-Image-Edit 2511** | Alibaba, ธ.ค. 2025 | ✅ | editor ที่ดีที่สุดของกลุ่มเปิดในเชิง "แก้ตามคำสั่ง" + character consistency หลายคน, LoRA ในตัว | ผิวหนังยังสู้ NB2 ไม่ได้; 20B → Q4_K_M 13.1 GB |
| **FLUX.1-Kontext** | BFL | ✅ (non-commercial) | edit ตามคำสั่งคุณภาพสูง, ชุมชนใหญ่ | license non-commercial; Q4_K_M 6.9 GB + t5xxl/clip_l/ae |
| **Z-Image Turbo** | Alibaba, พ.ย.–ธ.ค. 2025 | ✅ Apache-2.0 | 6B, 8 steps, ~2–3 วิ/1024 บน 4090, GGUF Q4 4.5 GB → **รันได้บน 6–8 GB** | ไม่ใช่ edit model (ต้อง Z-Image-Edit) |
| **FLUX.2-klein 4B** | BFL, ม.ค. 2026 | ✅ Apache-2.0 | 4 steps, เบามาก | prompt adherence รองจากรุ่นใหญ่ |
| **SDXL + IP-Adapter Plus** | ชุมชน | ✅ | identity/appearance จากรูปเดียว **บนเช็คพอยต์ SDXL ที่มีอยู่** — ทางอัปเกรดที่ถูกที่สุดของแอป | ต้องมี `clip_vision` + ไฟล์ IP-Adapter; backend ต้อง ≥ ส.ค. 2026 |

**ขนาดไฟล์จริง (ตรวจจาก Hugging Face — ใช้คำนวณแผนดาวน์โหลด)**

| ชิ้นส่วน | ขนาด |
|---|---|
| Qwen-Image-Edit 2509 GGUF | Q3_K_M 9.76 GB · **Q4_K_M 13.1 GB** · Q8_0 21.8 GB |
| Qwen2.5-VL-7B (text encoder ของ Qwen-Edit) | Q4_K_M ~4.7 GB · Q8_0 ~8 GB · mmproj Q8 ~1.1 GB |
| qwen_image_vae | ~250 MB |
| FLUX.1-Kontext GGUF | Q4_K_M 6.93 GB · Q5_K_M 8.42 GB |
| t5xxl (encoder ของ FLUX) | fp16 ~9.8 GB (หรือ fp8/Q8 ~5 GB) · clip_l 246 MB · ae.safetensors 335 MB |
| Z-Image Turbo GGUF | Q4_K_M 4.5 GB · Q8_0 7.22 GB |
| Qwen3-4B (encoder ของ Z-Image และ FLUX.2-klein) | safetensors 8.04 GB · GGUF Q5_K_M 2.89 GB · Q4_K_M 2.5 GB |
| **FLUX.2-klein 4B** GGUF | Q4_K_M **2.6 GB** · Q5_0 2.92 GB · BF16 7.75 GB (Apache-2.0, 4 steps, แก้ภาพด้วย `ref_images` ได้) |
| t5xxl (encoder ของ FLUX.1) | f16 9.53 GB · Q8_0 5.06 GB · Q5_K_M 3.39 GB · **Q4_K_M 2.9 GB** |

**Tier เครื่องที่แนะนำ (ค่าประมาณจากแหล่งอ้างอิงในหัวข้อ 9)**

| VRAM | ชุดที่เหมาะ |
|---|---|
| 6–8 GB | Z-Image Turbo Q4 + Qwen3-4B Q4 (2.5 GB) · หรือ SDXL + Hires fix + ESRGAN |
| 12 GB | SDXL + **IP-Adapter Plus** + Hires + ADetailer · FLUX.1-Kontext Q4 |
| 16 GB | Qwen-Image-Edit 2509 Q3/Q4 (offload) · FLUX.1-Kontext Q5 |
| 24 GB | Qwen-Image-Edit 2511 Q4/Q5 · **Qwen-Image-2.1 INT8** (คุณภาพสูงสุดที่รันเองได้) |

---

## 4) คำตอบข้อ 1 — แผนไต่คุณภาพ 3 ระดับ (L0 → L2)

### L0 — ทำได้วันนี้ ไม่ต้องโหลดโมเดลเพิ่ม (แก้โค้ดล้วน, ~1–2 วัน)
1. **เลิกส่งของที่ไม่มีผล** (`reference_images`, `reference_settings`, `reference_mode`, `src` ทั้งก้อน) → ลด payload 30 MB → ไม่กี่ KB (แก้ P1/P2/R1)
2. **ย้าย reference ไปเป็น asset บนดิสก์** (ใช้ `/api/references/upload` ที่มีอยู่แล้ว) เก็บใน localStorage แค่ `assetId` + metadata
3. **Hires fix 2 จังหวะ**: เจน 512/768 → hires ×1.5–2 (`enable_hr`, `hr_upscaler`, `hr_steps`, `denoising_strength` 0.4–0.5) — backend 721 **รองรับแล้ว** ได้งานพิมพ์คมขึ้นโดยไม่ต้องมีโมเดลใหม่
4. **ESRGAN upscale หลังเจน** (`--upscale-model` ใน CLI / โมเดลใน `--hires-upscalers-dir`) สำหรับภาพส่งลูกค้า
5. **Sampler/CFG recipe ต่อโมเดล**: Lightning family → 4–8 steps CFG 1–2; SDXL ปกติ → 25–30 steps CFG 5–7 + DPM++ 2M Karras (ค่า default คนละชุด ลด "ภาพไม่สวยเพราะตั้งค่าผิด" ได้ทันที)

> ผลที่คาดหวัง: ภาพคม/รายละเอียดดีขึ้นชัด, ไม่มีอาการ "แอปหน่วงตอนเจน", reference ไม่หาย — แต่**ยังไม่**ได้ identity ตรงต้นฉบับ

### L1 — โหลด "edit model" ได้ (ไม่ต้องอัป binary! งานหลัก 1–2 สัปดาห์)
6. **รองรับโมเดลหลายไฟล์**: `app/config/image-models.json` (bundle) → `serve.cjs` ประกอบ argv `--diffusion-model/--vae/--llm/--llm_vision`; Model Manager ดาวน์โหลดเป็นชุด (diffusion+VAE+encoder) พร้อมตรวจ sha256/ขนาด
7. **ส่ง reference ผ่านช่องทางที่ backend อ่านจริง** อย่างใดอย่างหนึ่ง:
   * native: `POST /sdcpp/v1/img_gen` body มี `ref_images: [dataURL…]`, `ref_image_args`, `increase_ref_index`
   * ทางลัดบน 721: ฝัง `<sd_cpp_extra_args>{"ref_images":[…]}</sd_cpp_extra_args>` ต่อท้าย prompt แล้วยิง `/v1/images/generations` (สคีมาเดียวกัน — `routes_openai.cpp` อ่านคีย์นี้)
   * multipart: `POST /v1/images/edits` ด้วย `image[]` (721 มีแล้ว)
8. **เลือกโมเดลเริ่มต้น** (ปรับตามเครื่อง 18 GB ตามหัวข้อ 11): **FLUX.2-klein 4B** (Apache-2.0, 4 steps, ref edit, ~5.9 GB) หรือ **Z-Image Turbo** (สายเร็ว/เครื่องเล็ก, ~7.7 GB) — FLUX.1-Kontext Q4 (~10.4 GB) เป็นตัวเลือกที่ 3 ถ้ายอมรับ license non-commercial; **Qwen-Image-Edit / Qwen-Image-2.1 อย่าใส่ในแผนเครื่องนี้**

**Recipe ที่เสนอ** (ค่าเริ่มต้นต่อตระกูล — ใช้เป็น primitive ของ "ไม่ต้องตั้งอะไร")

```json
{
  "z-image-turbo":   { "kind": "txt2img", "steps": 8, "cfg": 1.0, "sampler": "euler_a", "size": "1024x1024",
                       "files": ["diffusion", "vae", "llm"], "preprocess": "resize_longest_1536", "vram": "~7.7GB" },
  "flux2-klein-4b":  { "kind": "edit", "steps": 4, "cfg": 1.0, "sampler": "euler",
                       "files": ["diffusion", "vae", "llm"], "ref_mode": "flux2", "vram": "~5.9GB",
                       "note": "Apache-2.0 · ตัวแรกที่แนะนำสำหรับเครื่อง 18 GB" },
  "flux-kontext":    { "kind": "edit", "steps": 20, "cfg": 1.0, "sampler": "euler",
                       "preprocess": "ref:exact_max_1024", "vram": "~10.4GB + offload",
                       "note": "cfg ต้อง = 1 · license non-commercial" },
  "qwen-image-edit": { "kind": "edit", "ref_mode": "vae+vlm", "ref_args": "resize_before_vae=true",
                       "steps": 20, "cfg": 2.5, "sampler": "euler", "flow_shift": 3,
                       "preprocess": "ref:exact_max_1024", "increase_ref_index": true,
                       "vram": "~15.8GB", "note": "เกินงบ 14.3 GB ของเครื่อง 18 GB — เก็บไว้ใช้กับเครื่อง 24 GB" },
  "sdxl-lightning":  { "kind": "txt2img", "steps": 6, "cfg": 1.5, "sampler": "dpm++2m", "size": "1024x1024",
                       "hires": { "scale": 1.5, "denoise": 0.45 } },
  "sdxl-ipa":        { "kind": "txt2img+identity", "ipa_strength": 0.75, "steps": 28, "cfg": 6.0,
                       "files": ["checkpoint", "clip_vision", "ip_adapter"], "vram": "~10GB",
                       "hires": { "scale": 1.5 } }
}
```

### L2 — อัป backend เป็น `master-945-a1ded76` (ต.ค. 2026) + เก็บของแถม (2–4 สัปดาห์)
9. **IP-Adapter Plus** (SD1.5/SDXL) = identity จากรูปเดียวบนเช็คพอยต์เดิมของลูกค้า → ตอบโจทย์ "Reference ตรงต้นฉบับ" บนเครื่อง 8–12 GB ได้จริง
10. **ADetailer** ซ่อมหน้า/มืออัตโนมัติหลังเจน (ตัวที่ทำให้ภาพ SDXL "ดูเป็นมืออาชีพ")
11. **Qwen-Image-2.1** (10 refs, RGBA, 2K) = เพดานคุณภาพใหม่ของแอป; ใช้ `--offload-to-cpu` + INT8 บน 24 GB
12. **`ref_image_args` preset + `image_preprocess`** → ให้ backend จัดการ preprocess เอง = ฐานของโหมด zero-config
13. **async job + preview + cancel** (`/sdcpp/v1/img_gen` + `/sdcpp/v1/jobs/{id}`) แทน timer เดา progress → UI ลื่นขึ้นและยกเลิกได้จริง

**หมายเหตุการอัปเกรด (สำคัญ):** ตั้งแต่รุ่นใหม่ ชื่อไฟล์ release เปลี่ยน — `sd-master-a1ded76-bin-win-cpu-x64.zip` (ไม่มี avx2) และ **`cudart-sd-bin-win-cu12-x64.zip` แยกออกมา** ต้องแก้ `IMAGE_BACKEND_DOWNLOADS` (`serve.cjs:7316-7340`) + `setup.ps1`/`setup.sh` ให้ดึง cudart ด้วย ไม่งั้น CUDA จะสตาร์ตไม่ขึ้น

---

## 5) คำตอบข้อ 2 — "Reference ตรงต้นฉบับ + ไม่ต้องตั้งอะไร" (ดีไซน์ Zero-config)

หลักคิด: **ย้ายการตัดสินใจจากผู้ใช้ไปเป็น recipe + router** โดยผู้ใช้เห็นแค่ปุ่มเดียว

```
[อัปรูป] → auto-preprocess → Reference Router → (model+params ที่ถูก) → เจน → face-detail pass → upscale → เสร็จ
```

### 5.1 Reference Router (เลือกเส้นทางอัตโนมัติ)

| สภาพแวดล้อม | ใช้เส้นทาง | พารามิเตอร์อัตโนมัติ |
|---|---|---|
| มี edit model (Qwen/FLUX) โหลดอยู่ | `ref_images` จริง | steps 20, cfg 2.5 (Qwen) / 1.0 (FLUX), flow_shift 3, `increase_ref_index` |
| SDXL/SD1.5 + IP-Adapter พร้อม (L2) | IP-Adapter Plus | ipa_strength 0.7–0.8, steps 28, cfg 6 |
| SDXL เฉย ๆ (วันนี้) | init image (img2img) + Hires | denoise 0.45–0.55 (สลับภาพ) / 0.30–0.38 (คงฉาก), steps สเกลตาม denoise (มีแล้ว) |
| ต้องการ "สินค้าเดิมเป๊ะ" | img2img denoise ต่ำ + mask พื้นหลัง (inpaint) | denoise 0.25 + `mask` (721 รองรับ `mask`) |

### 5.2 Auto-preprocess รูปอ้างอิง (ตัวชี้ขาดที่คนมักข้าม)
* ย่อด้านยาวสุด ≤ 1024–1536 px และ **ไม่ให้เล็กกว่าขนาดเอาต์พุต** (รูป 300px → ผลลัพธ์เบลอทันที)
* แปลงเป็น PNG/RGB (ตัด alpha) — sd.cpp รับ data URL ได้เลย (`routes_sdcpp.cpp`, `api.md` ระบุชัด)
* ถ้าผู้ใช้อัป "คน" ให้ **crop เฉพาะหัว–ไหล่** เป็น ref เสริมอีกใบ (IP-Adapter Plus Face / FaceID ใช้ crop หน้า) — เพิ่มความเหมือนได้โดยไม่ต้องให้ผู้ใช้ทำอะไร
* จัด aspect ของ ref ให้ตรงกับ canvas เอาต์พุต (pad ด้วยขอบเดิมหรือเบลอ) → ลดอาการ "ยืดหน้าทิ้งท้าย"
* บน backend ใหม่: ส่งต่อ policy ให้ `image_preprocess` + `ref_image_args` เช่น `target=ref,mode=none` + `vae_input_max_pixels`

### 5.3 Two-pass finish (คือ "แฮ็กคุณภาพ" ที่คุ้มที่สุด)
1. pass 1: เจน/แก้ ที่ความละเอียดต่ำ (768–1024) — คุม identity ง่าย
2. pass 2: hires ×1.5–2 denoise 0.4–0.5 → เพิ่มรายละเอียดโดยไม่ทิ้งโครง
3. pass 3 (เฉพาะภาพคน): ADetailer (L2) หรือ crop หน้า → img2img denoise 0.3 → paste กลับ (ทำได้แม้บน 721 ด้วย `mask`)

### 5.4 UI
* โหมด Basic: ปุ่ม **"ใช้รูปนี้เป็นต้นฉบับ"** → preset `Lock` (ค่าทั้งชุดมาจาก recipe) และ**ซ่อน**สไลเดอร์ทั้งหมด
* โหมด Pro: ค่อยโชว์ `denoiseGuidance`, IP-Adapter strength ฯลฯ (พร้อมป้าย *"มีผลกับ backend รุ่น X ขึ้นไป"*)
* ทุกสไลเดอร์ที่ไม่มีผลจริงต้องถูกลบหรือต่อสายเข้าของจริง — ณ วันนี้สไลเดอร์ 3 ตัว + เช็กบ็อกซ์ 4 ตัวใน `ReferenceManager.jsx:646-653` ไม่มีผลกับ backend

---

## 6) คำตอบข้อ 3 — แฮ็กทั้งหมด (เรียงตามความคุ้ม)

| # | แฮ็ก | ผล | แรง | ความเสี่ยง |
|---|---|---|---|---|
| 1 | ลบ payload ที่ backend เมิน (`reference_images`, `src` base64) | payload 30 MB → KB, เร็วขึ้น, หายบั๊ก | ครึ่งวัน | ต่ำ |
| 2 | ย้าย reference ไปดิสก์/asset registry (localStorage เก็บแค่ id) | reference ไม่หาย, รองรับ 20 รูปจริง | 1 วัน | ต่ำ (มี asset registry อยู่แล้ว) |
| 3 | Hires fix default สำหรับงานส่งลูกค้า | คมขึ้นชัด | ครึ่งวัน | ใช้เวลาเจน 2 เท่า |
| 4 | Sampler/CFG recipe ต่อโมเดล | ลด "ภาพไม่สวยเพราะตั้งค่าผิด" | ครึ่งวัน | ต่ำ |
| 5 | Prompt reference guidance → ประโยคคำสั่งสั้น ๆ + subject lock (แทน blob ยาว `api.js:206-211`) | โมเดล edit เข้าใจง่ายกว่า และประหยัด token | ครึ่งวัน | ต้อง A/B |
| 6 | Auto-crop ใบหน้าเป็น ref เสริม | ความเหมือนหน้าดีขึ้นกับทุกเส้นทาง | 1 วัน | ต่ำ |
| 7 | Two-pass (เจน → hires) ในตัว | งานพร้อมพิมพ์ | 1 วัน | ต่ำ |
| 8 | Face-detail pass (ADetailer บน L2 / crop+img2img บน L0) | หน้าไม่พัง = ความรู้สึก "โปร" | 1–2 วัน | ต้องจูน 0.25–0.4 |
| 9 | **IP-Adapter Plus (SDXL)** — ⭐ คุ้มสุดของเครื่อง 18 GB | identity จากรูปเดียวบนเช็คพอยต์เดิมที่ใช้อยู่ (~10 GB รวม) | 3–5 วัน (แค่อัป tag แล้ว build Metal) | ต้องโหลด clip_vision (~2.5 GB) + adapter (~0.85 GB) |
| 10 | โหลด edit model ยุคใหม่: **FLUX.2-klein 4B** (~5.9 GB) หรือ **Z-Image Turbo** (~7.7 GB) | กระโดดคุณภาพข้ามรุ่น + แก้ภาพจาก ref | 1–2 สัปดาห์ | ต้องมี multi-file model support; Kontext Q4 (~10.4 GB) ผ่านแต่ต้อง offload |
| 11 | Qwen-Image-2.1 | เพดานคุณภาพใหม่ (10 refs, RGBA, 2K) | ❌ **ไม่ผ่านเครื่องนี้** (~>20 GB) | ต้อง GPU 24 GB |
| 12 | **เทรน LoRA ตัวตน** จากรูป 10–20 ใบ (Qwen-Edit 2511 / SDXL) | ความเหมือนระดับ "คนนี้แน่นอน" และเจนซ้ำได้ทุกฉาก | 2–4 วันต่อคน + GPU | ต้องมีชุดข้อมูล + สิทธิ์ในภาพ |
| 13 | `cache_mode` (conditioning cache) + `--diffusion-fa` | เร็วขึ้นในรอบถัดไปของภาพเดียวกัน | ครึ่งวัน (หลังอัป 945) | คุณภาพเปลี่ยนเล็กน้อย |
| 14 | ใช้ `/sdcpp/v1/img_gen` async + preview + cancel | progress จริง, ยกเลิกได้, ได้ภาพพรีวิว | 3–5 วัน | ต้องแก้ทั้ง frontend/backend |
| 15 | "Reference หลายใบแบบมีลำดับ" (`increase_ref_index` + ลำดับภาพที่ส่ง) | จัดวางสินค้า/คนหลายตัวได้ | 1 วัน | ต้องมี edit model |

> คำเตือนที่ควรพูดตรง ๆ: **แฮ็กที่ 12 (LoRA) คือทางเดียวที่ทำให้ "เหมือนต้นฉบับ 100%" ได้จริง** บน GPU บ้าน ๆ ส่วน 9–11 ทำให้ "ใกล้มาก" โดยไม่ต้องเทรนอะไร

> **อัปเดต 2026-10-08 (หลังตรวจเครื่องเป้าหมาย):** หลักฐานใน repo ชี้ว่าเครื่องจริงคือ **Apple Silicon 18 GB** (Metal working set ~14.3 GB) → **แฮ็ก #11 (Qwen-Image-2.1) ตกไป** และ **#10 ต้องเปลี่ยนโมเดลเป้าหมายจาก Qwen-Image-Edit 2511 → FLUX.2-klein 4B / Z-Image Turbo** ส่วน **#9 (IP-Adapter Plus บน SDXL) กลายเป็นแฮ็กที่คุ้มที่สุดของเครื่องนี้** — รายละเอียดและการคำนวณหน่วยความจำอยู่ที่ **หัวข้อ 11**

---

## 7) แผนงานที่เสนอ (3 เฟส)

**Phase A — เก็บของที่เสียเปล่า + ยกคุณภาพพื้นฐาน (1–2 สัปดาห์)**
* ไฟล์: `app/frontend/src/services/api.js`, `Generator.jsx`, `ReferenceManager.jsx`, `scripts/server/serve.cjs`
* งาน: แฮ็ก 1–5 และ 7, เพิ่ม `app/config/image-model-recipes.json`, UI Basic/Pro
* เทสต์ใหม่ตามแบบ repo: `scripts/validation/test-image-reference-payload-contract.cjs` (payload ต้องไม่มี base64), `test-frontend-reference-storage.cjs` (localStorage ต้องไม่โตเกิน X), `test-image-hires-plan.cjs`
* เกณฑ์ผ่าน: payload ≤ 50 KB/ครั้ง, reference 20 รูปไม่หาย, Hires เปิดได้โดยไม่พัง CoreML path

**Phase B — Reference ของจริง บนงบหน่วยความจำของเครื่อง (2–3 สัปดาห์)**
* งาน: **(B1)** IP-Adapter Plus บน SDXL (อัป tag ของ Metal build + `--clip_vision/--ip-adapter/--ip-adapter-image/--ip-adapter-strength`) **(B2)** multi-file model support + `ref_images` จริง **(B3)** Reference Router + auto-preprocess + face-detail pass
* โมเดลเป้าหมายของ Phase B (เครื่อง 18 GB): **FLUX.2-klein 4B** (~5.9 GB) และ **Z-Image Turbo** (~7.7 GB)
* เทสต์: `test-image-multifile-model-load.cjs`, `test-image-reference-sd-cpp-extra-args.cjs`, `test-image-reference-router.cjs`, `test-image-ip-adapter-flags.cjs`
* เกณฑ์ผ่าน: ส่งรูปคน 1 ใบ + prompt เปลี่ยนฉาก → หน้าเหมือนเดิมระดับที่คนทั่วไปแยกไม่ออก (วัดด้วย cosine similarity ของ embedding ใบหน้า ≥ 0.6) และ VRAM peak ต้องไม่ชนเพดาน Metal working set ของเครื่อง

**Phase C — ของแถม + ประสบการณ์ใช้งาน (3–4 สัปดาห์)**
* งาน: ADetailer (ซ่อมหน้า), async job API + preview + cancel, conditioning cache, ESRGAN upscale ในขั้นเจน
* บน Mac ไม่ต้องทำขั้นตอน cudart แบบ Windows — แค่อัป `PINNED_TAG` ใน `scripts/build/build_from_source.sh` แล้ว build Metal ใหม่
* ความเสี่ยงที่ต้องเฝ้า: ชื่อ asset เปลี่ยนในรุ่นใหม่, Linux ต้อง glibc ใหม่ (ถ้าอัป tag ของ Linux ด้วย), ขนาด zip CUDA+cudart (เฉพาะ Windows)
* **ไม่ทำในเครื่องนี้**: Qwen-Image-2.1, Qwen-Image-Edit 2511 (เกินงบ ~14.3 GB)

---

## 8) เกณฑ์วัดผล (ต้องมีก่อน-หลัง ไม่งั้นเถียงกันไม่จบ)

1. **Identity** — ส่งรูปต้นฉบับ 5 ใบ × 5 ฉาก: วัด face embedding similarity (≥0.6 ผ่าน) + ให้คนในทีม blind-test 1–5
2. **Prompt adherence** — เปลี่ยนฉาก/เสื้อผ้า/แสง ตามคำสั่งได้กี่ % (นับจาก 20 เคส)
3. **เวลาต่อภาพ** — บนเครื่องเป้าหมาย (ต้องระบุ CPU/GPU/VRAM)
4. **ไม่พัง** — อัตราเจนสำเร็จ (ไม่ OOM, ไม่ได้ภาพดำ/เบลอ) ≥ 95% ต่อ 50 รอบ
5. เก็บ log ต่อรอบ: model, recipe, denoise, steps ที่ส่งจริง, VRAM peak → ใส่ลง metadata ที่บันทึกข้างภาพอยู่แล้ว (`Generator.jsx:692`)

---

## 9) แหล่งอ้างอิง / ของที่ "ไวรัส"

**เอกสาร engine (ใช้ตัดสินใจได้ตรง ๆ)**
* sd.cpp server API ฉบับเต็ม: `examples/server/api.md` → `ref_images`, `ref_image_args`, `ip_adapter_image`, `hires`, `lora`, `/sdcpp/v1/img_gen` ([github.com/leejet/stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp))
* `docs/edit.md` (ตาราง preset ต่อโมเดล), `docs/qwen_image_edit.md` (ตัวอย่างคำสั่ง Qwen Edit/2509/2511), `docs/kontext.md`, `docs/ip_adapter.md` (SD1.5+SDXL, Plus, `--ip-adapter-strength` 0.6–0.8), `docs/photo_maker.md` (SDXL เท่านั้น), `docs/adetailer.md`, `docs/image_preprocessing.md`, `docs/esrgan.md`
* บทความวิธีรัน Qwen-Image-2.1 ผ่าน sd.cpp แบบ docker: [alonsoruibal.com](https://www.alonsoruibal.com/running-qwen-image-2-1-locally-with-stable-diffusion-cpp/)

**เทียบโมเดล/คู่แข่ง**
* Qwen-Image-2.1 vs Nano Banana 2 (ตัวเลข 10 refs, 2K, INT8 บน 24 GB): [saascity.io](https://saascity.io/blog/qwen-image-2-1-local-text-to-image-editing-guide)
* GPT Image 2.5 vs Nano Banana 2 (เปิดตัว 8 ก.ย. 2026, Flare/Sunburst): [kie.ai](https://kie.ai/blog/gpt-image-2-5-vs-nano-banana-2)
* Qwen vs Nano Banana รายงานละเอียด: [unifically.com](https://unifically.com/blogs/qwen-image-vs-nano-banana)
* ตารางโมเดล local 2026 + VRAM: [localaimaster.com](https://localaimaster.com/blog/best-local-image-models-compared), Z-Image Turbo บน 6 GB: [z-image.vip](https://z-image.vip/blog/z-image-low-vram-6gb-gpu-setup), [thundercompute.com](https://www.thundercompute.com/blog/z-image-turbo-comfyui)

**ไวรัสบน YouTube/Reddit (workflow ที่คนทำตามกันเยอะ)**
* *Qwen Image Edit 2509 — Like a FREE nano 🍌 on your own PC in ComfyUI* — [youtu.be/F0tpgfnLYbU](https://www.youtube.com/watch?v=F0tpgfnLYbU)
* *Qwen Image Edit 2509 Tutorial* — [youtu.be/pPNee88eS6M](https://www.youtube.com/watch?v=pPNee88eS6M)
* *Train a Qwen Image Edit 2509 LoRA with AI Toolkit — Under 10 GB VRAM* — [youtu.be/d49mCFZTHsg](https://www.youtube.com/watch?v=d49mCFZTHsg) (เส้นทางแฮ็ก #12)
* *Qwen Image Models Training 0→Hero (LoRA & fine-tune)* — [youtu.be/DPX3eBTuO_Y](https://www.youtube.com/watch?v=DPX3eBTuO_Y)
* Reddit r/StableDiffusion: *Qwen Edit 2511 vs Nano Banana* — [reddit.com/r/StableDiffusion/…/1q8bvco](https://www.reddit.com/r/StableDiffusion/comments/1q8bvco/qwen_edit_2511_vs_nano_banana/)
* ComfyUI Blog: *Qwen Image Edit 2511 & Qwen Image Layered* — [blog.comfy.org](https://blog.comfy.org/p/qwen-image-edit-2511-and-qwen-image)
* Stable Diffusion Art: *Qwen Image Edit — multiple-image workflow* — [stable-diffusion-art.com](https://stable-diffusion-art.com/qwen-image-edit-multiple-images/)
* IP-Adapter Plus สำหรับ identity บน SDXL: [mybyways.com](https://mybyways.com/blog/consistent-portraits-using-ip-adapters-for-sdxl), เอกสาร diffusers [huggingface.co/docs/diffusers](https://huggingface.co/docs/diffusers/using-diffusers/ip_adapter)

---

## 10) สิ่งที่ต้องให้เจ้าของงานตัดสิน

| # | คำถาม | สถานะ |
|---|---|---|
| 1 | **เป้าหมายคุณภาพ**: "ใกล้ GPT Image 2 ให้ได้มากที่สุดบนเครื่องตัวเอง" หรือ "พอใช้ เร็ว ไม่หนักเครื่อง" | ⬜ ยังต้องเลือก → เอกสารนี้เสนอ **เส้นกลาง**: ทำ L0 + ของที่ผ่านเกณฑ์หน่วยความจำของเครื่องจริง (หัวข้อ 11) |
| 2 | **เครื่องเป้าหมายจริง** | ✅ **ตอบจากหลักฐานใน repo แล้ว: Apple Silicon 18 GB (Metal working set ~14.3 GB)** — ดูหัวข้อ 11 |
| 3 | **นโยบายโมเดล**: ยอมรับ license แบบ non-commercial (FLUX.1) หรือต้อง Apache-2.0 / commercial-safe เท่านั้น (FLUX.2-klein, Z-Image, Qwen) — และยอมให้แอปดาวน์โหลดชุดโมเดลหลาย GB ต่อโมเดลได้หรือไม่ | ⬜ ยังต้องเลือก (กระทบตัวเลือก Kontext vs klein) |

> ข้อเสนอของผม (ปรับตามเครื่อง 18 GB แล้ว): เริ่ม **Phase A ทันที** (แก้ของเสียเปล่า + hires + recipe — ไม่ต้องโหลดโมเดลอะไรเพิ่ม และวัดผลได้เลย) → ต่อด้วย **IP-Adapter Plus บน SDXL ที่มีอยู่** (ได้ identity จริง ใช้หน่วยความจำน้อยที่สุด) → แล้วค่อยเพิ่ม **FLUX.2-klein 4B** เป็นโมเดลยุคใหม่ตัวแรก ส่วน Qwen-Image-Edit 2509 / Qwen-Image-2.1 ให้ **ตัดออกจากแผนของเครื่องนี้** (ไม่ผ่านงบหน่วยความจำ) เว้นแต่จะอัปเครื่อง

---

## 11) เครื่องเป้าหมาย — หลักฐานจาก repo และ shortlist ที่แก้ใหม่ (2026-10-08)

### 11.1 หลักฐาน (ทุกอย่างอยู่ใน repo นี้)

| หลักฐาน | ที่มา | บอกอะไร |
|---|---|---|
| `LUKE: 0.1 GB · machine 10 / 18 GB` + `Metal's recommended working set (about 14.3 GB on an 18 GB M3 Pro)` + `learned from ggml_metal_device_init` | `README.md:266-278` (FAQ ที่เขียนจากเครื่องจริง) | **Apple Silicon unified memory 18 GB → เพดานที่โหลดได้จริง ~14.3 GB** (ไม่ใช่ 18) |
| `scripts/workers/coreml_server.py` + `--model-version` + CoreML reference cache | `scripts/server/serve.cjs:6930-6941` | ใช้เส้นทาง Core ML (Apple NPU) อยู่ด้วย |
| `BACKEND_PATH="$APP_DIR/backend/mac/sd"` + `PINNED_TAG="master-685-19bdfe2"` | `mac.sh:26`, `scripts/build/build_from_source.sh:22,39-56` | **บน Mac อัปเกรด engine = เปลี่ยน tag แล้ว `cmake -DSD_METAL=ON` เอง** → ไม่ต้องรอ release asset และไม่ต้องจัดการ cudart แบบ Windows |
| repo จริงอยู่บน `/Volumes/AI/LUKE-AI-STUDIO-Enterprise` | `ARENA_HANDOFF.md:362` | ดิสก์ภายนอก = ที่เก็บโมเดล (ขนาดโมเดลหลาย GB ไม่ใช่ปัญหาเรื่องดิสก์ภายใน) |

### 11.2 คำนวณ: อะไร "ผ่าน" บนงบ ~14.3 GB (น้ำหนักโมเดล + encoder + VAE)

| ชุด | น้ำหนักรวม (ประมาณ) | ผล |
|---|---|---|
| SDXL ที่มีอยู่ + **IP-Adapter Plus (vit-h)** + clip_vision ViT-H | 6.6 + 0.85 + ~2.5 = **~10 GB** | ✅ ผ่านสบาย (เหลือ headroom ให้ hires/ESRGAN) |
| **FLUX.2-klein 4B** (Q4_K_M 2.6) + Qwen3-4B Q5 (2.9) + ae (0.34) | **~5.9 GB** | ✅ ผ่านมาก · Apache-2.0 · 4 steps · แก้ภาพด้วย `ref_images` ได้ |
| **Z-Image Turbo** Q4 (4.5) + Qwen3-4B Q5 (2.9) + ae (0.34) | **~7.7 GB** | ✅ ผ่าน · 8 steps · txt2img ล้วน |
| FLUX.1-Kontext Q4_K_M (6.93) + t5xxl Q4_K_M (2.9) + clip_l (0.25) + ae (0.34) | **~10.4 GB** | ⚠️ ผ่านแต่ต้อง `--offload-to-cpu`/`--clip-on-cpu` · license **non-commercial** |
| Qwen-Image-Edit 2509 Q3_K_M (9.76) + Qwen2.5-VL-7B Q4_K_M (~4.7) + mmproj (1.1) + vae (0.25) | **~15.8 GB** | ❌ เกิน 14.3 GB และ RAM 18 GB ต้องแบ่งให้ macOS |
| Qwen-Image-Edit 2511 Q4_K_M (13.1) + encoder | **~19 GB** | ❌ |
| Qwen-Image-2.1 (7B DiT + 8B VL) | **>20 GB** | ❌ |

> เครื่องหมาย ⚠️ ยังต้องทดลองจริงเพราะ sd.cpp โหลด encoder/VAE แยกและปล่อยคืนได้ (`--offload-to-cpu`, `--vae-on-cpu`, `--clip-on-cpu`) — ตัวเลขนี้คือ "น้ำหนักที่ต้องอยู่ในหน่วยความจำพร้อมกัน" ไม่ใช่ RAM ทั้งหมด

### 11.3 ผลต่อแผน

* **Phase B เปลี่ยนเป้าหมาย**: ไม่ใช่ Qwen-Image-Edit แต่เป็น **(ก) FLUX.2-klein 4B** (Apache-2.0, 4 steps, ref edit) และ **(ข) Z-Image Turbo** (txt2img เร็ว) — ทั้งคู่น้ำหนักรวม < 8 GB
* **IP-Adapter Plus ย้ายขึ้นมาเป็น Phase B** (แทนที่จะเป็น Phase C): งานน้อยกว่า multi-file model มาก (เพิ่มไฟล์ 2 ไฟล์ + flag 3 ตัว) แต่ให้ "identity จากรูปเดียว" ซึ่งเป็นโจทย์ข้อ 2 ของผู้ใช้โดยตรง — และทำได้ทันทีหลังอัป tag ของ Metal build
* **Phase C ที่เหลือ**: ADetailer (ซ่อมหน้า — ตัวช่วยคุณภาพที่ถูกที่สุด), async job/preview/cancel, conditioning cache
* **Qwen-Image-2.1 / Qwen-Image-Edit 2511**: เก็บไว้สำหรับเครื่อง GPU 24 GB หรือ cloud — ไม่ใส่ในแผนเครื่องนี้

### 11.4 บันไดที่เสนอสำหรับเครื่อง 18 GB (เรียงตาม "ได้เท่าไหร่ ÷ ใช้หน่วยความจำเท่าไหร่")

1. **Phase A** (ไม่ใช้หน่วยความจำเพิ่มเลย) — ล้าง payload, reference ไปดิสก์, hires fix, recipe, prompt lock
2. **IP-Adapter Plus บน SDXL** (~3.4 GB เพิ่ม, identity จริง, ใช้เช็คพอยต์เดิม 6.6 GB)
3. **FLUX.2-klein 4B** (~5.9 GB) — โมเดลยุคใหม่ Apache-2.0 ตัวแรก, ref edit, 4 steps
4. **Z-Image Turbo** (~7.7 GB) — สำหรับเจนใหม่เร็ว ๆ / สายภาพสวย
5. **ADetailer** — ทำให้หน้าคมทุกเส้นทางข้างบน


---

## 12) บันทึกการลงมือทำ — Phase A (อัปเดต 2026-10-08)

ลงแล้ว 4 ชิ้น: **A1 (เลิกลาก base64 ทั้งก้อนไปกับทุกคำขอ) + A2 (reference อยู่บนดิสก์, localStorage เก็บแค่ URL) + A4 (route เสิร์ฟไฟล์ reference)** — commit `bd9addc` · **A3 (สูตร steps/CFG/sampler ต่อตระกูลโมเดล)** — commit `e336498`

### สิ่งที่เปลี่ยน

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `app/frontend/src/lib/reference-storage.mjs` (ใหม่) | ตรรกะ pure: `toPersistedReferences` (ตัด `src` ทิ้งเมื่อมีสำเนาบนดิสก์, จำกัด budget เมื่อไม่มี), `referencesNeedingHydration`, `referenceUrlFromAsset`, `referenceFileUrl`, `blobToDataUrl` |
| `app/frontend/src/services/api.js` | `generateImage` **ไม่ส่ง** `reference_images` / `reference_settings` / `reference_mode` อีก — เป็นฟิลด์ที่ backend ไม่อ่าน แล้วลบ `normalizeReferenceMode` ที่ตายแล้ว |
| `app/frontend/src/components/Generator.jsx` | เขียน localStorage ผ่าน `toPersistedReferences` + `REFERENCE_STORAGE_KEY`; เพิ่ม effect ดึงไฟล์จากดิสก์กลับมาเป็น `src` ตอนโหลด (รองรับ record เก่าที่มีแค่ `assetId`); `referencePayload` เก็บแค่ `assetId` + `url`; เตือนเมื่อมี reference ที่ไม่มีต้นฉบับ |
| `app/frontend/src/components/ReferenceManager.jsx` | เก็บ `url` จากผลอัปโหลด, `normalizeReference` คง `url`/`assetId`/`sourceMissing` ไว้ (เดิมสร้างใหม่แล้วทิ้ง), การ์์ดแสดง "Source missing" แทนรูปพัง |
| `scripts/server/serve.cjs` | `REFERENCE_OUTPUTS` ค่าคงที่เดียว, **`GET /api/reference-file?filename=`** (มี `pathInside` guard + `Cache-Control: immutable` เพราะชื่อไฟล์เป็น content-addressed), ผลอัปโหลดคืน `reference.url` |
| `app/frontend/src/lib/image-recipes.mjs` (ใหม่ — A3) | ตารางสูตร 8 ตระกูล (`z-image`, `qwen-image`, `flux-schnell`/`klein`, `flux-dev`/`kontext`, `lcm`, `sdxl-lightning`/`turbo`/`hyper`, `sdxl`, `sd15`) + `matchImageRecipe`/`recipePlan`/`describeRecipePatch` — จับคู่จากชื่อไฟล์, `recipePlan` แตะได้แค่ `steps`/`cfgScale`/`sampler` |
| `app/frontend/src/components/Settings.jsx` + `Settings.css` (A3) | ชิป "สูตรที่แนะนำ" เหนือสไลเดอร์ Detail Steps: บอกค่าที่จะเปลี่ยน + ปุ่ม "ใช้ค่าที่แนะนำ (steps 26 · CFG 6)" — **กดเองเท่านั้น** และอัปเดต `standardSteps`/`npuSteps` เหมือนสไลเดอร์ทำ |
| `scripts/validation/test-image-recipes.mjs` (ใหม่ — A3) | 47 checks: การจับคู่ (รวมชื่อซ้ำอย่าง `turbo`, path Windows, ไม่ตัด `v1.5`), patch แตะแค่ 3 คีย์, sampler ต้องมีจริงในรายการของ backend, โมเดลหลายไฟล์ต้องมีคำเตือน |
| `scripts/validation/test-image-reference-storage.mjs` (ใหม่) | 35 checks บนโมดูล pure (budget, ตัดสินใจ disk vs inline, hydration, การสร้าง URL) |
| `scripts/validation/test-image-reference-payload.cjs` (ใหม่) | 29 checks ระดับ source: ไม่มีฟิลด์ตายบน wire, metadata ไม่มี base64, route ฝั่งเซิร์ฟเวอร์ + guard, panel เก็บ URL |

### ผลตรวจ (รันจริงใน sandbox นี้)

* `vite build` ผ่าน (app/dist สร้างได้)
* eslint correctness ทั้งต้นไม้: **294 ไฟล์ 0 problems**
* `node scripts/validation/run-all.cjs` → **157 passed · 1 failed · 1 skipped** (ที่ fail คือ `validate-release.sh` เพราะ sandbox ไม่มี Python `imageio_ffmpeg` — สภาพแวดล้อม ไม่ใช่งานของเรา) · รายงาน `validation-reports/run-all-20261008-062340.txt`
  * หมายเหตุ: `test-frontend-dist-freshness.cjs` จะ fail ถ้าลืม `cd app/frontend && npx vite build` หลังแก้ซอร์ส — `app/dist` ในเครื่องคือบิลด์ที่ถูกเทสต์
* `test-frontend-api-contract.cjs`: frontend เรียก 307 URL · เสิร์ฟครบ 307 · ไม่มีอันไหนตกไปที่ "Unknown API endpoint" (route ใหม่ถูกตรวจแล้ว)

### ผลที่ผู้ใช้จะเห็น

* localStorage ไม่บวมอีกต่อไป (เก็บ URL ไม่ใช่ base64) → reference ไม่หายทั้งแผงเมื่อ quota เต็ม
* คำขอเจนแต่ละครั้งเล็กลงจาก ~MB–หลายสิบ MB เหลือ KB ต่อการ์ด
* metadata ของภาพที่บันทึกไม่ฝัง base64 ของรูปอ้างอิงอีก
* ถ้าไฟล์ต้นฉบับหาย ผู้ใช้**เห็นคำเตือน**พร้อมชื่อการ์ดที่ไม่มีต้นฉบับ แทนที่จะเจนออกมาเฉย ๆ โดยไม่มี reference

### ยังเหลือใน Phase A (ลำดับถัดไป — เรียงตาม "คุ้มต่อความเสี่ยง")

1. **Reference Router (§5)** — ให้ role/จำนวนภาพอ้างอิงเลือกเส้นทางเอง (denoise, strength, `ref_image_args`) ผู้ใช้ไม่ต้องตั้งค่า → ตรงกับเกณฑ์ข้อ 2 ของผู้ใช้ที่สุด และไม่ต้องโหลดโมเดลเพิ่ม
2. **สไลเดอร์ที่ยังไม่จริงใน `ReferenceManager.jsx`** — `Face Similarity` / `Reference Strength` / checkbox 4 ตัว ยังไม่ถึง backend (มีผลแค่ข้อความ prompt) → ทำให้มีผลหรือซ่อน (ปุ่มที่ไม่ทำอะไรแย่กว่าไม่มีปุ่ม)
3. **Hires fix 2 จังหวะ** — สลับเส้นทาง txt2img ไป `/sdapi/v1/txt2img` (`enable_hr`, `hr_upscaler`, `hr_scale`) หรือ `<sd_cpp_extra_args>` + UI toggle และต้องไม่พังเส้นทาง CoreML (apple-npu) ที่ใช้ร่วมกัน
4. **ยืนยัน `<sd_cpp_extra_args>{"ref_images":[…]}` บนไบนารีที่ปักหมุด** (`master-685-19bdfe2` บน Mac / `master-721` บน Windows) — ถ้าไม่ผ่าน ใช้ multipart `/v1/images/edits` ซึ่งมี `ref_images` ในตัวอยู่แล้ว
