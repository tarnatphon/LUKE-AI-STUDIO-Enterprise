# LinkedIn ในปฏิทินโพสต์ — ทำอะไรได้จริง ตั้งค่ายังไง และอะไรที่ทำไม่ได้

อัปเดตข้อมูล: **ตุลาคม 2026** · ใช้ร่วมกับแท็บ **ปฏิทิน** และ **Connectors** ใน
Social Agency · ต่อจาก `free-high-da-publishing-platforms.md` (ช่องทางฟรี) และ
`forum-and-community-posting.md` (ฟอรัม)

เอกสารนี้ตอบคำถาม: *“เพิ่ม LinkedIn เข้าไปในปฏิทินได้ไหม”*
**ได้** — และมีสองระดับที่ต้องแยกให้ชัด:

| ระดับ | ต้องมีอะไร | ทำอะไรได้ |
| :--- | :--- | :--- |
| **วางแผนอย่างเดียว** | ไม่ต้องมีอะไรเลย | ตั้งโพสต์ในปฏิทิน, เขียน/ตรวจแคปชัน (ลิมิต 3,000 ตัวอักษร), พรีวิว, แตกฉบับต่อแพลตฟอร์ม, คัดลอกข้อความ + เปิด LinkedIn เพื่อวางเอง |
| **โพสต์อัตโนมัติ** | Member Access Token ของคุณเอง (สิทธิ์ `w_member_social`) | ระบบโพสต์ให้จริงเป็น**โปรไฟล์ส่วนตัว** ข้อความ + รูป (รูปเดียว หรือ **รูปคู่** AI + รูปสินค้าจริง) ผ่าน Posts API |

---

## 1. ใช้ยังไง (3 ขั้น)

1. **ปฏิทิน → สร้างโพสต์** แล้วเลือกแพลตฟอร์ม **LinkedIn** (มีอยู่ในตัวเลือกแล้ว)
   หรือกด **วางแผนอัตโนมัติทั้งเดือน** — LinkedIn ถูกเลือกไว้แล้วในชิป “แพลตฟอร์ม/วัน”
   (ค่าเริ่มต้นคือ 5 ช่อง/วัน: Facebook · Instagram · LINE · LinkedIn · เว็บ) และได้เวลา
   ของตัวเองคือ **08:00 วันธรรมดา / 09:30 วันหยุด** ไม่ชนกับช่องอื่น ·
   เอาออกได้ด้วยการคลิกชิป LinkedIn ให้หลุด
2. เขียนแคปชันตามปกติ — ระบบบังคับลิมิต **3,000 ตัวอักษร / แฮชแท็กไม่เกิน 5**
   (เกินแล้วจะบอกก่อน ไม่ตัดเงียบ ๆ) และมี `ตัวอย่างสำเร็จรูป` ให้เลือกได้เหมือนช่องอื่น
3. ถ้าต้องการให้โพสต์จริง: **Connectors → LinkedIn** ใส่ token → กด
   **ทดสอบและดึง URN** → ปิด dry-run ของ LinkedIn
   (ยังไม่มี token? รัน `node scripts/social-agency-linkedin-token.cjs --prompt --save`
   คำสั่งเดียวจบ — ดูข้อ 2.2)
   ถ้าไม่ใส่ token: กด **รันเลยตอนนี้** ได้ตามปกติ แต่ผลจะเป็น dry-run (ไม่มีอะไรถูกส่ง)
   และใช้ปุ่ม **คัดลอกข้อความ** + **เปิด LinkedIn** ในหน้าโพสต์เพื่อวางเอง

---

## 2. ตั้งค่า token (ต้องทำเองฝั่ง LinkedIn — แอปนี้ไม่มี OAuth ในตัว)

LinkedIn **ไม่มีปุ่ม “สร้าง token”** ให้กดเหมือน LINE/Discord หรือ Facebook
ต้องสร้างแอปของตัวเองแล้วทำ OAuth 2.0 authorization-code flow หนึ่งครั้ง
สคริปต์ `scripts/social-agency-linkedin-token.cjs` พาเดินทั้ง flow ให้
(ไม่ต้องพิมพ์ `curl` เอง ไม่ต้องเปิดเซิร์ฟเวอร์รับ callback)

### 2.1 เตรียมแอปฝั่ง LinkedIn (ทำครั้งเดียว)

