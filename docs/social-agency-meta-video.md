# Social Agency: เผยแพร่วิดีโอหลังเลิกใช้ 0x0.st

- Facebook Page: ส่งไฟล์จากเครื่องตรงไป Graph `/{page-id}/videos` เป็น multipart `source` (เดิมทำแบบนี้อยู่แล้ว)
- Instagram Reels: สร้าง `/{ig-id}/media` โดย `media_type=REELS, upload_type=resumable` → ส่งไฟล์ตรงไป `rupload.facebook.com/ig-api-upload/{version}/{container-id}` ด้วย `Authorization: OAuth`, `offset: 0`, `file_size` → รอ `FINISHED` → `media_publish` ไม่ส่งวิดีโอไปโฮสต์สาธารณะก่อน
- LINE: API ต้องการ URL สาธารณะของทั้งวิดีโอและภาพตัวอย่าง จึง **ไม่ได้** แก้ด้วย Meta rupload; กรอก URL HTTPS ของโฮสต์ที่คุณควบคุมใน drawer ของโพสต์ LINE (หรือเลือกใช้เฉพาะรูป/ข้อความ) ไม่มีการอัปโหลดไป 0x0.st และหากวิดีโอไม่พร้อมจะไม่ broadcast รูปแทนโดยเงียบ ๆ
- หาก FB/IG วิดีโอส่งไม่ผ่าน งานล้มโดยแจ้งสาเหตุ ไม่แอบเผยแพร่รูปแทน