1. ไปที่ <https://developer.linkedin.com/> → **Create app** (ผูกกับ Page ของบริษัทได้
   แม้จะโพสต์ในนามบุคคล) แล้วเพิ่มผลิตภัณฑ์ **Share on LinkedIn** (ให้สิทธิ์
   `w_member_social` — ไม่ต้องรอรีวิว) และ **Sign In with LinkedIn using OpenID
   Connect** (ให้ `openid profile` มาดึงชื่อ/URN)
2. ในหน้า **Auth** ของแอป เพิ่ม **Authorized redirect URL** — ต้องเป็น `https://…`
   ที่ไม่ใช่ `localhost` และ **ตรงทุกตัวอักษร** กับที่ใส่ในสคริปต์
   (หน้านั้นจะเปิดขึ้นมาเป็น error/404 ก็ไม่เป็นไร เราแค่ต้องการ `?code=…` ในแถบที่อยู่)
   ⚠️ **สำคัญ:** ถ้าเว็บปลายทางเด้งต่อไปหน้าอื่น (เช่น 404 → หน้าแรก) `?code=…`
   จะหายไปก่อนคุณก๊อป — เลือก URL ที่ **ไม่เด้ง** เช่นไฟล์นิ่งที่มีอยู่จริงบนเว็บคุณ
3. คัดลอก **Client ID / Client Secret** ไว้

### 2.2 ขอ token + เขียนลงแอปด้วยคำสั่งเดียว

```bash
node scripts/social-agency-linkedin-token.cjs --prompt --save --client thai-modern-bags
```

1. สคริปต์ถาม **Client ID / Client Secret / Redirect URL** (ค่าที่เป็นความลับไม่แสดงบนจอ
   และไม่ลง shell history — ไม่ต้องพิมพ์ต่อท้าย command)
2. เปิดเบราว์เซอร์ให้เอง (หรือก๊อป URL ที่พิมพ์ออกมาไปเปิด) → กด **Allow**
3. เบราว์เซอร์เด้งไปที่ Redirect URL — **ก๊อป URL จากแถบที่อยู่ทั้งบรรทัด** มาวาง
   (มี `?code=…&state=…`) สคริปต์ตรวจ `state` ว่าเป็นรอบที่เพิ่งเริ่มจริง
   · วางเฉพาะ **ค่าที่อยู่หลัง `code=`** ก็ได้ (บางคนก๊อปจากแถบที่อยู่ได้ไม่ครบ)
   · วางผิด ระบบ **ไม่ตัดจบ** — จะบอกว่า "ได้รับอะไรมา" (เช่น
   `ได้รับ: thaimodernbags.com/li-callback · ไม่มีพารามิเตอร์`) แล้วถามซ้ำได้อีก 2 ครั้ง
   · ถ้าข้อความบอกว่าเป็นหน้า **"เข้าสู่ระบบ"** แปลว่าเบราว์เซอร์ที่เปิดลิงก์ยังไม่ได้
   ล็อกอิน LinkedIn — ล็อกอินให้เสร็จแล้วกด Allow ต่อ (ระบบถามซ้ำให้อยู่แล้ว)
   · ถ้าข้อความบอกว่าเป็นหน้า **"ขออนุญาต"** แปลว่า LinkedIn ยังไม่เด้งกลับ →
   ตรวจว่าแท็บ Products มีผลิตภัณฑ์ครบทั้งสองตัว และ Redirect URL ตรงทุกตัวอักษร
   · ถ้าขึ้นว่าให้ Client Secret ได้ Client ID มา → ระบบหยุดทันที (ยังไม่ยิงเน็ต)
4. สคริปต์แลก code เป็น token → เรียก `/v2/userinfo` → ได้ `urn:li:person:…`
   แล้ว **เขียน `accessToken` + `authorUrn` + `tokenSavedAt` ลง `connectors.json`**
   ของลูกค้ารายนั้นให้เลย (**dry-run ยังเปิดอยู่** ต้องไปปิดเองใน Connectors)

คำสั่งอื่นที่ใช้บ่อย:

```bash
node scripts/social-agency-linkedin-token.cjs                    # ขอ token แล้วพิมพ์ให้คัดลอก (ไม่บันทึก)
node scripts/social-agency-linkedin-token.cjs --check --client thai-modern-bags   # token ที่บันทึกไว้ยังใช้ได้ไหม + URN ตรงหรือเปล่า
node scripts/social-agency-linkedin-token.cjs --curl              # ไม่ต่อเน็ต: พิมพ์คำสั่ง curl เทียบเท่าให้ไปรันเอง
node scripts/social-agency-linkedin-token.cjs --json --reveal     # ผลเป็น JSON พร้อม token เต็ม (เฉพาะตอนต้องการจริง ๆ)
node scripts/social-agency-linkedin-token.cjs --code CODE_THAT_YOU_COPIED --redirect https://thaimodernbags.com/li-callback --prompt --save   # ใส่เฉพาะ code (ไม่ตรวจ state)
```

`--client` ต้องเป็น **ID ลูกค้าในแอป** (เช่น `thai-modern-bags` หรือ `client-1a2b3c4d`)
ไม่ใช่ชื่อที่แสดง — ดู ID จริงได้จาก `node scripts/verify-linkedin-post-readiness.cjs --list`

> token ถูกปิดบังเสมอในผลลัพธ์ปกติ (`li-m…567890`) · Client Secret ไม่ถูกพิมพ์กลับ
> · ไม่มี `--listen`/localhost callback เพราะ LinkedIn ไม่รับ redirect แบบนั้น

### 2.3 หลังได้ token

เปิดแอป → **Connectors → LinkedIn** → กด **ทดสอบและดึง URN** (จะขึ้นชื่อบัญชีที่ token
เป็นของเจ้าของ) → **ปิด dry-run** ของ LinkedIn → จากนั้นโพสต์จะส่งจริง

> **อายุ token ~60 วัน และ LinkedIn ไม่มี refresh token สำหรับ member token** —
> หมดอายุแล้วต้องรัน `--prompt --save` ใหม่ (สคริปต์บอกวันหมดอายุให้ตอนได้ token
> และ `--check` บอกว่าเหลืออีกกี่วัน)

### 2.4 รู้ล่วงหน้าเมื่อ token ใกล้หมด

แอปบันทึกวันที่คุณวาง token (`connectors.linkedin.tokenSavedAt`) แล้วคำนวณวันหมดอายุ
ให้เอง — **Connectors → LinkedIn** จะขึ้นข้อความ:

| เหลืออีก | สิ่งที่เห็น |
| :--- | :--- |
| มากกว่า 21 วัน | ไม่มีอะไรขึ้น (ไม่กวน) |
| 8–21 วัน | บรรทัดเตือนเงียบ ๆ ว่าอีก N วันจะหมด และ LinkedIn ไม่มี refresh token |
| 0–7 วัน | แถบเตือนสีแดง + คำสั่ง `node scripts/social-agency-linkedin-token.cjs --prompt --save` ให้คัดลอก |
| หมดอายุแล้ว | แถบเตือนว่า **โพสต์ LinkedIn จะถูกปฏิเสธ** |

ถ้า token ถูกวางไว้ตั้งแต่ก่อนมีฟีเจอร์นี้ (ไม่มีวันที่บันทึก) ระบบจะ**ไม่เดา**วันหมดอายุ
— วาง token เดิมซ้ำหนึ่งครั้งหรือขอใหม่ ระบบจะเริ่มนับให้

### 2.5 `--check` บอกด้วยว่า "แล้วต้องทำอะไรต่อ"

`--check` ไม่ได้ตอบแค่ว่า token ใช้ได้ แต่สรุปปฏิทินให้ในรอบเดียว:

```
✓ token ใช้ได้ — บัญชี … (urn:li:person:…)
  บันทึก token ไว้เมื่อ 2026-10-28 (0 วันก่อน) — เหลืออีกประมาณ 60 วัน (หมดอายุประมาณ 2026-12-27)
── ภาพรวมก่อนโพสต์จริง ─────────────────────────────────
  รายการ LinkedIn ในปฏิทิน: 12 (ยังไม่โพสต์ 12 · โพสต์แล้ว 0)
  ยังไม่ยืนยันภาพ: 3 → node scripts/social-agency-review-images.cjs --list
  รายการแรกที่ยังไม่พร้อม: cal-… · 2027-04-20 08:00 · SSB-009
    ✗ ด่านตรวจภาพ: ยังไม่ได้ตรวจภาพในหน้าโพสต์
    → node scripts/social-agency-review-images.cjs --confirm cal-…
```