Graph API ค่าเริ่มต้นเป็น v25.0; เลือกเวอร์ชันต่อ connector ได้ใน Connectors และหน้า UI เตือนภายใน 120 วันก่อนวันหมดอายุ ตาม [ตาราง Meta](https://developers.facebook.com/docs/graph-api/changelog/versions) (v21.0 หมดอายุ 21 ม.ค. 2027 ไม่ใช่ 2 ต.ค. 2026)

## ทดสอบ

```bash
node scripts/server/social-agency-groups-smoke.cjs
node scripts/server/social-agency-metrics-smoke.cjs
node scripts/server/social-agency-tracking-ab-smoke.cjs
cd app/frontend && npm ci && npm run build
```

Smoke test จำลอง Graph/rupload ไม่ใช้บัญชีจริง: ตรวจ payload ไบนารี, การสร้าง container, การ publish, และความล้มเหลวที่ไม่กลายเป็นโพสต์รูป สำหรับ live test ต้องใช้บัญชีทดสอบที่เจ้าของอนุญาต, token/permissions ที่ใช้เผยแพร่ได้, ปิด dry-run, และใช้โพสต์ที่ครบกำหนด (การกดรันโพสต์ในอนาคตจะเป็น dry-run) หลังส่งควรตรวจโพสต์ใน Facebook/Instagram จริง เพราะ smoke test ไม่ยืนยันสิทธิ์และการประมวลผลของ Meta

เอกสาร API: [IG Content Publishing / Resumable Upload](https://developers.facebook.com/documentation/instagram-platform/content-publishing), [FB Video API](https://developers.facebook.com/documentation/video-api/guides/publishing).

## Performance loop (FB/IG)

- หลังโพสต์ live ครบ 5 นาที scheduler จะซิงค์โพสต์ครั้งละไม่เกิน 1 รายการ/นาที; ซิงค์ซ้ำทุก 6 ชม. ใน 48 ชม.แรก จากนั้นทุก 24 ชม. จนถึงอายุ 30 วัน (ต้องเปิด scheduler) กดดึงทันทีใน drawer หรือกดซิงค์สูงสุด 3 โพสต์ใน Insights ได้
- FB feed ใช้ summary ของ reactions/comments และ shares.count; FB video/รูปที่ Graph ส่งคืนแค่ photo ID ใช้ likes/comments (ไม่อ้างว่าแชร์/วิวเป็นศูนย์) ส่วน IG ใช้ like_count/comments_count; shares และ views (Reels) จาก media insights เมื่อมีสิทธิ์ อ่านค่าไม่พบ = “—” ไม่ใช่ 0
- IG media insights ต้องมี `instagram_manage_insights` และ `pages_read_engagement` ตาม [เอกสาร Meta](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights); เพิ่ม User Access Token ที่มีสิทธิ์อ่าน Insights แยกใน Connectors ได้ ถ้าเว้นว่างจะลองใช้ token เผยแพร่เดิม API อาจตอบ error ซึ่ง UI จะแสดง ไม่ทำให้โพสต์ล้ม
- ใครกรอกยอดเอง ระบบไม่เขียนทับช่องนั้น ลบค่าในช่องแล้วบันทึกเพื่อกลับไปใช้ค่าจาก Meta; ยอดอาจล่าช้าถึง 48 ชม. ถ้า API ไม่ส่ง field ระบบไม่สร้างศูนย์ขึ้นเอง
- auto-plan ใช้โพสต์ live ที่มีไลก์+คอมเมนต์ อายุ 48 ชม.–90 วัน และต้องมีอย่างน้อย 3 รายการ *ต่อกลุ่มเปรียบเทียบ 2 กลุ่ม* จึงจะเพิ่มน้ำหนักแพลตฟอร์มหรือเลือกชั่วโมงจริง หากไม่พอใช้ rotation/เวลาปกติ; จะแสดงที่มาบนหน้าพรีวิวแผน

## UTM และ A/B hook (เลือกสร้างเท่านั้น)

- ตอน **เผยแพร่ live** ระบบเติม `utm_source={facebook|instagram|line}`, `utm_medium=social`, `utm_campaign={client-id}`, `utm_content={entry-id}` ให้ลิงก์ HTTP(S) ในแคปชันที่ส่งออก (ไม่แก้ draft, URL รูป/วิดีโอ หรือ URL หลักฐานสินค้า) ถ้ามี UTM เดิมจะอัปเดตค่าโดยไม่เพิ่มซ้ำ ป้องกัน LINE >400 / IG >2200 หลังเติม UTM โดยแจ้งให้แก้แทนการตัดลิงก์ทิ้ง
- Insights มีรายงาน **ลิงก์ที่เผยแพร่แล้ว** แยกตามแพลตฟอร์ม ใช้ utm_content หาโพสต์ต้นทางได้ แต่ **ไม่มีจำนวนคลิกจากเว็บ** จนกว่าจะเชื่อมเครื่องมือ Analytics ของเว็บไซต์ เช่น GA4; ลิงก์ในแคปชัน Instagram กดไม่ได้โดยตรง ต้องใช้ช่องทางที่คลิกได้ (เช่น link in bio)
- ใน drawer ของโพสต์ FB/IG ที่ยังไม่เผยแพร่และมี hookVariants ≥2 เลือก hook A/B และเวลาเช้า/เย็นในวันเดียวกัน ต้องเป็น connector live และกดยืนยันก่อนสร้าง ระบบเก็บต้นฉบับไม่ให้โพสต์เป็นรายการที่สาม สร้างโพสต์ใหม่ 2 รายการที่ใช้เนื้อหาส่วนอื่นและสื่อเดียวกัน แต่เปลี่ยน hook และเวลา ทั้งคู่ยังผ่าน workflow/AI Check ตามปกติ; หากคะแนนไม่ผ่านต้องอนุมัติเอง
- ยกเลิกชุดทดสอบได้ก่อนโพสต์ใดเผยแพร่; ห้ามสร้างสื่อใหม่ทับในรายการ A/B เพราะสองโพสต์แชร์ไฟล์สื่อเดิม เมื่อทั้งคู่ live ≥48 ชม. และมีไลก์+คอมเมนต์ครบ จะแสดงผลเทียบใน Insights โดยวัดไลก์+คอมเมนต์ (**ผล hook + เวลา รวมกัน ไม่ใช่การพิสูจน์ hook อย่างเดียว**)

ยังไม่ได้ทำ: TikTok และ progress/polling งานสร้างสื่อ