`--json` ให้ข้อมูลเดียวกันเป็นฟิลด์ (`tokenDaysLeft`, `plan.firstBlocked`, …)
ใช้ต่อในสคริปต์ได้

---

## 3. สิ่งที่ระบบทำจริงตอนโพสต์

1. **รูป** (ถ้ามี): `POST /rest/images?action=initializeUpload` → อัปโหลดไบต์ไปที่
   `uploadUrl` ที่ได้ → เก็บ `urn:li:image:…` (URL อัปโหลดใช้ได้ครั้งเดียว)
   (รูปต้องผ่าน **ด่านตรวจภาพ** เหมือน Facebook/Instagram — คนต้องกดยืนยันก่อน)
   - **รูปคู่เหมือน Facebook/Instagram:** ถ้าเปิดสวิตช์ *แนบรูปสินค้าจริงในโพสต์*
     ระบบอัปโหลด **2 รูป** — รูป AI ก่อน แล้วรูปสินค้าจริง — และส่งเป็นโพสต์หลายรูป
     `content.multiImage.images = [รูป AI, รูปจริง]`
   - เปิดสวิตช์ไว้แต่ไม่พบรูปสินค้าจริงในเครื่อง → **ไม่โพสต์** และบอกเหตุผล
     (ไม่ลดรูปเหลือรูปเดียวเงียบ ๆ) เหมือนช่อง Facebook
   - ปิดสวิตช์ → โพสต์รูปเดียว `content.media` ตามปกติ
2. **โพสต์**: `POST /rest/posts` พร้อม header ที่ LinkedIn บังคับ
   `Linkedin-Version: YYYYMM` + `X-Restli-Protocol-Version: 2.0.0`
   และ `author: urn:li:person:…`
3. เก็บ `x-restli-id` จาก response เป็น Post ID ของรายการในปฏิทิน

### 3.1 กับดักที่คนพลาดกันบ่อย: ข้อความถูกตัดเงียบ ๆ

LinkedIn อ่าน `commentary` เป็นรูปแบบ **“little text”** — ตัวอักษร
`\| { } @ [ ] ( ) < > # * _ ~ \` เป็น markup ถ้าส่งดิบ ๆ โพสต์จะถูก**ตัดตั้งแต่ตัวแรก**
ที่เจอ (วงเล็บราคา alone ก็พอ) และ API ยังตอบ 201 เหมือนสำเร็จ
ระบบนี้จึง escape ให้ทั้งหมด และแปลงแฮชแท็กเป็น `{hashtag|\#|ชื่อแท็ก}` เพื่อให้ยังกดได้
ตัวอย่าง: `ราคา (30 บาท) #กระเป๋าผ้า` → `ราคา \(30 บาท\) {hashtag|\#|กระเป๋าผ้า}`

---

## 4. สิ่งที่ทำไม่ได้ (บอกตรง ๆ)

| อยากได้ | สถานะจริง | ทางที่ใกล้ที่สุด |
| :--- | :--- | :--- |
| โพสต์ลง **เพจบริษัท** | ต้องขอผลิตภัณฑ์ **Community Management** ซึ่ง LinkedIn อนุมัติเป็นรายแอป | โพสต์ในนามโปรไฟล์ส่วนตัว หรือโพสต์ที่เพจด้วยมือ |
| OAuth ในแอป (กดปุ่มเดียวเชื่อม) | ยังไม่มี — ต้องทำ flow ฝั่งคุณและวาง token | ตามหัวข้อ 2 |
| ตั้งเวลาโพสต์แบบไม่ต้องเปิดแอป | scheduler ทำงานเมื่อแอป/เซิร์ฟเวอร์เปิดอยู่ | เปิดแอปทิ้งไว้ หรือโพสต์เองตามปฏิทิน |
| วิดีโอ/เอกสาร (PDF) | ยังไม่รองรับผ่านเส้นทางนี้ — ระบบจะ **แจ้งเตือน** ไม่ปล่อยผ่านเงียบ ๆ | อัปโหลดวิดีโอ/เอกสารเองบน LinkedIn |
| ตัวเลข engagement ย้อนหลัง | ต้องใช้สิทธิ์อ่าน (`r_member_social` / analytics ของเพจ) | กรอกยอดเองในหน้าโพสต์ (มีช่องให้กรอก) |
| แชร์ลิงก์ที่มีข้อความพรีฟิล 100% | LinkedIn ไม่รับพารามิเตอร์ข้อความผ่านลิงก์แล้ว (เหลือแค่ `url`) | คัดลอกข้อความจากแอปแล้ววางในช่องเขียนโพสต์ |

---

## 5. ตรวจความพร้อมก่อนถึงเวลาจริง (สคริปต์)

### 5.0 ด่านแรกที่ทุกโพสต์ติด: ยืนยันภาพ (กดทีละ 20–30 ใบไม่ได้)

หลัง **วางแผนอัตโนมัติทั้งเดือน** โพสต์ที่มีรูปจะยังส่งจริงไม่ได้จนมีคนกด
**“ตรวจภาพแล้ว”** ทีละใบ — ตัวช่วยนี้ไล่คิวให้จาก terminal:

```bash
node scripts/social-agency-review-images.cjs --list                 # ใครยังไม่ยืนยัน + คำสั่งของแต่ละใบ
node scripts/social-agency-review-images.cjs --platform linkedin    # เฉพาะ LinkedIn
node scripts/social-agency-review-images.cjs --open ENTRY_ID        # เปิดไฟล์รูปให้ดูก่อน
node scripts/social-agency-review-images.cjs --confirm ENTRY_ID     # ยืนยันว่า "ตรวจภาพแล้ว"
```

- ทุกบรรทัด `→` ที่พิมพ์ออกมา **รันได้เลย** และหลังยืนยัน 1 ใบ มันจะบอกคำสั่งของใบถัดไป
- โพสต์ที่ **ยังไม่มีภาพ** จะถูกแยกไว้ต่างหาก (ยังตรวจไม่ได้ — ต้องสร้างภาพในแอปก่อน)
- `--confirm` เดินผ่าน `reviewEntryImage` ตัวเดียวกับปุ่มในแอป: ภาพที่ถูกปฏิเสธไว้
  ภาพที่เปลี่ยนไฟล์หลังตรวจ และโพสต์ที่กำลังเผยแพร่ จะถูกปฏิเสธพร้อมเหตุผลเหมือนเดิม
- เขียนเฉพาะผลตรวจภาพของรายการที่สั่ง **ไม่เปลี่ยนสถานะโพสต์ ไม่เริ่มเวิร์กโฟลว์ ไม่เผยแพร่**
  (ต่างจากตัวตรวจในข้อ 5.1 ที่อ่านอย่างเดียว 100%)

### 5.1 ตัวตรวจความพร้อม (อ่านอย่างเดียว)

ก่อนวันโพสต์ ให้รันตัวตรวจที่อ่านอย่างเดียว (ไม่แก้สถานะ ไม่โพสต์อะไร):

```bash
node scripts/verify-linkedin-post-readiness.cjs --list          # ดูว่ามี SKU / รายการอะไรให้ตรวจ
node scripts/verify-linkedin-post-readiness.cjs --sku SSB-009
node scripts/verify-linkedin-post-readiness.cjs --entry cal-12345678-abc --trigger manual
node scripts/verify-linkedin-post-readiness.cjs --sku SSB-009 --online
```

> **อย่าพิมพ์ `<id>` ใน terminal** — zsh อ่าน `<` เป็นการ redirect แล้วจะขึ้น
> `no such file or directory: id` · ในเครื่องหมาย help/เอกสารนี้ ช่องที่ต้องแทนค่าจริง
> เขียนเป็น `ENTRY_ID` / `SKU` / `CLIENT_ID` (ตัวพิมพ์ใหญ่ ไม่มีวงเล็บมุม)
> และ `--list` จะพิมพ์บรรทัด `→ node … --entry …` **ด้วย ID จริงของรายการนั้น**
> ให้คัดลอกไปรันได้เลย

> `cal-xxxx` ในตัวอย่างคือ **ชื่อสมมติ** ไม่ใช่ ID จริง — ถ้าพิมพ์ตามตรง ตัวตรวจจะบอกว่า
> “เป็นตัวอย่างจากวิธีใช้งาน ต้องใส่ ID จริง” และแนะนำให้รัน `--list` เพื่อดู ID ที่มีอยู่

ด่านที่ตรวจ: ไฟล์สถานะ/ลูกค้า · token + dry-run · **Linkedin-Version ไม่หมดอายุ** ·
**Author URN เป็น `urn:li:person:`** (URN ของเพจบริษัทจะไม่ผ่าน พร้อมบอกเหตุผล) ·
**อายุ token 60 วัน** (นับจากวันที่วาง token) · **รูปสินค้าจริงสำหรับรูปที่ 2** ·
รายการในปฏิทิน (ไม่ใช่วิดีโอ/ไม่ได้โพสต์ไปแล้ว) · **ด่านตรวจภาพ** ·
แคปชันหลัง escape เป็น little text (≤3,000 ตัวอักษร, แฮชแท็ก ≤5, มีตัวอย่างข้อความจริง) ·
**จังหวะการกดส่ง** (`รันเลยตอนนี้` บนโพสต์อนาคตจะกลายเป็น dry-run)

`--online` เพิ่มการยิง LinkedIn แบบอ่านอย่างเดียว:

- `GET /v2/userinfo` → ยืนยันว่า token เป็นของคนเดียวกับ `authorUrn` (จับเคส “วาง token ผิดบัญชี”
  ที่ปุ่มทดสอบในแอปจับไม่ได้เสมอ) และบอกชื่อบัญชี
- `POST /rest/images?action=initializeUpload` → ยืนยันว่ามีสิทธิ์อัปโหลดรูปจริง
  (จองสิทธิ์เท่านั้น **ไม่อัปโหลดไบต์และไม่สร้างโพสต์**)
- token ถูกปิดบังเสมอ (`li-m…567890`) และถ้า LinkedIn ส่ง token กลับมาในข้อความ error จะถูกแทนด้วย `‹redacted›`

สัญลักษณ์ในผลตรวจ: `✓` ผ่าน · `!` คำเตือน (ไม่บล็อก) · `–` **ข้าม** (ยังไม่ได้รัน เช่น ขอ `--online`
แต่ยังไม่มี token — ระบบบอกตรง ๆ ไม่ปล่อยเงียบ) · `✗` ไม่ผ่าน

`--strict` ทำให้คำเตือนใด ๆ นับเป็น “ไม่พร้อม” (exit 1) เหมาะกับใช้ก่อนปล่อยโพสต์สำคัญ
ผลรวม exit code: **0 = พร้อม**, **1 = ยังไม่พร้อม** (ใช้ใน CI หรือก่อนกดส่งได้)

---

## 6. Checklist ก่อนใช้จริง

1. token สิทธิ์ `w_member_social` + `openid profile` และยังไม่หมดอายุ 60 วัน
   (เช็กเร็ว ๆ: `node scripts/social-agency-linkedin-token.cjs --check --client thai-modern-bags`)
2. `authorUrn` ขึ้นต้นด้วย `urn:li:person:` และเป็นบัญชีที่คุณต้องการโพสต์
3. ปิด **dry-run ของ LinkedIn** ใน Connectors (ค่าเริ่มต้นคือเปิด)
4. ถ้าโพสต์มีรูป: กดยืนยัน **ด่านตรวจภาพ** ก่อน ไม่งั้นระบบจะไม่ส่ง
   (ทำจาก terminal ทีละใบได้: `node scripts/social-agency-review-images.cjs --list`)
5. แคปชันไม่เกิน 3,000 ตัวอักษร (นับรวมส่วนติดต่อแบรนด์และแฮชแท็ก)
6. ระวังโพสต์ถี่ — LinkedIn ไม่ได้ประกาศลิมิตชัดเจน แต่บัญชีใหม่ที่โพสต์รัว ๆ
   มีโอกาสถูกจำกัดการมองเห็น แนะนำ 1 โพสต์/วัน/บัญชี

---

## 7. แหล่งอ้างอิง

- Posts API: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api>
- Images API: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api>
- little text (การ escape): <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format>
- Versioning (`Linkedin-Version`): <https://learn.microsoft.com/en-us/linkedin/marketing/versioning>
- OAuth 2.0 (authorization code + `/oauth/v2/accessToken`): <https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow>
- OpenID Connect `/v2/userinfo`: <https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2>
- Share on LinkedIn (ผลิตภัณฑ์ self-serve): <https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin>
