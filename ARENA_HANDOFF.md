# ARENA_HANDOFF.md — บันทึกส่งต่องานระหว่าง session

> **อัปเดตล่าสุด:** 2026-10-29 (session `arena/e0ec6e1b-luke-ai-studio-enterprise` — **รูปที่ได้ไม่มีกระเป๋าเลย: พรอมป์ภาพบอกโมเดลว่า "product"** ผู้ใช้ส่งพรอมป์ของ SSB-013 มาแล้วพบว่า `Professional product photography of product (SSB-013) …` ไม่มีคำว่ากระเป๋าสักคำ เพราะ `buildTemplateImagePrompt()` หาคำอังกฤษตามลำดับ แปลจาก LLM → category อังกฤษ → คำอังกฤษในชื่อ → คำอังกฤษใน detail → **`"product"`** และของ SSB-013 ตกทุกขั้น (ชื่อ `กระเป๋าใส่รองเท้า SSB-013` มีอังกฤษแค่ SKU ที่ถูกกรองออก · category ไทย · detail ไม่มีอังกฤษ · `_llmTranslateForPrompt()` คืนว่างเพราะ `_llmReady()` เป็น false) → โมเดลวาดโต๊ะไม้สวย ๆ ที่ไม่มีกระเป๋า **(1) พจนานุกรมไทย→อังกฤษแบบตายตัว** `THAI_PRODUCT_GLOSSARY` + `imageItemForProduct()` (บริสุทธิ์, มีเทสต์) ทำงาน **ก่อน** LLM: `กระเป๋าใส่รองเท้า`→`shoe bag`, `กระเป๋ากล้อง`→`camera bag`, `กระเป๋าผ้า`→`fabric bag`, `กระเป๋าโน๊ตบุ๊ค`→`laptop bag`, `กระเป๋าเชือกรูด`→`drawstring bag`, `กระเป๋าสะพาย`→`shoulder bag`, `กระเป๋าสตางค์`→`wallet`, `ถุงผ้า`→`cloth bag`, `กระเป๋าเป้`→`backpack` ฯลฯ · **คำที่ยาวกว่าชนะ** (`กระเป๋าใส่รองเท้า` ไม่ใช่แค่ `bag`) และคำที่ซ้อนกันถูกตัดออก (`กระเป๋าผ้าใบใหญ่` = `Fabric bag` ไม่ใช่ `fabric bag canvas`) · คำอังกฤษที่อยู่ในชื่อยังถูกเก็บ (`กระเป๋าผ้า Tote Bag` → `Fabric bag Tote`) · **ถ้าพจนานุกรมรู้จักคำแล้วจะไม่เรียก LLM เลย** (เร็วขึ้นหนึ่งรอบต่อโพสต์ และพรอมป์เหมือนกันทุกเครื่อง ไม่ว่า LLM จะเปิดหรือปิด) · ใช้ทั้งพรอมป์ภาพ, พรอมป์วิดีโอ (animate) และพรอมป์ที่สร้างจากแคปชัน **(2) ไม่เงียบเมื่อไม่รู้จักสินค้า** — ด่านใหม่ `image_prompt` ใน `verify-linkedin-post-readiness.cjs`: `prompt ไม่มีชื่อสินค้า (ได้แค่ "product") — รูปที่ได้จะไม่มีกระเป๋าหรือตัวสินค้าอยู่ในภาพ` (warn + วิธีแก้ · `--strict` ทำให้เป็นตัวบล็อก · โพสต์ที่เผยแพร่แล้วยังเตือนได้และยัง exit 0) · `social-agency-review-images.cjs --list` เพิ่มหัวข้อ **พรอมป์ภาพที่ไม่มีชื่อสินค้า (N)** พร้อม id และ `--json` มีฟิลด์ `promptIssues`/`promptMissesProduct` · **พรอมป์เก่าถูกซ่อมให้เอง** เมื่อกด “สร้างภาพ” (`_ensureEntryImagePrompt`/`_ensureEntryAnimatePrompt` สร้างใหม่เฉพาะเมื่อของเดิมขึ้นต้นด้วย `of product` และของใหม่ระบุสินค้าได้จริง — พรอมป์ที่ดีอยู่แล้วไม่ถูกแตะ) **(3) เทสต์**: ใหม่ `test-social-agency-image-prompt-subject.cjs` **15 checks** (ชื่อไทยล้วน+SKU ต้องมีคำว่า bag · LLM ปิดก็ผ่าน · พจนานุกรมมาก่อน LLM (calls = 0) · ไม่มีทางได้พรอมป์ขึ้นต้นด้วย product · ซ่อมพรอมป์เก่า · animate · พรอมป์จากแคปชัน · ตัวตรวจ warn/pass/skip · โพสต์ที่เผยแพร่แล้ว exit 0 แม้ `--strict` · `--list` ชี้รายการ) · `test-social-agency-prompt-translation.cjs` **6 checks** (แก้ข้อที่ยืนยัน category เดิม: ตอนนี้พจนานุกรมชนะ `Canvas bags` และเพิ่มเคสที่พจนานุกรมไม่รู้จักจึงตกไป category จริง) · `social-agency-groups-smoke.cjs` แก้ assertion ที่ยืนยัน `Camera bags` เดิม (ไฟล์นี้ยังมี FAIL เดิมที่ `demo stays verbatim` ซึ่งมีอยู่ก่อนรอบนี้) · เอกสาร `docs/beta7/linkedin-posting.md` เพิ่ม 5.0.3 · run-all **174 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-29 (session `arena/f8a2b926-luke-ai-studio-enterprise` — **โพสต์ LinkedIn แรกขึ้นจริงแล้ว** (`urn:li:ugcPost:7521421999051751424` · SSB-013 · `thai-modern-bags`) และเจอบั๊ก 2 ตัวจากขั้นตอนจริง: **(1) `review-images --open ENTRY_ID` ตอบ “ไม่พบรายการ true”** — `open` ถูกใส่ไว้ใน `BOOLEAN_FLAGS` ทั้งที่มันรับค่า ทำให้ `--open cal-…` ตั้ง `open=true` แล้ว id ตกไปเป็น argument “true” → เอา `open` ออกจาก boolean set (เหลือ `help/json/list`) และเพิ่มเทสต์ยืนยันว่า `--open cal-…` ได้ค่าเป็น id จริง **(2) ตัวตรวจตีโพสต์ที่เผยแพร่แล้วเป็น ❌ “ยังไม่พร้อมโพสต์ LinkedIn จริง”** ทั้งที่ postId มีอยู่ → เพิ่มสถานะ “จบแล้ว”: `entry_media` = pass (`โพสต์นี้เผยแพร่แล้ว (postId: …) — ไม่มีอะไรต้องส่งอีก`), `trigger` = skip (ตรวจก่อน branch เวลาอนาคต ไม่งั้นโพสต์อนาคตที่ publish แล้วยังขึ้น “กดส่งจริงได้”), `product_photo` = skip, คำเตือนแคปชันเปลี่ยนข้อความว่ามีผลกับโพสต์ครั้งถัดไป · รายงานท้ายขึ้น `✅ โพสต์นี้เผยแพร่บน LinkedIn แล้ว … ไม่มีอะไรต้องทำต่อ` · **exit 0 แม้ `--strict`** · `--json` มี `published`/`publishedPostId` · สถานะ `publishing`/inFlight เปลี่ยนจาก fail เป็น skip (“กำลังส่ง รอให้จบ”) · เทสต์: `test-verify-linkedin-post-readiness.cjs` **33 checks** (+2 เคสจริง รวม CLI `--strict`) · `test-social-agency-review-images.cjs` **16 checks** (+1: `--open` รับค่า) · เอกสาร `docs/beta7/linkedin-posting.md` เพิ่ม 5.0.2 · run-all **173 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-29 (session `arena/1f6d3d47-luke-ai-studio-enterprise` — **“กดอนุมัติแล้วก็วนอยู่ในหลุม”: คิวอนุมัติเป็นทางตัน** ผู้ใช้กดอนุมัติโพสต์ SSB-013 (LinkedIn) ซ้ำ ๆ แล้วไม่มีอะไรเกิดขึ้น — เพราะ `runWorkflow` **ตั้งใจ** ให้โพสต์ที่ภาพยังไม่ผ่านด่านหยุดรอ (`gate.decision = image-review`, เทสต์เดิมยืนยันไว้) แต่การ์ดในคิวหน้าตาเหมือนเดิมทุกอย่าง ไม่มีข้อความว่าติดอะไร และปุ่มยังกดได้ → **(1) คิวอนุมัติรู้เรื่องด่านตรวจภาพ**: `approvalBlock()` ใน `lib.js` (บริสุทธิ์, มีเทสต์) คืน `blocked/status/reason/live/overdue` · การ์ดขึ้น `⛔ ด่านตรวจภาพ … อนุมัติตอนนี้ระบบจะยังไม่ส่งจริง` + ติ๊ก **“ตรวจภาพเทียบรูปสินค้าจริงแล้ว”** (ปุ่มอนุมัติ **disabled** จนกว่าจะติ๊ก — การยืนยันภาพเป็นการตัดสินใจของคน ไม่ใช่ผลข้างเคียงของการกดอนุมัติ) + ปุ่ม **“ยืนยันภาพแล้ว + อนุมัติ”** ที่เรียก `reviewImage` **ก่อน** `approve` + ปุ่ม “ดูรูป / ตรวจภาพ” · ถ้าเวลาโพสต์ผ่านไปแล้วและ `dryRun === false` ขึ้น **⏰ “อนุมัติแล้วระบบจะส่งขึ้น LinkedIn ทันที”** (เดิมเงียบสนิท ทั้งที่ Apollo จะโพสต์จริงทันที) · `RunsTab` รับ `onReviewImage` จากหน้า `SocialAgency.jsx` · เทสต์ใหม่ `test-social-agency-approval-queue.cjs` **9 checks** (SSR การ์ดจริง + helper + wiring) **(2) `--entry` ที่เป็นข้อความตัวอย่าง**: ผู้ใช้รัน `--entry cal-…` ตามตัวอย่างแล้วได้แค่ “ไม่พบรายการ” → เพิ่ม `looksLikePlaceholder()` (รองรับ `cal-…`, `cal-...`, `cal-xxxx`, `ENTRY_ID`, `<cal-123>`) ให้บอกว่า **“ค่านี้เป็นตัวอย่างจากวิธีใช้งาน ไม่ใช่ ID จริง”** และ `fix:` พิมพ์ **คำสั่งที่รันได้จริงด้วย id ที่มีอยู่** (`→ --entry cal-xxxx --online`) · เทสต์ `test-verify-linkedin-post-readiness.cjs` **31 checks** (+2) **(3) `review-images --list`** ทำเครื่องหมาย **“เลยกำหนดแล้ว”** ต่อรายการที่เลยเวลา พร้อมบรรทัดอธิบายว่าอนุมัติช้าจะส่งทันที · เทสต์ `test-social-agency-review-images.cjs` **15 checks** (+1) · เอกสาร `docs/beta7/linkedin-posting.md` เพิ่ม 5.0.1 อธิบายวงจรนี้ตรง ๆ · run-all **173 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-29 (session `arena/caa8e3c7-luke-ai-studio-enterprise` — **หลังได้ token แล้ว ผู้ใช้เจอคอขวดใหม่ที่คิวอนุมัติ: “⛔ ด่านตรวจภาพ: ยังไม่ได้ตรวจภาพในหน้าโพสต์” และต้องกดยืนยันทีละใบ 20–30 ใบต่อเดือน** → งาน 3 ชิ้น: (1) **สคริปต์ใหม่ `scripts/social-agency-review-images.cjs`** — `--list` (ค่าเริ่มต้น) ลิสต์เฉพาะโพสต์ที่ด่านตรวจภาพยังไม่ผ่าน พร้อม path รูปและบรรทัด `→ … --confirm ENTRY_ID` ที่รันได้จริง · `--open ENTRY_ID` เปิดไฟล์รูปให้ดูก่อนตัดสินใจ · `--confirm ENTRY_ID` เดินผ่าน `reviewEntryImage` ตัวเดียวกับปุ่มในแอป (ภาพถูกปฏิเสธ/ไฟล์เปลี่ยนหลังตรวจ/กำลังเผยแพร่ → ปฏิเสธพร้อมเหตุผลเดิม) แล้วบอกคำสั่งของใบถัดไป · `--platform` / `--client` / `--json` · โพสต์ที่ยังไม่มีภาพถูกแยกเป็น “ยังไม่มีภาพ” ไม่ปนกับคิว (ยังตรวจไม่ได้) · เขียนสถานะเฉพาะตอน `--confirm` และเขียนแค่ `imageReview` — ไม่เปลี่ยนสถานะโพสต์ ไม่เริ่มเวิร์กโฟลว์ ไม่เผยแพร่ · เทสต์ใหม่ `test-social-agency-review-images.cjs` **13 checks** (2) **`--check` ของตัวช่วย token ครอบคลุมกว่าตัวอย่างเดียว** — เพิ่มภาพรวม: token เหลือกี่วัน/หมดอายุวันไหน · จำนวนรายการ LinkedIn ในปฏิทิน (ยังไม่โพสต์/โพสต์แล้ว) · กี่ใบยังไม่ยืนยันภาพ · **รายการแรกที่ยังไม่พร้อม + ด่านที่ติด + วิธีแก้** · blocker ระดับบัญชี (เช่นยังเปิด dry-run — ไม่พิมพ์ซ้ำเพราะบอกไปแล้วด้านบน) · `--json` ส่งฟิลด์ `tokenDaysLeft`/`plan` · เทสต์ `test-social-agency-linkedin-token.cjs` **32 checks** (+3) (3) **เตือนล่วงหน้าเมื่อ token ใกล้หมดใน Connectors** — `getConnectorsView().linkedin` เพิ่ม `tokenSavedAt`/`tokenExpiresAt`/`tokenDaysLeft` (คำนวณจากวันที่วาง token, 60 วัน, `Math.ceil`, **ไม่เดาเมื่อไม่มีวันที่**) · การ์ด LinkedIn ขึ้นเตือนเงียบเมื่อเหลือ 8–21 วัน, แถบ alert + คำสั่ง `--prompt --save` เมื่อเหลือ 0–7 วัน, และบอกตรง ๆ เมื่อหมดอายุแล้ว · เทสต์ใหม่ `test-social-agency-linkedin-token-health.cjs` **8 checks** (render การ์ดจริงด้วย React SSR: 45/14/3/หมดอายุ/ไม่มี token/พิมพ์ token ใหม่) · เอกสาร `docs/beta7/linkedin-posting.md` เพิ่ม 2.4 (ตารางเตือน token), 2.5 (`--check` ภาพรวม) และ 5.0 (คิวตรวจภาพ) · run-all **172 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-28 (session `arena/a51384da-luke-ai-studio-enterprise` — **ปิดงานด่านแรกของ LinkedIn ได้จริงบนเครื่องผู้ใช้** (`thai-modern-bags` ได้ token อายุถึง 2026-12-27 + `urn:li:person:q15d9LxIrG`): รอบที่สำเร็จ ผู้ใช้วาง URL ของ **หน้าเข้าสู่ระบบ LinkedIn** (`www.linkedin.com/uas/login?session_redirect=…`) มาแทนหน้า callback เพราะเบราว์เซอร์ที่สคริปต์เปิดยังไม่ได้ล็อกอิน LinkedIn — ข้อความเดิมจัดกรณีนี้รวมกับ “วางหน้าผิด” ทำให้ไม่รู้ว่าต้องล็อกอินก่อน → เพิ่มการรู้จักหน้า login ใน `extractCode()`: `linkedin.com/(uas/)?(login|checkpoint)` หรือคู่พารามิเตอร์ `session_redirect`+`trk` → บอกตรง ๆ ว่า “ยังไม่ได้ล็อกอิน ให้ล็อกอินให้เสร็จแล้วกด Allow” และ **ไม่โทษ Products** (คนละสาเหตุกับหน้า authorize) · เทสต์ `test-social-agency-linkedin-token.cjs` **30 checks** (+1: หน้า login/checkpoint) · เอกสาร `docs/beta7/linkedin-posting.md` เพิ่มบรรทัดนี้ในข้อ 2.2 · run-all **170 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-28 (session `arena/eac96f77-luke-ai-studio-enterprise` — **ขั้นวาง URL ของ LinkedIn: ผู้ใช้ติดซ้ำ 3 รอบ เพราะสคริปต์บอกแค่ “URL นี้ไม่มี ?code=” ซึ่งเอาไปทำอะไรต่อไม่ได้** (รอบจริง: วาง Client ID ลงช่อง Client Secret → 14 ตัวอักษร · 86e6…ojf1 · วาง `https://thaimodernbags.com/li-callback` ที่ไม่มี query · วางข้อความตัวอย่างในคำสั่งเพราะ doc มี placeholder อยู่ในตัว command) → แก้ที่ต้นเหตุทั้งชุดใน `scripts/social-agency-linkedin-token.cjs`: (1) **บอกว่าได้รับอะไรมา** — `describeReceived()` พิมพ์ host+path+**ชื่อ**พารามิเตอร์ (ไม่พิมพ์ค่า เพราะ code คือ credential) เช่น `ได้รับ: thaimodernbags.com/li-callback · ไม่มีพารามิเตอร์ · ยาว 38 ตัวอักษร` (2) **รู้จักหน้า authorize** (`response_type=code` + `client_id` แต่ไม่มี code) → บอกว่า “นี่คือหน้า ขออนุญาต ไม่ใช่หน้าที่ย้อนกลับ” พร้อมชี้ไปที่ Products (Share on LinkedIn / Sign In with LinkedIn using OpenID Connect) และ Redirect URL (3) **`salvageCode()`** — หา `code=` ในข้อความดิบ/หลังถอด encode รองรับ `#?code=…`, query ที่มาแบบ `%3Fcode%3D…`, และค่าที่วางมาเดี่ยว ๆ (เดิมค่าที่ encode มาทั้งเส้นถูกเข้าใจผิดว่าเป็น code) (4) **วางผิดไม่ตัดจบ** — `readCallback()` ถามซ้ำได้ 3 ครั้ง (เดิม throw ทิ้งทันที) (5) **ดักช่องสลับกัน** — Client Secret ที่เท่ากับ Client ID → หยุดก่อนยิงเน็ต พร้อมบอกว่าคือ Client ID · help เขียนใหม่: แนะนำ redirect URL ที่ **ไม่เด้ง** (ไฟล์นิ่งบนเว็บจริง) เพราะ 404→หน้าแรก จะทำให้ query หายก่อนก๊อป และบอกว่ารับเฉพาะค่าหลัง `code=` ได้ · เทสต์ `test-social-agency-linkedin-token.cjs` **29 checks** (+8: code หลัง `#`/แบบ encode, ข้อความกรณีวางหน้า authorize, ข้อความกรณีไม่มี query, `describeReceived` ต้องไม่พิมพ์ค่า, retry สำเร็จครั้งที่ 2, retry ครบ 3 ครั้งแล้วหยุด, สลับ secret/client id) · เอกสาร `docs/beta7/linkedin-posting.md` เพิ่มคำเตือน redirect ที่เด้ง + พฤติกรรมถามซ้ำ + `--code` · run-all **170 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-28 (session `arena/23727cd7-luke-ai-studio-enterprise` — **LinkedIn ติดที่ด่านแรกสุด: ไม่มี token/URN และ LinkedIn ไม่มีปุ่ม “สร้าง token” ให้กด** ผู้ใช้รัน `--list` แล้วเห็นว่า LinkedIn ของทั้งสองลูกค้ายังไม่ได้ตั้งค่า token/URN และไม่มีรายการ LinkedIn ในปฏิทินเลย คำแนะนำเดิม (“ไปที่ Connectors → ใส่ Member Access Token”) ใช้ไม่ได้จริงเพราะยังไม่มี token ให้ใส่ → เพิ่มตัวช่วยทำ OAuth ครบวงจร `scripts/social-agency-linkedin-token.cjs`: (1) **`--prompt`** ถาม Client ID / Client Secret / Redirect URL แบบไม่แสดงบนจอและไม่ลง shell history (ยืม `promptHidden`/`ask` จากตัวช่วย Facebook — export เพิ่มใน `social-agency-fb-token.cjs`), (2) สร้าง authorize URL พร้อม `state` สุ่มต่อการรัน, เปิดเบราว์เซอร์ให้, (3) ผู้ใช้วาง **URL ที่เบราว์เซอร์เด้งไป** (ไม่ต้องมีเซิร์ฟเวอร์รับ callback และไม่ต้องมี `--listen` — LinkedIn ไม่รับ redirect แบบ localhost), (4) แลก code ที่ `/oauth/v2/accessToken` → เรียก `/v2/userinfo` → `urn:li:person:SUB`, (5) **`--save` เขียน `accessToken` + `authorUrn` + `tokenSavedAt` ลง `connectors.json` ให้เลย** (dry-run ยังเปิดอยู่ ไม่แอบเปลี่ยน) · `--check` ตรวจ token ที่บันทึกไว้ (401/URN ไม่ตรง → exit 1 พร้อมวิธีแก้) · `--curl` พิมพ์คำสั่งเทียบเท่าแบบไม่ต่อเน็ต · `--json`/`--reveal` · `--state` สำหรับรอบที่สั่งทำ authorize ที่อื่น · ความปลอดภัย: secret ไม่ถูกพิมพ์กลับ, token ในผลลัพธ์ปกติถูกปิดบัง, ข้อความ error ผ่าน `redact()`, `state` ไม่ตรง → หยุดก่อนแลก code, ใส่ `--code` ตรง ๆ จะเตือนว่าไม่ได้ตรวจ state · ตัวตรวจ `--list` และบรรทัด `fix:` ของด่าน connector เปลี่ยนจาก “ไปที่ Connectors” เป็นคำสั่งที่รันได้จริง `node scripts/social-agency-linkedin-token.cjs --prompt --save` · เทสต์ใหม่ `scripts/validation/test-social-agency-linkedin-token.cjs` **22 checks** (mock OAuth/API ในเครื่อง ผ่าน `LUKE_LI_OAUTH_HOST`/`LUKE_LI_HOST`/`LUKE_LI_PORT`/`LUKE_LI_TLS=0` — ไม่มีเน็ต ไม่มี token จริง) และ `test-verify-linkedin-post-readiness.cjs` **29 checks** (+1: คำสั่งขอ token ต้องอยู่ใน fix/`--list` และห้ามมี `<>` ที่ทำให้ zsh พัง) · เอกสาร `docs/beta7/linkedin-posting.md` เขียนหัวข้อ 2 ใหม่เป็น 2.1 เตรียมแอป (Share on LinkedIn + Sign In with LinkedIn using OpenID Connect + Authorized redirect URL) / 2.2 คำสั่งเดียวจบ / 2.3 หลังได้ token และย้ำว่า **member token อายุ 60 วัน ไม่มี refresh token** · `node --check` ผ่าน · run-all **170 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-28 (session `arena/94558b55-luke-ai-studio-enterprise` — **ตัวตรวจ LinkedIn: ข้อความที่ให้คัดลอกต้องรันได้จริงใน zsh** — ผู้ใช้พิมพ์ `node scripts/verify-linkedin-post-readiness.cjs --entry <id จาก --list> --online` ตามตัวอย่างแล้ว zsh ขึ้น `no such file or directory: id` เพราะ `<` คือ redirect · แก้ทั้งชุด: (1) help + ข้อความวิธีแก้ในตัวสคริปต์ เปลี่ยน `<SKU>`/`<entryId>`/`<clientId>`/`<id>` เป็นคำพิมพ์ใหญ่ล้วน `SKU` / `ENTRY_ID` / `CLIENT_ID` พร้อมบรรทัดอธิบายว่าไม่ต้องใส่วงเล็บมุม (2) `--list` พิมพ์บรรทัด `→ node … --entry cal-xxxxxxxx` **ด้วย id จริง** ต่อรายการ พร้อมใส่ `--client` ให้เองถ้าลูกค้ารายนั้นไม่ใช่รายที่เปิดอยู่ (3) `--list` สรุปจำนวนสินค้าที่มีรูป/ทั้งหมด และตอนยังไม่มีรายการ บอกขั้นตอนสร้าง 4 ข้อ (อธิบายครั้งเดียว ไม่ซ้ำทุกลูกค้า) · เทสต์ `test-verify-linkedin-post-readiness.cjs` **28 checks** (+3: help/fix ต้องไม่มี `<>`, `--list` ต้องมี id จริง + `--client` เมื่อจำเป็น, คำอธิบายขั้นตอนสร้างครั้งเดียว) · เอกสาร `docs/beta7/linkedin-posting.md` เตือนเรื่อง `<id>` · run-all **169 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-28 (session `arena/aef832cc-luke-ai-studio-enterprise` — **ตัวตรวจ LinkedIn: แก้ 4 จุดที่เจอจากการรันจริงบน Mac** (`node scripts/verify-linkedin-post-readiness.cjs`): (1) `--online` ตอนยังไม่มี token **เคยเงียบหายไปเลย** → ตอนนี้ขึ้นแถว `– … ข้ามการตรวจออนไลน์` ตรง ๆ (สถานะ `skip` ไม่นับเป็นตัวบล็อก/คำเตือน และไม่ทำให้ `--strict` ตก) (2) `--sku` ที่ไม่มีจริง บอกแค่ “ไม่พบสินค้า” → ตอนนี้ **ลิสต์ SKU ที่มี** และชี้ให้รัน `--list` (3) ไม่พบรายการ/ไม่มีรายการ LinkedIn เลย → บอก **รายการ LinkedIn ที่มีในปฏิทิน** (id · วันเวลา · sku · สถานะ) และถ้าพิมพ์ `cal-xxxx` ตามตัวอย่างจะบอกว่าเป็นชื่อสมมติ ต้องใช้ ID จริง (4) เพิ่ม `--list` (และ `buildInventory`/`formatInventory` ที่ export ไว้เทสต์) — แสดงต่อลูกค้า: สถานะ connector/token/URN/dry-run · สินค้าพร้อมส่วนที่ยังไม่มีรูป · รายการ LinkedIn พร้อม `--entry <id>` ที่คัดลอกได้ · และแก้บรรทัด “รูปแบบที่จะส่ง” ไม่ให้ขึ้น “ข้อความเท่านั้น” ตอนที่ยังไม่มีรายการ (`mediaKind: null`) · เทสต์ `test-verify-linkedin-post-readiness.cjs` **25 checks** (+5 เคสใหม่ที่จำลองสิ่งที่ผู้ใช้เจอจริง) · เอกสาร `docs/beta7/linkedin-posting.md` อัปเดตคำสั่ง/สัญลักษณ์ · run-all **169 passed · 1 failed** (เฉพาะ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg`))

> **อัปเดตล่าสุด:** 2026-10-27 (session `arena/a584fdcc-luke-ai-studio-enterprise` — **(1) เลิกพึ่ง imgbb: ที่พักรูปสาธารณะเลือกได้หลายเจ้า** — Instagram/LINE ไม่รับไฟล์รูป (ดึงจาก URL เท่านั้น) จึงเปลี่ยนจาก “ต้องมี imgbb key” เป็นเชน `own → imgbb → catbox.moe → litterbox` (`settings.imageHost.provider`, `auto` = ไล่ตามลำดับ, token ของเว็บตัวเองเก็บใน `connectors.json` ช่อง `imagehost`, view ปิดบังไว้) · รูปที่มี `publicUrl` อยู่แล้วไม่ถูกอัปโหลดซ้ำ · ทุกเจ้าล้ม → ไม่ส่งและบอกทุกเจ้าที่ลอง (ไม่ลดรูปคู่เหลือรูปเดียว) · `POST /api/social-agency/connectors/imagehost/test` + ปุ่ม “ทดสอบอัปโหลด” ใน Connectors (ลองกับรูปสินค้าจริง) · ผลการรันบันทึก `imageHost: ["publicUrl","catbox"]` · เอกสารใหม่ `docs/beta7/image-hosting.md` (ตารางว่าใครรับไฟล์/ใครต้องใช้ URL + สัญญาอัปโหลด + ตัวอย่าง PHP + คำเตือนความเป็นส่วนตัว) · เทสต์ใหม่ `test-social-agency-image-host.cjs` **17 checks** · อัปเดต `test-social-agency-line-ref-pair.cjs` (5) และ `test-social-agency-brand-footer.cjs` (12) ให้ยืนยันว่า “ไม่มี key ก็ยังส่ง 2 รูป” **(2) ตัวตรวจความพร้อม LinkedIn** `scripts/verify-linkedin-post-readiness.cjs` (คู่กับตัวของ Facebook) — 11 ด่าน offline: state · token+dry-run · Linkedin-Version ไม่หมดอายุ · `authorUrn` ต้องเป็น `urn:li:person:` · อายุ token 60 วัน (บันทึก `connectors.linkedin.tokenSavedAt` ตอนวาง token) · รูปสินค้าจริงสำหรับรูปที่ 2 · รายการ/ภาพ AI (ไม่ใช่วิดีโอ/โพสต์แล้ว) · ด่านตรวจภาพ · แคปชัน little text ≤3,000 + ตัวอย่างข้อความจริง · จังหวะกดส่ง (`manual` บนโพสต์อนาคต = dry-run) · `--online` ยิง `/v2/userinfo` (จับ token ผิดบัญชี) + `initializeUpload` (จองสิทธิ์เท่านั้น ไม่ส่งไบต์/ไม่โพสต์) · token ปิดบัง/redact เสมอ · `--json` / `--strict` / exit code · เทสต์ `test-verify-linkedin-post-readiness.cjs` **20 checks** (mock server ในเครื่อง) · เอกสาร `docs/beta7/linkedin-posting.md` เพิ่มหัวข้อ 5)

> **อัปเดตล่าสุด:** 2026-10-27 (session `arena/741bf589-luke-ai-studio-enterprise` — **วางแผนอัตโนมัติรวม LinkedIn เป็นค่าเริ่มต้น**: `AUTO_PLAN_PLATFORMS` = Facebook · Instagram · LINE · LinkedIn · เว็บ → 1 วันมี 5 ช่อง (LinkedIn ได้เวลา 08:00 วันธรรมดา / 09:30 วันหยุด ไม่ชนช่องอื่น) · ปฏิทินมีชิป LinkedIn ในตัวเลือก “แพลตฟอร์ม/วัน” และ **ติ๊กไว้ให้ตั้งแต่แรก** (เดิมลิสต์ชิปฮาร์ดโค้ด 4 ช่อง → LinkedIn ไม่โผล่เลย ปุ่มวางแผนจึงไม่มีทางเลือกได้) · ส่ง `platforms` จาก `PLAN_PLATFORMS` ตัวเดียว ไม่มีลิสต์ซ้ำ · ไม่มี token ก็ยังวางแผน/เขียน/คัดลอกไปโพสต์เองได้ (รันจริงจะเป็น dry-run) · TikTok ยังไม่เข้า auto-plan เหมือนเดิม · เทสต์: `test-social-agency-auto-plan.cjs` **14 checks** (เพิ่มยืนยัน 5 ช่อง/วัน, เวลา LinkedIn, รอบวางซ้ำเติมเฉพาะช่อง LinkedIn, 1 สินค้า = 1 วัน × 5) · `test-social-agency-linkedin.cjs` 13 · `test-social-agency-calendar-workflow-ui.cjs` 16 · เอกสาร `docs/beta7/linkedin-posting.md` อัปเดตแล้ว)

> **อัปเดตล่าสุด:** 2026-10-27 (session `arena/0a45a7a5-luke-ai-studio-enterprise` — **LinkedIn โพสต์รูปคู่เหมือน Facebook/Instagram**: `_publishLinkedIn()` อัปโหลด **2 รูป** (ภาพ AI ก่อน · รูปสินค้าจริง ≤500px ตาม) ผ่าน `initializeUpload` → PUT แยกทีละรูป แล้วส่ง `content.multiImage.images` (1 รูป → `content.media` เหมือนเดิม · ไม่มีรูป → ไม่มี `content`) · เปิด `productRefInPost` แต่ไม่พบรูปสินค้าในเครื่อง → **ไม่โพสต์** และบอกเหตุผล (ไม่ลดเหลือรูปเดียวเงียบ ๆ) · `mediaKind` เป็น `carousel`/`image`/`post` · **พรีวิว** ใน `PostPreview.jsx` ใช้ carousel รูปคู่ + แถบ `Like · Comment · Repost · Send` ของ LinkedIn (เดิมพรีวิวสัญญาแค่รูปเดียว) · **Connectors** รวมตัวเลือกเวอร์ชันเป็น `versionField()` ตัวเดียวกับ Facebook/Instagram → LinkedIn-Version ได้คำเตือน “หมดอายุใน N วัน” ด้วย และแก้คำอธิบายว่าแนบรูปคู่ได้ · เทสต์ `test-social-agency-linkedin.cjs` **13 checks** (เพิ่มเคสคู่: ลำดับ 5 คำขอ + `multiImage` + ไม่มีรูปสินค้า → ปฏิเสธก่อนอัปโหลด + ปิดสวิตช์ → รูปเดียว) · `test-social-agency-post-preview.cjs` **8 checks** · run-all **167 passed · 1 failed (validate-release.sh ต้องมี `imageio_ffmpeg` ในเครื่อง — ไม่เกี่ยวกับงานนี้)** · Vite build ผ่าน · เอกสาร `docs/beta7/linkedin-posting.md` อัปเดตแล้ว)

> **อัปเดตล่าสุด:** 2026-10-26 (session `arena/2f6de605-luke-ai-studio-enterprise` — **ปรับหน้าปฏิทิน + หน้า Workflow ของ Social Agency ให้ใช้ง่ายขึ้น โดยไม่เปลี่ยนข้อมูลหรือพฤติกรรมการทำงาน**: (1) **ปฏิทิน** — แถบเครื่องมือเดิมรวมทุกอย่างไว้แถวเดียว (legend + 5 กลุ่มเช็กบ็อกซ์ + 2 สวิตช์ + โซนเวลา + ปุ่มหลัก) จนตารางเดือนเริ่มครึ่งจอ · ตอนนี้เหลือ **หัวเดือน + สรุปสถานะ + ปุ่มหลัก** แถวเดียว, **สรุปสถานะเป็นทั้ง legend และตัวกรอง** (กด “รออนุมัติ 3” เพื่อกรองได้ กดซ้ำเพื่อดูทั้งหมด), **ตัวเลือกการวางแผน** กับ **ตัวกรอง** พับเก็บและบอกค่าที่ใช้อยู่บนบรรทัดเดียว (ปุ่มวางแผนบอกสาเหตุเมื่อกดไม่ได้), เพิ่มปุ่ม **เพิ่มโพสต์** และปุ่ม **วันนี้** ที่เลื่อนไปช่องวันนี้จริง, การ์ดโพสต์มีแถบสีสถานะด้านซ้าย + บรรทัดมุม/เสา และปุ่มลบย้ายไปมุมขวาบน (โผล่ตอน hover/focus ไม่ทับเวลา/แพลตฟอร์ม) · (2) **Workflow** — ผังโหนดเดิมเป็นแถวแนวนอน 10 การ์ด (208px) ต้องเลื่อนไกล · ตอนนี้เป็น **กริดที่ห่อบรรทัด** เห็นครบ 10 ขั้นพร้อมเลขลำดับ + **แถบขั้นตอน (stepper)** ด้านบนที่กดดูรายละเอียดได้ + แถบความคืบหน้า/เวลาที่ใช้, หัวหน้าเป็น **การ์ดสรุปโพสต์** (วันเวลา · แพลตฟอร์ม · สถานะ · ชื่อสินค้า · คะแนน) พร้อมปุ่ม รัน/อนุมัติ/เปิดโพสต์/รายงาน, ปุ่ม “แสดงบนผัง/เปิดโพสต์” ของแต่ละรันแยกเป็นปุ่มจริง (เดิมเป็น span role=button ซ้อนในปุ่มแถว), ดูรันเก่าแล้วกด **ดูรันล่าสุด** กลับได้, สถานะว่างชี้ทางต่อ (ไปวางแผนที่ปฏิทิน / รันเลยตอนนี้) · เทสต์ใหม่ `test-social-agency-calendar-workflow-ui.cjs` **16 checks** · `test-social-agency-calendar-layout.cjs` 10 checks เดิมยังผ่านทั้งหมด · run-all **164 passed · 1 failed** (เหลือ `validate-release.sh` ที่ต้องมี `imageio_ffmpeg` ในเครื่อง — รันซ้ำด้วย venv ที่มีโมดูลนี้แล้วผ่าน) · PR #51)

> **อัปเดตล่าสุด:** 2026-10-26 (session `arena/a1506d49-luke-ai-studio-enterprise` — **พรีวิว LINE แสดงภาพคู่เหมือนการส่ง**: ภาพ AI + รูปสินค้าจริง · ถ้ารูปสินค้ายังเป็นลิงก์ภายนอก พรีวิวจะบอกว่าไม่แนบรูปที่ 2 · เทสต์ `test-social-agency-line-preview-pair.cjs` 5 checks (SSR ผ่าน Vite build เพราะ `post-copy.cjs` เป็น CommonJS))

> **อัปเดตล่าสุด:** 2026-10-26 (session `arena/54396cd3-luke-ai-studio-enterprise` — **LINE ส่งภาพเป็นคู่เหมือน Facebook/Instagram**: ภาพ AI + รูปสินค้าจริง (≤500px, อัปโหลด imgbb) + ข้อความ · ไม่มีรูปสินค้า/ไม่มี imgbb key → ไม่ส่งเลย · ปิด `productRefInPost` → ภาพเดียวเหมือนเดิม · เทสต์ `test-social-agency-line-ref-pair.cjs` 4 checks)

> **อัปเดตล่าสุด:** 2026-10-20 (session `arena/f4609d2f-luke-ai-studio-enterprise` — **รันเลยตอนนี้ (Workflow, manual run) สร้างภาพขนานกับการเขียนข้อความ**: ภาพสร้างจาก prompt ที่ AI เพิ่งเขียน (ถ้า LLM ไม่พร้อมใช้ template เดิม) · ไม่สร้างทับภาพเดิม · รอภาพก่อนด่านภาพ · ภาพต้องถูกตรวจในหน้าโพสต์ก่อนส่งจริงเสมอ · รันตามเวลา (schedule) ไม่เปลี่ยน · เทสต์ `test-social-agency-run-now-image.cjs` 6 checks · **แก้ race:** `_generateEntryImage` เขียน state ทับจาก snapshot เก่า ตอนนี้เขียนจากการอ่านใหม่)

> **อัปเดตล่าสุด:** 2026-10-20 (session `arena/9617eae1-luke-ai-studio-enterprise` — **Facebook ใช้ `thaimodernbags.com` (ไม่มี https://www.) เพราะ Facebook ไม่ให้ลิงก์เว็บในโพสต์** · Instagram ยังเป็น `https://www.thaimodernbags.com` · ค่าที่บันทึกไว้เดิมของ Facebook ถูกเปลี่ยนให้ครั้งเดียวตอนอ่านสถานะ ถ้าแก้เองแล้วจะไม่ถูกทับ · เทสต์ `test-social-agency-brand-footer.cjs` 11 checks)

> **อัปเดตล่าสุด:** 2026-10-20 (session `arena/5ccb5e26-luke-ai-studio-enterprise` — **ข้อความแนะนำบริษัท/ติดต่อท้ายโพสต์ของ Thai Modern Bags + โพสต์ภาพต้องมีรูปสินค้าคู่ (AI + Reference)**: (1) ข้อความ "กว่า 40 ปี … OEM / ODM" พร้อมโทร/มือถือ/LINE/อีเมล/เว็บ แนบท้าย **Facebook และ Instagram ของ Thai Modern Bags เท่านั้น** เป็นข้อความธรรมดา (ไม่มี backticks/Markdown) จัดการผ่าน `captionFooters` รายลูกค้า ที่หน้า สไตล์ & ฉบับ · ลูกค้ารายอื่นและ LINE/TikTok/เว็บ เริ่มต้นว่าง · ข้อความปิดท้ายถูกนับรวมในความยาว ไม่แนบซ้ำ และประกอบตอนแสดงผล/คัดลอก/เผยแพร่ · (2) Facebook และ Instagram ที่เป็นโพสต์ภาพ **ต้องมี 2 รูป**: ภาพ AI + รูปสินค้าจริง (500px) — Instagram ส่งเป็น carousel (ต้องมี imgbb key) · หาเส้นทางรูปคู่ไม่ได้ระบบจะ**ไม่เผยแพร่**และบอกสาเหตุ ไม่ลดเหลือรูปเดียว · ตั้ง `แนบรูปสินค้าจริง` เป็นปิดจึงโพสต์ภาพเดียวได้ · เทสต์ใหม่ `test-social-agency-brand-footer.cjs` 10 checks · run-all ดู `validation-reports/` ล่าสุด)

> **อัปเดตล่าสุด:** 2026-10-20 (session `arena/4552ca9e-luke-ai-studio-enterprise` — **ปฏิทิน: โพสต์อยู่ในช่องของแต่ละวัน ไม่ล้นทับสัปดาห์ถัดไป** · รองรับ 4 cross-posts/วัน พร้อมชื่อสินค้า; วันงานแน่นเลื่อนดูภายในช่อง · หัววันติดด้านบนและคอลัมน์ตรงกันเมื่อเลื่อนหน้าจอแคบ · ข้อมูล/เวลาโพสต์/ตัววางแผนไม่เปลี่ยน · รายละเอียดและเช็กลิสต์อยู่ข้อ 2 และ 6)

> **อัปเดตล่าสุด:** 2026-10-16 (session `arena/969a8048-luke-ai-studio-enterprise` — **คอนเทนต์อิงลูกค้า (client-driven content): เลิกใช้ชุดของ "โรงงานกระเป๋า" กับทุกธุรกิจ + `validate.sh`/`start.sh` ที่ root**: เพิ่มโมดูลบริสุทธิ์ `scripts/server/social-agency-content-kinds.cjs` — `detectContentKind()` อ่าน `industry` + สินค้าของลูกค้า แล้วตอบ **goods / food / service / shop / generic** (เลือกเองได้ด้วย `client.contentKind`) · แต่ละชนิดมี **5 มุมคอนเทนต์ตามบทบาท** (launch/behind/knowhow/customer/promo) โดย **5 มุมเดิมเป็นของ kind `goods`** จึงไม่มีการเปลี่ยนชื่อและข้อมูลเดิมไม่พัง · มุม/แคปชัน/ตัวอย่างสำเร็จรูป/แฮชแท็ก/บรรทัดโทนเสียง/วลี image prompt อังกฤษ เปลี่ยนตามธุรกิจของลูกค้ารายนั้น (เบเกอรี่ได้ "เมนูใหม่/เบื้องหลังครัว", สตูดิโอโยคะได้ "คลาส/บริการใหม่/เบื้องหลังทีมงาน" ไม่มี "โรงงานเราวันนี้คึกคักมาก" หรือ "โปรโมชัน/ข้อเสนอ OEM" อีก) · **ปฏิทินมีตัวเลือก "มุมคอนเทนต์" ของเดือนนี้** (ตั้งต้นจากเสาหลักของลูกค้า ถ่วงตามน้ำหนัก, ส่ง `angles:[…]` ไปกับ auto-plan) + สรุป "มุมคอนเทนต์เดือนนี้ ×จำนวน" ในหน้าต่างวางแผน · เสาหลักเริ่มต้นตามประเภทธุรกิจ + ย้ายเสาชุดโรงงานเดิมให้ลูกค้าเก่า **ครั้งเดียว** (เสาที่แก้เองแล้วไม่ถูกทับ) · เทสต์ใหม่ `test-social-agency-client-content.cjs` **17 checks** · `validate.sh` (ติดตั้ง dependency → build → รันชุดทดสอบทั้งหมด) และ `start.sh` (macOS/Linux) อยู่ที่ root แล้ว) · PR #44

> **อัปเดตล่าสุด:** 2026-10-16 (session `arena/0b8f90ba-luke-ai-studio-enterprise` — **ปฏิทิน: "วางแผนอัตโนมัติทั้งเดือน" กดซ้ำได้มากกว่าหนึ่งครั้ง + หลายงานต่อวัน (Facebook/IG/LINE/เว็บ ในวันเดียว)**: หน่วยของแผนเปลี่ยนจาก *วัน* เป็น **(วัน, แพลตฟอร์ม)** — หนึ่งวันวางโพสต์ทุกแพลตฟอร์มที่เลือก (ค่าเริ่มต้น 4: FB/IG/LINE/เว็บ(demo)) เวลากระจายกันไม่ชน · หนึ่งวันหนึ่งสินค้า cross-post ทุกช่อง วันละสินค้าไม่ซ้ำเท่าที่คลังพอ (P5w เดิม) · รอบสองขึ้นไปเติมเฉพาะ (วัน, แพลตฟอร์ม) ที่ยังว่างและใช้สินค้าของวันเดิม (ไม่ติดกำแพง used-SKU อีก) · เพิ่มตัวเลือก **แทนที่แผนเดิม** (`replacePlanned`) ทับเฉพาะรายการ `planned` ที่ยังไม่เริ่มรัน (published/in_flight/A-B ไม่ถูกแตะ) · `apply` รับ 200 ช่อง/ครั้ง (เดิมตัด 31) กันซ้ำ (วัน, แพลตฟอร์ม) · UI เลือกแพลตฟอร์ม/วัน + ป้าย demo เป็น "เว็บ (Demo)"/WEB · เทสต์ใหม่ `test-social-agency-auto-plan.cjs` 14 checks + อัปเดต P5w smoke · run-all **158 passed · 0 failed · 1 skipped**) · PR #43

> **อัปเดตล่าสุด:** 2026-10-16 (session `arena/f227ce5d-luke-ai-studio-enterprise` — **เพิ่มตัวตรวจความพร้อม `scripts/verify-fb-post-readiness.cjs` สำหรับ handoff item D (โพสต์ FB จริง 2 รูป) + แก้บั๊ก 5 จุด + เทสต์ใหม่**: (1) `scripts/verify-fb-post-readiness.cjs` ตรวจครบ 7 ด่านแบบไม่ออนไลน์ + ด่านที่ 8 `--online` ยิง `/<pageId>`, `/me` (จับ User token ที่วางผิดช่องแม้ไม่ใส่ App Secret) และ `/debug_token` · อ่านอย่างเดียว 100% ไม่สร้าง/เขียนไฟล์สถานะ และไม่แสดง token เต็ม · (2) แก้บั๊ก `<sku>.ref500.jpg` ค้างจากรูปเก่าเมื่ออัปโหลดรูปสินค้าใหม่/เปลี่ยนเป็น URL/ลบรูป (`_unlinkProductImages` + เช็ก `mtimeMs` ใน `_resolveProductRefPostFile`) · (3) แก้ `ensureProductRef500` ที่เคยข้ามการสร้าง `<sku>.ref500.jpg` เมื่อรูปต้นฉบับ ≤500px และสั่งสร้าง `<sku>.ref500.jpg` ทันทีตั้งแต่อัปโหลด/ดึงรูปในแท็บ สินค้า (`ProductsTab.jsx`) · (4) แก้ `_dryPublish` ตอนติด `manualEarly` ให้บอกชัดว่าเวลานัดโพสต์ยังมาไม่ถึง ไม่ใช่โทษว่ายังไม่ปิด dry-run ใน Connectors · (5) แก้ `PostPreview.jsx` ไม่แสดง carousel 2 รูปเมื่อโพสต์เป็นวิดีโอ + แก้ชนเวลาปฏิทินใน `social-agency-groups-smoke.cjs` และ `social-agency-tracking-ab-smoke.cjs` · run-all **157 passed · 0 failed · 1 skipped**)

> **อัปเดตล่าสุด:** 2026-10-07 (session `arena/c363a091-luke-ai-studio-enterprise` — **สร้างใหม่ทั้งชุดจากข้อความส่งต่อ (เคสที่ 5 ของงานหาย)**: งาน "พรีวิวโพสต์จริงบนสุดของรายละเอียด + สัญลักษณ์รูปตาในรายการปฏิทิน + ตัวอย่างแคปชันสำเร็จรูป 3 แบบ" ที่ session ก่อนบันทึกว่าเสร็จใน local commit `86f6cf2` **ไม่เคยถูก push** จึงไม่มีอยู่จริงใน `main`/origin (ตรวจด้วย `git fsck`, `git ls-remote`, `gh pr list` แล้ว — ดูหัวข้อ 7.7) · สร้างใหม่จาก `main` ณ `494c158` · เพิ่มไฟล์ใหม่ `app/frontend/src/social-agency/CaptionPresets.jsx` + เมธอด `listCaptionPresets`/`applyCaptionPreset` ใน runtime พร้อมเส้นทาง `GET /api/social-agency/caption-presets` และ `POST /api/social-agency/entry-caption/preset` (เขียนเฉพาะ `caption` + `captionManual` + `captionSource` เท่านั้น) · เทสต์ใหม่ `test-social-agency-caption-presets.cjs` 14 checks (Social Agency ครบ 9 ชุด) · แก้บั๊กจริงที่เจอระหว่างทาง: ด่านหลักฐานราคาตี "ราคา 199" ว่าไม่มีหลักฐานทั้งที่ `product.price` มีค่านั้น (ดูหัวข้อ 2) · eslint 292 ไฟล์ 0 problems · Vite build ผ่าน · run-all **155 passed · 0 failed · 1 skipped** (ติดตั้ง `imageio_ffmpeg` แล้ว `validate-release.sh` ผ่านด้วย) · PR #38)

> **อัปเดตล่าสุด:** 2026-10-07 (session `arena/bd08f753-luke-ai-studio-enterprise` — รับช่วงงาน GPU/VRAM telemetry + resource governor จาก remote branch `arena/01a10a92…` (7 commits, tip `a65ccfa`) แล้วรวมลงใน session branch ที่ตั้งต้นจาก `main` ณ `bab9e33` โดยเก็บการเปลี่ยน model-cache ของ PR #34 และ post preview ของ PR #36 ไว้ครบ · frontend build ผ่าน · `run-all` 154 passed / 0 failed / 1 skipped (Python suite เป็น opt-in; รันแยกแล้วผ่าน) · ยังต้องยืนยันบน Mac จริง: Metal telemetry, governor unload/restore, sampling pause/resume และ cloud storage lazy-load · รายละเอียดงานและเช็กลิสต์อยู่หัวข้อ 2 และ 6)

> **อัปเดตล่าสุด:** 2026-10-06 (session `arena/ccbe7be3…` — **โมเดลภาพเข้า model cache + โหลดจากสำเนาบนดิสก์ภายในเมื่อมีสำเนาอยู่จริง** — งานชุดนี้ session ก่อนทำไว้แต่ **ไม่เคยถูก push → หายไปกับ sandbox อีกครั้ง (เคสที่ 4)** จึงถูก**เขียนใหม่ทั้งชุดจากโค้ดจริงใน `main`** ไม่ใช่จากข้อความส่งต่อ · cache รองรับ **โฟลเดอร์** (Core ML bundle หลายหมื่นไฟล์) · แก้ **บั๊กที่ทำให้ cache ไม่เคยถูกใช้เลย**: loader มองหาในโฟลเดอร์คนละที่กับที่ปุ่ม "Copy" เขียนไว้ ทั้งโมเดลภาพและโมเดลข้อความ · `/api/model-cache/status` ตอบ `POST` ตามที่ panel เรียกจริง (เดิม GET อย่างเดียว → panel อ่าน 404 แล้วไม่แสดงอะไรเลย) และลิสต์โมเดลภาพด้วย · `coreml_server.py` อ่าน reference config จากสำเนาในเครื่องก่อนเน็ต (`app/runtime-state/huggingface-cache`, ตั้งค่าใหม่ด้วย `LUKE_IMAGE_MODEL_CACHE`) · เทสต์ใหม่ `test-image-model-cache.cjs` 72 checks + probe Python · **วิธีนำขึ้น Mac ดูหัวข้อ 7.6** · **merge เข้า `main` แล้วเป็น `58c8b9d` (PR #34) CI `validation suites` เขียว** — งานจึงไปอยู่บน GitHub แล้ว เหลือแค่ pull+build บน Mac)
> **อัปเดตล่าสุด:** 2026-10-02 (session `arena/01a0fb7f…` — **แก้ image prompt ไม่ตรงสินค้า**: `buildTemplateImagePrompt`/`buildTemplateAnimatePrompt` ดึงคำอังกฤษจาก `product.name` และ `product.detail` เพิ่มเติมจาก `product.category` เมื่อ category เป็นภาษาไทย ไม่ต้อง fallback เป็น "product" อีก · smoke 104 + ชุด Social Agency 70 = 174 passed · PR #32)
> **อัปเดตล่าสุด:** 2026-10-01 (session `arena/01a0f582…` — **งานชุด "ป้าย + ปุ่มปฏิเสธรูป + รูปสินค้าจริงแนบโพสต์ Facebook" สร้างใหม่ทั้งชุด** เพราะงานชุดเดียวกันจาก session ก่อนหน้า**ไม่เคยถูก push ขึ้น GitHub และหายไปกับ sandbox** (ซ้ำรูปแบบเคส `5be0bd0`/`1d7d26c` — รายละเอียดการตรวจอยู่ท้ายหัวข้อ 7) · **ป้ายรายการ** (`entry.tags` ≤8 ป้าย × ≤24 ตัวอักษร ผ่าน PATCH calendar + ชิปบนการ์ดปฏิทิน + กรอง/ค้นหาตามป้าย) · **ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้"** ในด่านตรวจภาพ: ล็อก fingerprint รูปที่ปฏิเสธ + ล้างผลตรวจ + สร้างภาพใหม่อัตโนมัติ · ภาพใหม่ที่ไบต์เดิมถูกบล็อกซ้ำเอง · **โพสต์ Facebook 2 รูป**: ภาพ AI รูปแรก + รูปสินค้าจริงรูปที่สองแบบไม่แก้ไขอะไรนอกจากย่อด้านยาว 500px (canvas ในเบราว์เซอร์ แคช `<sku>.ref500.jpg` เซิร์ฟเวอร์ไม่เพิ่ม dependency) ส่งแบบ unpublished photos + `feed`+`attached_media` · **ขนาดภาพปฏิทินตั้งได้รายลูกค้า** (default 1024×600 แบนเนอร์) · เทสต์ใหม่ 3 ชุด 30 checks · run-all **147 passed · 0 failed · 0 known-failing · 1 skipped**) 
> **อัปเดตล่าสุด:** 2026-09-30 (session `arena/01a0f037…` — **สืบหา commit `5be0bd0` / `1d7d26c` ตามคำขอ: ไม่มีอยู่จริงทั้งใน sandbox, บน GitHub และบนเครื่อง Mac** → push ไม่ได้ (ไม่มี object ให้ push) · งานเนื้อหาชุด img2img อยู่ใน `main` แล้วเป็น `5d64236` + `f83ee8d` → merge `24c2a64` · แก้ข้อมูล branch บน GitHub ในข้อ 1 ให้ตรงกับที่ `ls-remote` เห็นจริง · รายละเอียดที่มา/ที่ตรวจแล้วอยู่ท้ายข้อ 6)
> **อัปเดตล่าสุด:** 2026-09-29 (session `arena/01a0eb60…` — รูปสินค้าอ้างอิงเปลี่ยนไปใช้ img2img จากรูปสินค้าจริง · เตือนใน UI เมื่อ backend ไม่ได้ใช้รูปอ้างอิง · แก้สไตล์เช็กบ็อกซ์ในด่านตรวจภาพ · 143 passed / 0 failed)
> **อัปเดตล่าสุด:** 2026-09-27 (session `arena/01a0e089…` — ปิดงานค้างหัวข้อ 6 ครบทุกข้อและ merge เข้า `main` แล้วเป็น `6397105` · `ci-baseline.json` ว่าง · 140 passed / 0 failed ทั้ง macOS และ Linux CI)
> **อัปเดตล่าสุด:** 2026-09-27 (session `arena/01a0e089-luke-ai-studio-enterprise` — เก็บกวาด repo: ลบไฟล์สำรอง + ลบ branch เก่า)
>
> **อัปเดตล่าสุด:** 2026-09-27 (session `arena/01a0e089…` — CI + ตัวรันชุดเทสต์, แก้บั๊กที่ CI เจอ)
> **วิธีใช้ไฟล์นี้:** ท้ายทุก session ให้แก้หัวข้อ "งานค้าง" ด้านล่าง แล้ว **commit + push ให้เรียบร้อย**
> ทุก session ของ Arena จะ clone ใหม่จาก `main` เสมอ — ไฟล์หรือโค้ดที่ไม่ได้ push จะ**ไม่ตามมา** session ถัดไป
> **หมายเหตุ:** เพราะ session ถัดไป clone จาก `main` งานจึงต้อง **merge เข้า `main` ด้วย** (เปิด PR → merge) ไม่ใช่แค่ push branch ทิ้งไว้
> ส่วนค่า sha ของ `main` ในข้อ 1 ไม่ต้องอัปเดตทุกครั้ง — มันจะตามหลังไป 1 commit ทุกครั้งที่ไฟล์นี้ถูก merge จึงให้ดู `git log -1 --oneline main` แทน

---

## 1. สถานะปัจจุบัน

| รายการ | ค่า |
|---|---|
| `main` | ดู sha ล่าสุดด้วย `git log -1 --oneline main` — ณ จุดเริ่ม session 2026-10-20 คือ `910a834` = merge PR #44 · ก่อนหน้า `494c158` = merge PR #37 · ก่อนหน้า `bab9e33` = PR #36 (full post previews) · `58c8b9d` = PR #34 (model cache). ไฟล์นี้อาจ lag หนึ่ง commit ตามหมายเหตุด้านบน |
| เวอร์ชัน | `1.0.0-beta.16` (`app/version.json`, tag `v1.0.0-beta.16`) |
| PR ที่เกี่ยวข้อง | รอบนี้: แก้ปฏิทินโพสต์ล้นช่องวัน (session branch `arena/4552ca9e-luke-ai-studio-enterprise`) · PR #44 (คอนเทนต์อิงลูกค้า: มุม/เสาหลัก/แคปชัน/แฮชแท็กตามประเภทธุรกิจ + `validate.sh`/`start.sh`; session branch `arena/969a8048-luke-ai-studio-enterprise`) · PR #43 (ปฏิทิน auto-plan กดซ้ำได้ + หลายงานต่อวัน; session branch `arena/0b8f90ba-luke-ai-studio-enterprise`) · PR #38 (พรีวิวโพสต์บนสุด + สัญลักษณ์รูปตาในปฏิทิน + ตัวอย่างแคปชันสำเร็จรูป 3 แบบ; session branch `arena/c363a091-luke-ai-studio-enterprise`) · PR #37 (GPU/VRAM telemetry + resource governor) merged 2026-10-07 เป็น `494c158` · PR #36 merged 2026-10-07 เป็น `bab9e33` · PR #34 merged 2026-10-06 เป็น `58c8b9d` และ CI เขียว |
| branch บน GitHub (ตรวจ 2026-10-07) | `arena/01a10a92-luke-ai-studio-enterprise` = `a65ccfa` (7 commits: GPU telemetry + resource governor) ถูก fetch และ integrate ใน session branch นี้; branch ต้นทางยังคงอยู่บน origin เป็นสำเนาประวัติ — อย่า push งานใหม่ไป branch นั้น · branch เก่าที่เหลือตามบันทึกเดิมยังไม่ได้ตรวจซ้ำใน session นี้ · tag `v1.0.0-beta.16` = `fe84a3c` |
| งานค้างที่ทราบ | **รอบนี้: ยืนยันปฏิทินแบบใหม่บน Mac ตามเช็กลิสต์หัวข้อ 6** · ยืนยันบน Mac จริง: model-cache 4 ข้อ (หัวข้อ 7.6) · GPU/VRAM telemetry + resource governor + telemetry pause/resume + lazy cloud-SDK (เช็กลิสต์หัวข้อ 6) — Linux sandbox พิสูจน์ส่วน Metal/การปล่อยและโหลดคืนโมเดลไม่ได้ · สร้างภาพ WSB-019 ใหม่และทำ Mac-only checks ของ Social Agency ที่ยังเหลือในหัวข้อ 6 · **ของ session `arena/c363a091…`: พรีวิวบนสุด/ตาในปฏิทิน/ตัวอย่างแคปชันสำเร็จรูป** · **ของ session `arena/0b8f90ba…`: auto-plan กดซ้ำได้ + หลายงานต่อวัน — เช็กลิสต์ท้ายหัวข้อ 6** · branch telemetry เดิม integrate แล้ว · **ของ session `arena/969a8048…`: คอนเทนต์อิงลูกค้า (มุม/เสาหลัก/แคปชัน/แฮชแท็กตามประเภทธุรกิจ) + `validate.sh`/`start.sh` — เช็กลิสต์ท้ายหัวข้อ 6** |

---

## 2. งานล่าสุดที่เข้า `main`

### session `arena/c0c7cc07…` (2026-10-27) — LinkedIn เข้าปฏิทินโพสต์ (วางแผนฟรี + โพสต์จริงเมื่อมี token)

> ที่มา: “หากต้องการเพิ่ม LinkedIn เข้าไปด้วยในปฏิทินได้ไหม”

- **LinkedIn เป็นแพลตฟอร์มที่ 6 ของปฏิทิน** — `PLATFORMS` + `AUTO_PLAN_ALLOWED` (แต่ **ไม่** อยู่ในชุดเริ่มต้นของ auto-plan: ปฏิทินไม่ควรเริ่มร่างโพสต์ LinkedIn เองโดยไม่มีการเลือก) · ลิมิตแคปชัน 3,000 ตัวอักษร / แฮชแท็ก 5 · เข้าด่านตรวจภาพเหมือน FB/IG · มีฉบับต่อแพลตฟอร์ม + ตัวแก้ข้อความปิดท้าย
- **โพสต์จริงผ่าน Posts API** — `POST /rest/posts` พร้อม `Linkedin-Version: YYYYMM` + `X-Restli-Protocol-Version: 2.0.0`, `author: urn:li:person:…` · รูป: `initializeUpload` → PUT ไบต์ → `content.media.id` · Post ID มาจาก `x-restli-id` (ขยาย `_https` ให้คืน response headers) · `_linkedInVersion()` ปฏิเสธเวอร์ชันที่หมดอายุ/มั่วก่อนยิง
- **little-text escaping** — LinkedIn ตัดโพสต์เงียบ ๆ ที่ตัวอักษร `\|{}@[]()<>#*_~` ตัวแรก แล้วยังตอบ 201 · `linkedInCommentary()` escape รอบเดียว และแปลง `#แท็ก` เป็น `{hashtag|\#|แท็ก}` (ทดสอบแล้วกับภาษาไทย/`C#`/`#1`)
- **ความจริงเรื่อง OAuth** — ไม่มี OAuth ในแอป (เหมือน TikTok): ต้องสร้างแอป LinkedIn เอง เอา token มาวาง · ปุ่ม “ทดสอบและดึง URN” เรียก `/v2/userinfo` แล้วจำ `authorUrn` ให้ · token อายุ 60 วัน · **เพจบริษัท** ต้องขอ Community Management (อนุมัติรายแอป) จึงไม่รองรับ
- **ไม่มี token ก็ยังใช้ได้** — dry-run พร้อมข้อความบอกทางออก (“คัดลอกข้อความไปโพสต์เองได้ที่ปุ่ม เปิด LinkedIn”) · ปุ่ม **เปิด LinkedIn** ในหน้าโพสต์ · วิดีโอถูกปฏิเสธพร้อมเหตุผล ไม่ปล่อยผ่านเงียบ ๆ
- **UI** — ชิปสี LinkedIn, ตัวเลือกแพลตฟอร์มในฟอร์มสร้างโพสต์, ชิป auto-plan, ตัวแก้ข้อความปิดท้าย (เปลี่ยนจากลิสต์ตายตัวเป็น `Object.keys(PLATFORM_META)`), การ์ด Connectors พร้อมคำอธิบายข้อจำกัด
- **เอกสาร** — `docs/beta7/linkedin-posting.md` (ทำได้/ทำไม่ได้, วิธีเอา token, กับดัก little text, checklist)
- **เทสต์** — ใหม่ `scripts/validation/test-social-agency-linkedin.cjs` **12 checks** (แพลตฟอร์ม/ลิมิต, escaping, masking token, version ที่หมดอายุ, ดึง URN, ลำดับ 3 คำขอของโพสต์มีรูป, โพสต์ข้อความล้วน, ด่านตรวจภาพ, วิดีโอ, dry-run เมื่อไม่มี token, สาย UI) · `run-all` ผ่านครบ (168 suites; python duration-worker ข้ามตามดีไซน์)

### session `arena/555d6656…` (2026-10-27, PR #55) — 24 ช่องทาง: Bluesky + WordPress ติดตั้งเอง + ฟอรัม 5 ตัว และปิด 3 ช่องโหว่ของ relay

> ที่มา: “โพสต์เข้าเว็บบอร์ด/ชุมชนอัตโนมัติได้ไหม” · คำตอบเดิมคือ “ไม่มี” เพราะคลังมีแต่บล็อกสาธารณะ — รอบนี้เพิ่มช่องทางที่ **โพสต์ได้จริง** และบอกตรง ๆ ว่าช่องไหนทำไม่ได้เพราะอะไร

- **ช่องทางใหม่ 8 ตัว (รวมเป็น 24)** — `Bluesky` (App Password → `createSession` → `createRecord`, ตัดข้อความ 300 grapheme), `WordPress (ติดตั้งเอง)` (`/wp-json/wp/v2/posts`, Basic app password, HTML), `Discourse` (`/posts.json`, `Api-Key`+`Api-Username`), `XenForo` (`/api/threads/`, form-encoded, `XF-Api-Key`), `NodeBB` (`/api/v3/topics`), `Flarum` (JSON:API discussions/posts), `phpBB` (`/app.php/api/v1/forums/:id/topics`) และ `Pantip` (คลิกเดียว + แสดงกฎ 1 กระทู้/วัน/บัตร ปชช. ก่อนกด) · กลุ่มใหม่ `community` = “ฟอรัม/เว็บของเราเอง” · ช่อง self-hosted ตั้ง `da: 0` โดยเจตนา (ไม่มี third-party authority ให้อ้าง)
- **ช่องโหว่ #1 ปิด: header allowlist** — เพิ่ม `api-key`, `api-username`, `xf-api-key`, `xf-api-user`, `x-api-key` (รายชื่อยังเป็น static — ช่องทางประกาศ header เองไม่ได้)
- **ช่องโหว่ #2 ปิด: LAN ไปถึง relay จริง** — `runPlan(..., { allowLocalNetwork })` ส่งต่อจาก runtime ทุกครั้ง · สวิตช์ “เซิร์ฟเวอร์นี้อยู่ในเครื่อง/ในบ้าน” เป็น checkbox ต่อช่องทาง เก็บในไฟล์ credential และ **มีผลเฉพาะช่องที่ประกาศ `localAllowed`** · link-local/CGNAT/reserved ยังถูกบล็อกแม้เปิดสวิตช์
- **ช่องโหว่ #3 ปิด: เพดานของเราเอง** — `rateStatus()`/`_recordPublish()` + `app/runtime-state/ai-workflow/publish-rate.json` (เก็บแค่ timestamps, `0600`) · ตรวจ **ก่อนสร้าง plan** เพื่อไม่ให้ workflow ที่รันวนยิงถี่ · dry-run ไม่กินโควตาและยังใช้ตรวจ request ได้ · UI แสดง “เหลืออีก N โพสต์วันนี้ / รออีก Ns” และรีเฟรชหลังโพสต์จริง
- **UI** — ตัวกรองกลุ่มสร้างจาก registry (ไม่ hardcode 5 กลุ่มอีกต่อไป) · ช่องทาง self-hosted แสดง “เซิร์ฟเวอร์ของเราเอง” · ฟิลด์ URL/handle เป็น text (อ่านกลับได้ด้วยตา) ส่วนคีย์ยังเป็น password · แสดง `≤ N/วัน · ห่าง ≥ Ns` บนการ์ดทุกใบ
- **เอกสาร** — `docs/beta7/forum-and-community-posting.md` (3 ระดับ A/B/C, ตาราง 8 ช่องทาง, เพดานที่ระบบบังคับ, LAN opt-in, ทำไมไม่ทำแบบเครื่องมือ auto-post, สถานะ Pantip/Reddit/FB Groups, checklist ตั้งค่าคีย์) + ชี้ต่อจากเอกสาร 16 ช่องทางเดิม
- **เทสต์** — `test-ai-workflow-publishing.cjs` เพิ่มเป็น **22 checks**: Bluesky 2-step + grapheme, ฟอรัมทั้ง 5 ตัว (header/body/ผลลัพธ์), WordPress Basic auth + HTML, credential fields (URL=text, opt-in=toggle), policy matrix (LAN/dev/scoped, metadata บล็อกทุกกรณี), LAN opt-in ยิงจริงไป localhost ได้/ไม่ได้, rate gate + ไฟล์ rate ไม่มีข้อความ/คีย์
- **ผลตรวจ:** `run-all` (ติดตั้ง frontend deps + build dist แล้ว) → **ทุก suite ผ่าน ยกเว้น `test_image_to_video_duration_worker.py` ที่ขาด `imageio_ffmpeg` ในเครื่อง sandbox** (ข้ามได้ตามดีไซน์) · eslint ผ่าน · bundle budgets ผ่าน

### session `arena/042377dc…` (2026-10-27, PR #54) — build stamp: ตอบคำถาม “นี่ UI ใหม่หรือยัง”

> ที่มา: ผู้ใช้รายงานสองรอบว่า “ไม่เห็น palette กลุ่มเผยแพร่” ทั้งที่แก้และ merge แล้ว — ต้นเหตุจริงคือเบราว์เซอร์รัน bundle จาก commit เก่า (`WorkflowBuilder` chunk 35.94 kB = ก่อน PR #52) ไม่มีอะไรบนจอบอกได้

- **bundle พก commit ของตัวเอง** — `vite.config.js` อ่าน `git rev-parse HEAD` ตอน build แล้ว inject ผ่าน `import.meta.env.VITE_LUKE_BUILD` (ไม่ต้องประกาศ global ให้ eslint) พร้อมเขียน `app/dist/build-info.json` (plugin ใช้ `config.build.outDir` ที่ resolve แล้ว จึงรองรับ `--outDir` ของเทสต์)
- **`scripts/server/source-info.cjs`** — อ่าน commit/branch/dirty/commitDate ของ checkout ที่เซิร์ฟเวอร์รันอยู่ · ไม่ throw เมื่อไม่มี git (fallback `available:false`) · มี cache 15 วินาที (`createSourceInfoReader`) เพื่อให้ health ที่ถูก poll ไม่รัน `git status` ถี่ และยังตาม `git pull` ระหว่างเซิร์ฟเวอร์เปิดอยู่ได้
- **`/api/health`** เพิ่ม `source` (commit ของ checkout) และ `frontend` (commit ของ dist + `stale` + `sourceCommit`) — เซิร์ฟเวอร์เป็นคนตัดสินว่า dist เก่าหรือไม่ ไม่ปล่อยให้เบราว์เซอร์เดา
- **`app/frontend/src/lib/build-info.mjs`** — `diagnoseBuild()` แยก 4 สถานะ: `ok` (ตรงกัน) · `stale` (dist เก่ากว่าซอร์ส → บอกคำสั่ง `npx vite build`) · `cached` (แท็บเก่ากว่าไฟล์บนดิสก์ → บอก `Cmd+Shift+R`) · `info`/`unknown` (ไม่รู้ = ไม่รายงานว่าโอเค)
- **UI** — `BuildStamp.jsx` อยู่ท้าย Sidebar (เห็นได้ทุกหน้า) และแบบ compact ในหัว Workflow · ขึ้น `1.0.0-beta.16 · main@562a58d` + ชิปสถานะ + คำสั่งแก้เมื่อไม่ตรง
- **determinism:** stamp **ไม่มี** เวลาที่ build — เพราะ `test-frontend-dist-freshness` build ซ้ำแล้วเทียบ byte-for-byte (ตรวจจริง: build สองครั้งได้ hash เท่ากัน)
- **เทสต์ใหม่ `test-frontend-build-stamp.cjs` 6 checks** — source-info ตรงกับ `git rev-parse HEAD`, fallback นอก repo, cache/invalidate, config inject + ห้ามมี `Date.now()` ในก้อน stamp, bundle จริงมี sha, สถานะทั้ง 4, สาย serve.cjs/health, และ UI (Sidebar/App/WorkflowBuilder/CSS ทุก state)
- **ตรวจกับเซิร์ฟเวอร์จริง:** `GET /api/health` คืน `source.commit` + `frontend.commit` ตรงกัน · จำลอง dist เก่า (เขียน build-info.json เป็น `a7aaec1`) → `frontend.stale: true` ภายใน 15 วินาทีโดยไม่ต้องรีสตาร์ท · คืนไฟล์แล้วกลับเป็น `false`
- **ผลตรวจ:** `run-all --timeout 300` → 172 suites ผ่าน (ดูรายงานใน `validation-reports/`) · eslint 0 problems · bundle budgets ผ่าน (initial JS 288 145 B · CSS 75 331 B)

### session `arena/32507958…` (2026-10-27, PR #53) — แก้ palette ที่มองไม่เห็นกลุ่ม “เผยแพร่”

> ที่มา: “เข้าเมนู Luke AI Workflow ไม่เห็น palette กลุ่ม เผยแพร่ (ฟรี)”

- **ต้นเหตุ:** palette เป็นคอลัมน์กว้าง 218px ที่ `overflow-y: auto` แต่ใส่โหนดทั้ง 10 ตัว + หัวข้อ 3 กลุ่ม (~650px) กลุ่มที่สามจึงตกอยู่ใต้ขอบจอ และ macOS ซ่อน scrollbar จนดูเหมือนโหนดไม่มีอยู่จริง
- **แก้:** แสดง **ทีละกลุ่มหลังแท็บ** (สร้าง 5 · จัดรูปแบบ 3 · เผยแพร่ 2 พร้อมป้าย “ใหม่”) — แถวแท็บอยู่บนจอเสมอ ทุกกลุ่มจึงเข้าถึงได้ด้วยคลิกเดียว · แต่ละกลุ่มมีคำอธิบายว่ามีอะไรบ้าง
- **ทางเข้าที่สอง:** ชิปหัวเรื่อง **16 ช่องทางฟรี** เปลี่ยนเป็นปุ่ม เปิดโหนดเผยแพร่ + แท็บคลังช่องทางพร้อมกัน
- **กัน regression:** เพิ่ม 2 เช็คใน `test-ai-workflow-publishing.cjs` — โหนดทุกตัวต้องมีกลุ่มที่มีแท็บ (โหนดในกลุ่มที่ไม่มีแท็บ = โหนดที่ผู้ใช้เพิ่มไม่ได้) และ palette ต้องเรนเดอร์ทีละกลุ่มด้วย `role="tab"`/`aria-selected`
- **ตรวจด้วย DOM จริง:** เรนเดอร์คอมโพเนนต์ด้วย jsdom (ติดตั้งนอก repo) + mock `fetch` → แท็บขึ้น `สร้าง5 | จัดรูปแบบ3 | เผยแพร่2ใหม่`, คลิกแท็บเผยแพร่แล้วเห็น `โพสต์อัตโนมัติ, โพสต์คลิกเดียว`, คลิกชิปแล้ว palette สลับไปกลุ่มเผยแพร่และแท็บขวาเป็น `ช่องทางฟรี`
- **ผลตรวจ:** `run-all --timeout 300` → **166 passed · 0 failed** (`validation-reports/run-all-20261027-033642.txt`) · eslint 0 problems · bundle budgets ผ่าน

### session `arena/d8e43ee1…` (2026-10-26, PR #52) — Luke AI Workflow เผยแพร่จริง 16 ช่องทางฟรี

> ที่มา: “Workflow รู้สึกว่าไม่มีประโยชน์อะไรเลย อยากให้มีอะไรที่มากกว่านี้” · ก่อนหน้านี้ workflow จบที่ “ได้ข้อความ/รูป” แล้วจบ — ไม่มีทางเอาไปใช้ต่อ

- **คลังช่องทางฟรี 16 แห่ง** — `scripts/server/social-publish-channels.cjs` เป็นแหล่งความจริงเดียว (DA/PA ประมาณ, ชนิดลิงก์ dofollow/nofollow, วิธีสมัคร, ข้อจำกัดความยาว, `compose()`, `plan()`, `resultUrl()`); ฝั่งเบราว์เซอร์ import ไฟล์เดียวกันผ่าน `app/frontend/src/workflow-builder/channels.js` (แบบเดียวกับ `social-agency-post-copy.cjs`) จึงไม่มีรายการที่สองที่ค่อย ๆ ไม่ตรงกัน · `NOTES_REVIEWED = "2026-10"`
- **โหนดใหม่ 2 ชนิด** — `publish` = “โพสต์อัตโนมัติ” (ยิง API จริง) และ `onepost` = “โพสต์คลิกเดียว” (เตรียมข้อความ + ลิงก์ที่เติมให้แล้ว) · palette แบ่งกลุ่ม เขียน / สร้าง / เผยแพร่ · sanitizer ปฏิเสธช่องทางปลอม และปฏิเสธ `publish` บนช่องทางที่ไม่มี API
- **โพสต์ได้จริง 8 ช่องทาง:** DEV Community, Telegraph, GitHub Gist, WordPress.com, Telegram, Discord, Mastodon, Blogger · อีก 7 ช่องทางกดวางเองด้วยข้อความ+lิงก์ที่เตรียมให้ · Medium ใช้ import (API ปิดตั้งแต่ ม.ค. 2025) · Hashnode ต้อง Pro (พ.ค. 2026)
- **relay ฝั่งเซิร์ฟเวอร์** — `scripts/server/ai-workflow-publish.cjs`: HTTPS เท่านั้น (ยกเว้น loopback เมื่อขอ `allowLocalDev`), บล็อก loopback/private/link-local/CGNAT/`.local`/`.internal`, ตรวจ DNS ซ้ำกัน rebinding, ไม่ตาม redirect, timeout 20 วิ, request ≤ 200 KB, response ≤ 64 KB, header allowlist
- **คีย์ไม่ออกจากเซิร์ฟเวอร์** — `app/runtime-state/ai-workflow/publish-credentials.json` สิทธิ์ `0600` เขียน atomic · `/state` คืนแค่ boolean · dry run ปิดค่าเป็น `[set]` · run record เก็บแค่ `channel`/`channelName` ไม่เก็บตัวบทความ
- **UI** — แท็บขวา “ช่องทางฟรี” (ค้นหา + ตัวกรอง ยิง API ได้/ต้องกดเอง/สมัครง่าย เรียงตาม DA), กล่องคีย์ + ปุ่มทดลองก่อน + “โพสต์เลยตอนนี้”, แถบโพสต์เหนือผืนผ้าใบ, artifact แบบโพสต์พร้อมปุ่มคัดลอก, ชิปหัวเรื่อง “16 ช่องทางฟรี”
- **สูตรสำเร็จ 2 ชุด** — “โพสต์ฟรีหลายเว็บ (High DA) — เขียนครั้งเดียว” (DEV + Telegraph อัตโนมัติ, Medium + LinkedIn คลิกเดียว) และ “ประกาศโปรโมชัน → Telegram + Discord อัตโนมัติ”
- **เอกสาร:** `docs/beta7/free-high-da-publishing-platforms.md` (ตาราง DA/PA + ชนิดลิงก์ + ข้อควรระวัง + ทางเลือกเชิงพาณิชย์) และอัปเดต `docs/beta7/ai-workflow-builder-v1-spec.md`
- **เทสต์:** ใหม่ `scripts/validation/test-ai-workflow-publishing.cjs` **16 checks** (ตารางช่องทาง, compose, plan, normalise, SSRF, header allowlist, ยิง HTTP จริงบน localhost, redirect ไม่ถูกตาม, placeholder ถูกส่งต่อ, ไฟล์คีย์ `0600` และไม่โผล่ใน `/state`, dry run ปิดคีย์, ช่องทาง manual ไม่ throw, sanitizer, seed, run record, ซอร์ส UI) · `run-all --filter social` 19/19 · eslint 312 ไฟล์ 0 problems · bundle budgets ผ่าน (initial JS 293 809 B ≤ 307 200 · CSS 74 363 B)

### session `arena/4552ca9e…` (2026-10-20) — ปฏิทินโพสต์ไม่ล้นช่องวัน
- **ต้นเหตุจากภาพหน้าจอ:** `.sa-grid-body` บีบแต่ละสัปดาห์ลงเหลือขั้นต่ำ 96px แต่ `.sa-day-chips` เป็น `overflow: visible` ทำให้ 4 โพสต์/วันวาดทับสัปดาห์ถัดไป
- `social-agency.css` — แถววันสูง 304px (พอสำหรับ 4 โพสต์พร้อมป้าย) · day/list มี `min-height: 0` และขอบเขตชัดเจน · การ์ดไม่หด · รายการที่มากกว่านั้น **เลื่อนเฉพาะในช่องวัน** (`overflow-y: auto`, `overscroll-behavior-y: contain`) ไม่ได้ตัดข้อมูลทิ้ง
- หัววันและเดือนใช้ **scroll container เดียวกัน** + `repeat(7, minmax(0, 1fr))` + ความกว้างขั้นต่ำเดียวกัน 896px · หัววัน sticky · หน้าต่างแคบเลื่อนแนวนอนได้โดยคอลัมน์ไม่เหลื่อม และไม่มี horizontal overflow ทั้งหน้า
- `CalendarTab.jsx` — การ์ด 2 บรรทัด (เวลา/แพลตฟอร์ม/ตาพรีวิว → ชื่อสินค้า) พร้อม tooltip ชื่อเต็ม/สถานะ/มุม/เสา/ป้าย · จำนวนโพสต์บนหัวช่อง (เกิน 4 มี `↕` แจ้งให้เลื่อน) · open/delete เป็น **native button แยกกัน** ใช้คีย์บอร์ดได้ ไม่ซ้อนปุ่ม · เลือกหลายรายการ/กรอง/ค้นหา/ลากย้ายวันยังใช้ callback เดิม · แก้ช่องว่างต้น/ท้ายเดือนไม่ให้ขึ้นกรอบ dragover ตั้งแต่ยังไม่ลาก
- **ไม่แก้ backend / planner / runtime-state / เวลาโพสต์ใด ๆ** · แก้เฉพาะ fixture ของ `test-social-agency-fb-post-readiness.cjs` ให้ล้างปฏิทิน seed ใน **temp root ของเทสต์** ก่อนสร้างรายการของตัวเอง: วันที่ 2026-10-20 เทสต์เดิมเลื่อนไปวันนี้+2 เวลา 18:30 แล้วชน seed (ล้มซ้ำได้แบบ standalone) ไม่ใช่ regression ของ UI
- เพิ่ม `test-social-agency-calendar-layout.cjs` **10 checks**: สัญญา CSS containment/columns + **SSR คอมโพเนนต์ React จริงผ่าน Vite** ตรวจ grouping/order, 4 และ 24 รายการไม่หาย, ไม่แก้ input, เดือน 4/5/6 สัปดาห์, ปุ่มไม่ซ้อนกัน, accessible labels และ drag contract · ใช้ dependency frontend เดิมทั้งหมด
- Browser QA ด้วย Chromium/Playwright (ข้อมูลจำลอง ไม่ต่อ backend/บัญชีจริง): **9 scenarios ผ่าน** — ขนาด 1000/960/760/390px, 4 โพสต์พร้อมป้าย/ชื่อยาวอยู่ครบในวัน, วัน 24 โพสต์เลื่อนถึงรายการสุดท้าย, sticky header/column alignment, Enter เปิด/ลบ, bulk-select, filters/search, native drag/drop คงเวลา, add-modal/month navigation, ธีมมืด/สว่าง · เครื่องมือ/ภาพ QA อยู่ใน `app/cache/` ที่ถูก ignore ไม่เพิ่ม browser dependency ให้แอป
- **ผลตรวจเต็ม:** `node scripts/validation/run-all.cjs --timeout 300 --include-python` → **161 passed · 0 failed · 0 skipped (231.2s)** (`validation-reports/run-all-20261020-044902.txt`) · `npm run build` ผ่าน · eslint 300 files / 0 problems

### PR #44 (session `arena/969a8048…`, 2026-10-16) — คอนเทนต์อิงลูกค้า (เลิกใช้ชุดโรงงานกระเป๋ากับทุกธุรกิจ) + `validate.sh`/`start.sh`

> ที่มา: "หากไม่ได้เจาะจงว่าจะต้องเป็นกระเป๋า อยากให้อิงจากลูกค้า — ในปฏิทินว่าต้องการอะไร" · ก่อนหน้านี้ทุกลูกค้า (เบเกอรี่/กาแฟ/โยคะ/ต้นไม้) ถูกวางแผนด้วยมุมคอนเทนต์ของโรงงานกระเป๋าและแคปชันตัวอย่างที่พูดถึง "โรงงาน" "OEM" "เวลาผลิต"

- **ประเภทธุรกิจของลูกค้า** — `scripts/server/social-agency-content-kinds.cjs` (โมดูลบริสุทธิ์: ไม่มี state/fs/network) มี 5 ชนิด: `goods` (สินค้า/งานผลิต/OEM), `food` (อาหาร/เครื่องดื่ม), `service` (บริการ/คลาสเรียน), `shop` (ร้านค้า/ขายปลีก), `generic` · `detectContentKind(client)` ให้คะแนนคำสำคัญจาก `industry` (×3) + `category` (×2) + `name` (×1) · `client.contentKind` ที่ผู้ใช้ตั้งจะชนะการตรวจเสมอ (`PATCH /clients/:id` รับค่า `auto|<kind>`, ค่าที่ไม่รู้จักถูกปฏิเสธ)
- **5 มุมคอนเทนต์ต่อชนิด (บทบาทเดิม launch/behind/knowhow/customer/promo)** — มุมชุดเดิมทั้ง 5 ("เปิดตัวสินค้า", "เบื้องหลังการผลิต", "เคล็ดลับการใช้งาน", "เรื่องจากลูกค้า", "โปรโมชัน/ข้อเสนอ OEM") **คือ kind `goods`** จึงไม่มีการเปลี่ยนชื่อ ไม่มี entry/pillar เก่าที่เสียผล · `CONTENT_ANGLES` = union ของทุกชนิด (23 มุม) ใช้ตรวจความถูกต้อง ส่วนมุมที่ลูกค้ารายหนึ่งวางแผนด้วยมาจาก `anglesForKind(kind)` + `clientAnglePool(client)` ของรายนั้น
- **แผนรายเดือนใช้มุมของลูกค้ารายนั้น** — `_buildDailySlots`/`_buildFallbackSlots` ใช้ `planAnglesFor(client)`: มุมจากเสาหลักของลูกค้า ซ้ำตามน้ำหนักเสาแบบ **รอบต่อรอบ** (ไม่ให้สองวันติดกันได้มุมเดิม) · `autoPlanPreview` รับ `angles: [...]` จากตัวเลือกในปฏิทิน และตอบ `contentKind`, `contentKindLabel`, `angles`, `angleMix`, `angleOptions` กลับไปให้ UI
- **แคปชัน/ตัวอย่างสำเร็จรูป/แฮชแท็ก/โทนเสียง/ภาพ ตามชนิด** — `captionLeads(kind, role)` (ชุดของ `goods` เหมือนเดิมทุกตัวอักษร), `orderWording` ("สั่งขั้นต่ำ/ผลิต" สำหรับงานผลิต · "จำนวนขั้นต่ำ"/"เริ่มต้น" สำหรับร้าน/บริการ), `hashtagsForKind` (ตารางที่เคยดีอยู่แล้วอย่างกระเป๋า/เค้ก/กาแฟ/โยคะ/ต้นไม้ ยังอยู่ · fallback ใหม่แยกตามชนิด ไม่ใช่ "#สั่งทำ/#ผ้าฝีมือคนไทย" อีก), `toneLines` (โทนปิดท้ายอิงธุรกิจ) และ `angleImagePrompt` (วลีอังกฤษของ SD ต่อชนิด) · `templateHashtags(product, platform, client)` เรียกแบบไม่มี client = พฤติกรรมเดิมเป๊ะ
- **เสาหลักตามประเภทธุรกิจ + ย้ายครั้งเดียว** — ลูกค้าใหม่ได้เสาหลักของธุรกิจตัวเอง (`pillarsForKind`) · state เดิมที่ยังถือเสาชุดโรงงาน (เทียบเท่า 3 เสามาตรฐาน) จะถูกย้ายให้ครั้งเดียวพร้อมบันทึก `contentPillarsSyncedKind` · **เสาที่ผู้ใช้แก้เอง (`contentPillarsEditedAt`) ไม่ถูกทับ** และถ้าธุรกิจที่ตรวจได้เปลี่ยนเอง (เพิ่ม/แก้สินค้า) ระบบจะเปลี่ยนให้ตาม (เฉพาะโหมด auto)
- **UI: ปฏิทินบอกว่าเดือนนี้ลูกค้าต้องการอะไร** — แถบเครื่องมือ ปฏิทินมีตัวเลือก "มุมคอนเทนต์:" (ตั้งต้นติ๊กครบทุกมุมของลูกค้ารายนั้น, ไม่ติ๊กเลย = ใช้ทุกมุม) ส่งไปกับ `POST /api/social-agency/auto-plan` · หน้าต่างวางแผนสรุป "มุมคอนเทนต์เดือนนี้ (kind · N มุม): มุม ×จำนวน" · แท็บ สไตล์ แสดงชนิดของธุรกิจและมุมที่เลือกได้ (มุมของชนิด + มุมที่เสาใช้อยู่) · หัวเรื่องลูกค้าโชว์ "คอนเทนต์แบบ <kind>"
- **`validate.sh` / `start.sh` ที่ root** — `validate.sh`: ตรวจ node ≥20 → `npm install` (scripts/server + app/frontend ถ้ายังไม่มี) → `npx vite build` → `node scripts/validation/run-all.cjs` (ส่ง flag ต่อได้ เช่น `--filter social`, `--include-python`, `--no-install`, `--no-build`) · `start.sh`: เลือก `mac.sh` (Darwin) / `linux.sh` (Linux) ให้เอง และเตือนถ้ายังไม่ build
- **เทสต์:** ใหม่ `scripts/validation/test-social-agency-client-content.cjs` **17 checks** (ตรวจจนิดของลูกค้าตัวอย่างครบทั้ง 5, kind ที่เลือกเองชนะ, มุมต่อชนิด + union, แผนใช้มุมของลูกค้า, การถ่วงน้ำหนักแบบไม่ซ้ำวันติดกัน, ตัวกรองมุม, entry ใช้ angle+pillar ของแผน, การย้ายเสาครั้งเดียว/ไม่ทับของที่แก้, การรับมุมใหม่และปฏิเสธมุมปลอม, แคปชัน/ตัวอย่าง/แฮชแท็ก/ภาพตามชนิด, ข้อมูลเดิมยังใช้ได้, UI) · อัปเดตเทสต์ที่เกี่ยวข้องให้ยังผ่าน · `eslint` ทั้งทรี 298 ไฟล์ 0 problems · Vite build ผ่าน · `run-all --include-python` **160 passed · 0 failed · 0 skipped** (`validation-reports/run-all-20261016-101110.txt`)

### PR #43 (session `arena/0b8f90ba…`, 2026-10-16) — ปฏิทิน: auto-plan ทั้งเดือนกดซ้ำได้ + หลายงานต่อวัน (FB/IG/LINE/เว็บ ในวันเดียว)

- **หน่วยของแผนเปลี่ยนจาก "วัน" เป็น (วัน, แพลตฟอร์ม)** — `_buildDailySlots` ไม่ข้ามวันที่มีโพสต์แล้วทั้งวันอีก แต่ข้ามเฉพาะ (วัน, แพลตฟอร์ม) ที่ถูกใช้ · เลือกแพลตฟอร์ม/วันใน `CalendarTab.jsx` ได้หลายอัน (ค่าเริ่มต้น facebook/instagram/line/demo) → วันเดียวมีได้ทั้ง 4 ช่อง เวลากระจายกัน (`AUTO_PLAN_PLATFORM_TIMES` + `_nudgeFreeTime` nudge 30' กันชน, date+time ไม่ซ้ำ) · TikTok ไม่เข้าแผนอัตโนมัติเหมือนเดิม · ป้ายแพลตฟอร์ม demo เปลี่ยนเป็น **"เว็บ (Demo)"/WEB** (ตามที่ผู้ใช้เรียกว่า "เว็บโพสต์")
- **สินค้า: หนึ่งวันหนึ่งสินค้า ข้ามทุกแพลตฟอร์มของวันนั้น (cross-post)** — วันละสินค้าไม่ซ้ำกันเท่าที่คลังพอ (P5w เดิม) · วันที่มีโพสต์เดิมอยู่จะใช้สินค้าของวันนั้นต่อ (เติมช่อง IG/LINE/เว็บให้วันที่วาง FB ไว้แล้วโดยไม่เปลี่ยนสินค้าวัน) · สินค้าไม่พอ = shortBy เตือนเหมือนเดิม
- **วางแผนซ้ำได้ในเดือนเดียวกัน** — รอบสองขึ้นไปเติมเฉพาะ (วัน, แพลตฟอร์ม) ที่ยังว่าง (เดิม: วันเต็ม + used-SKU ล็อก → ทำได้ครั้งเดียวต่อเดือน แม้ลบโพสต์ไปแล้วยังวางแผนต่อไม่ได้) · ตอนนี้ลบรายการแล้วกดวางแผนใหม่ได้ทันที
- **ตัวเลือก "แทนที่แผนเดิม" (`replacePlanned`)** — วางแผนใหม่ทับเฉพาะรายการสถานะ `planned` ที่ยังไม่เริ่มรัน ใน (วัน, แพลตฟอร์ม) เดียวกัน · รายการที่เผยแพร่แล้ว/กำลังรัน (`in_workflow`/`inFlight`)/A-B/TikTok ที่ส่งแล้ว **ไม่ถูกแตะ** · เวลาของรายการเดิมที่จะถูกแทนที่ถูกปลดให้ช่องใหม่ของแพลตฟอร์มนั้นเท่านั้น ช่องอื่นยังเลี่ยงเวลาเดิม · รายงาน `replaced`/`skippedConflict`
- **apply รับ 200 ช่อง/ครั้ง** (เดิมตัดที่ 31 — ไม่พอสำหรับเดือนละ 4 โพสต์/วัน) · กันสองโพสต์ซ้ำ (วัน, แพลตฟอร์ม) และกันชน date+time · `enforceUniqueProducts` เปลี่ยนเป็น "ไม่ซ้ำ**ระหว่างวัน**" (ข้ามแพลตฟอร์มวันเดียวกันได้ — จำเป็นสำหรับ cross-post)
- **โหมดรายสัปดาห์** (`postsPerWeek`) หมุนเวียนเฉพาะแพลตฟอร์มที่เลือก (`_buildFallbackSlots` รับ `opts.platforms`/`opts.replacePlanned`) · LLM merge ยังรับเฉพาะช่องว่างจาก fallback ดังเดิม
- **UI:** แถบเครื่องมือมี "แพลตฟอร์ม/วัน:" + "ทุกวัน" + "แทนที่แผนเดิม" + tooltip ปุ่มวางแผนว่า "กดกี่ครั้งก็ได้ในหนึ่งเดือน" · โมดัล `AutoPlanModal` สรุป "X ช่อง/วัน (f · IG · LINE · WEB) · ครอบคลุม N/M วัน" + คำอธิบายโหมดแทนที่ + ข้อความ empty ใหม่บอกทางออก (เพิ่มแพลตฟอร์ม/แทนที่/ลบบางรายการ) + ตัด productMix ที่ 6 รายการ + รายการแผน `max-height: 46vh` เลื่อนได้
- **เทสต์:** ใหม่ `scripts/validation/test-social-agency-auto-plan.cjs` **14 checks** (4 ช่อง/วัน เวลาไม่ชน, เลือกแพลตฟอร์ม, วันที่มีโพสต์เดิม, วางแผนซ้ำ 3 รอบ, replacePlanned รอดพ้น published/in_workflow, apply >31 ช่อง, กันซ้ำ (วัน, แพลตฟอร์ม)/date+time, enforceUnique ข้ามวัน vs ข้ามช่อง, สินค้าน้อย+ลบแล้วปลดล็อก, รายสัปดาห์, แหล่ง UI) · อัปเดต P5w smoke ใน `social-agency-groups-smoke.cjs` เป็น 120 ช่อง (30 วัน × 4) + เคสวางแผนซ้ำ/แทนที่ (`w2*`) · groups-smoke 105 checks · metrics/tiktok/tracking-ab smoke ผ่าน · `eslint` 297 ไฟล์ 0 problems · Vite build ผ่าน (entry JS 293.71 kB ≤ 307,200) · `validate-release.sh` ผ่าน (ติดตั้ง `imageio_ffmpeg` แล้ว) · `run-all` **158 passed · 0 failed · 1 skipped** · **ยังต้องยืนยันบน Mac จริง** — เช็กลิสต์ท้ายหัวข้อ 6

### PR #38 (session `arena/c363a091…`, 2026-10-07) — พรีวิวโพสต์บนสุด + สัญลักษณ์รูปตาในปฏิทิน + ตัวอย่างแคปชันสำเร็จรูป 3 แบบ
> ⚠️ **เขียนใหม่ทั้งชุด** — session ก่อนบันทึกว่าเสร็จใน local commit `86f6cf2` แต่ไม่เคย push จึงไม่มี object อยู่จริง (เคสที่ 5 — ดูหัวข้อ 7.7) สเปกชุดนี้สร้างใหม่จากข้อความส่งต่อ + โค้ดจริงใน `main` ณ `494c158`

- **พรีวิวโพสต์จริงขึ้นบนสุดของรายละเอียด** — ใน `drawers.jsx` ย้าย section "พรีวิวโพสต์เต็ม" (`PostPreview` = ภาพ/วิดีโอ + แคปชันเต็มตามเลย์เอาต์แพลตฟอร์ม) ไปไว้ใต้แถวสถานะทันที จึงเปิดรายการแล้วเห็นภาพกับข้อความก่อนอนุมัติโดยไม่ต้องเลื่อน · เทสต์กันไม่ให้มีพรีวิวสองที่ (assert ว่ามีสำเนาเดียว)
- **สัญลักษณ์รูปตาในรายการปฏิทิน** — `CalendarTab.jsx` ชิปแต่ละใบมีไอคอน `Eye` เมื่อรายการนั้นมีอะไรให้ตรวจ (มีแคปชัน/ภาพ/วิดีโอ) พร้อม tooltip "เปิดดูพรีวิวภาพและข้อความก่อนอนุมัติ" — คลิกชิปเปิดหน้าที่มีพรีวิวอยู่บนสุดแล้ว
- **ตัวอย่างสำเร็จรูป 3 แบบ** (`CAPTION_PRESETS` ใน `social-agency-runtime.cjs` + `CaptionPresets.jsx`): **แนะนำสินค้า** (`product-intro`), **ชวนคิดจากโจทย์ใช้งาน** (`use-case-prompt`), **ชวนเริ่มพูดคุย** (`conversation-starter`) — แต่ละแบบเติมข้อความจากข้อมูลสินค้าจริงของรายการนั้น (ชื่อสินค้า, `detail` ที่สั้นพอ, ขั้นต่ำ, เวลาผลิต, ราคา **เฉพาะเมื่อมีในระบบ**), ปรับแฮชแท็ก/ความยาวตามแพลตฟอร์ม (LINE กระชับ ≤2 แฮชแท็ก, FB/IG/TikTok 3–8 หรือ ≤5), และแถบตัวอย่างใช้ `PostPreview` ตัวเดียวกับพรีวิวหลัก (แก้ข้อความแล้วพรีวิวเปลี่ยนตามทันที)
- **การใช้ตัวอย่างแทนที่เฉพาะแคปชัน** — เส้นทางใหม่ `GET /api/social-agency/caption-presets` (อ่านอย่างเดียว) และ `POST /api/social-agency/entry-caption/preset`: `applyCaptionPreset()` อ่านจาก body แค่ `presetId`/`caption` แล้วเขียน `entry.caption` + `captionManual = true` + `captionSource = "preset:<id>"` เท่านั้น — ไม่แตะรูป วัน เวลา แพลตฟอร์ม สถานะ ไม่เริ่ม workflow และไม่เผยแพร่ (ต่างจาก `PATCH /calendar/:id` ที่แก้ได้หลายฟิลด์) · ข้อความที่แก้เองชนะข้อความตัวอย่าง; ยาวเกินเพดานแพลตฟอร์ม/ไม่รู้จักตัวอย่าง → ปฏิเสธพร้อมเหตุผลและไม่เขียนอะไร
- **รายการที่แก้ไม่ได้ถูกล็อกพร้อมเหตุผล** — `abTest`, `abTestSource`, `inFlight`/`publishing`, `tiktokPost`/`tiktokInitAttemptedAt`/`tiktokPublishId`, `published` → UI แสดงแบนเนอร์เหตุผลแทนปุ่มใช้ (แคปชัน TikTok ที่ยืนยันแล้วต้องไปยืนยันใหม่ในช่อง TikTok) · การใช้ตัวอย่างบนรายการ `needs_review` ยังต้องอนุมัติตามปกติ
- **รูปอ้างอิงเมื่อยังไม่มีภาพโพสต์** — พรีวิวของตัวอย่างใช้ `PostPreview` ที่มี fallback อยู่แล้ว (รูปสินค้าต้นฉบับ + ป้าย "รูปอ้างอิง · ยังไม่ใช่สื่อโพสต์") และเพิ่มบรรทัดอธิบายชัดเจนในแผงตัวอย่างว่าเป็นรูปอ้างอิงและ "ระบบจะไม่ส่งรูปนี้แทนสื่อโพสต์"
- **แก้บั๊กที่เจอระหว่างทาง (ด่านหลักฐานราคา)** — `_localEvidenceIssues()` เดิมตัดสินว่าแคปชันอ้างราคาได้ไหมจากเงื่อนไข "มีคำว่า บาท ในชื่อ/หมวด/ขั้นต่ำ/เวลาผลิต" ซึ่งไม่เคยนับ `product.price` เป็นหลักฐาน → แคปชันที่อ้างราคาจากข้อมูลจริง (ทั้งเทมเพลตและตัวอย่างใหม่) ถูกตีเป็น "อ้างราคาที่ไม่มีในหลักฐานสินค้า" ทุกครั้ง · เพิ่ม `_priceQuoteIsBacked()` เปรียบเลขในคำอ้างกับ `product.price` (และเลขที่มีในฟิลด์อื่น) — ราคาที่มีจริงผ่าน, เลขที่ไม่มีในระบบยังถูกจับเหมือนเดิม ( demo bad draft ของ `needs_review` ยังถูกจับตามเดิม)
- เทสต์ใหม่ `scripts/validation/test-social-agency-caption-presets.cjs` **14 checks** (mocked ทั้งหมด): 3 ตัวอย่าง/ป้ายชื่อ, ข้อความอยู่ในกติกาแพลตฟอร์มทุกแพลตฟอร์ม, ราคามี/ไม่มีในหลักฐาน, การอ่านไม่เขียน state, การใช้ตัวอย่างไม่แตะฟิลด์อื่น/ไม่เริ่ม run/ไม่อนุมัติ, ข้อความที่แก้ชนะ, ปฏิเสธเกินเพดาน/ตัวอย่างไม่รู้จัก, รายการที่ถูกล็อกทั้ง 7 แบบ, และฝั่ง UI (ไอคอนตา, ลำดับพรีวิวบนสุด, การเรียกเส้นทางใหม่, ข้อความ fallback รูปสินค้า)
- ตรวจผ่าน: Social Agency **9 ชุด**, `eslint` ทั้งทรี **292 ไฟล์ 0 problems**, `check-api-contracts` (frontend 293 ↔ backend 366 endpoints), `test-api-route-methods` (ไม่ 500), frontend bundle budgets (entry JS 293,712 ≤ 307,200 bytes), Vite build, `git diff --check`, และ `run-all` **155 passed · 0 failed · 1 skipped** · **ยังต้องยืนยันบน Mac จริง** — เช็กลิสต์ท้ายหัวข้อ 6

### PR #36 (2026-10-07 — merged เป็น `bab9e33`) — full post previews ใน Luke Social Agency
- preview แบบเต็มและแยกตามแพลตฟอร์ม แสดงแคปชันเต็มและ media layout ใน Style & Editions, post details และ approval queue
- แยกรูปสินค้าแบบ reference-only และใช้ layout สำหรับ Facebook, Instagram, LINE และ TikTok
- เทสต์ `test-social-agency-post-preview.cjs` 6 checks; `test-social-agency-image-gate-ui.cjs` 10 checks; smoke 104 checks

### PR #37 — งาน GPU/VRAM telemetry + resource governor (session `arena/bd08f753…`, รับช่วง tip `a65ccfa` จาก `arena/01a10a92…`)
- `gpu-memory-telemetry.cjs` + `pollMetalVram()` วัด resident set ของ backend ที่ถือโมเดลจริงบน macOS ผ่าน `ps -axo pid=,rss=`; ใช้ Metal working set เป็นเพดาน แทนการแสดง `0.0 / total RAM` และไม่อ้าง RAM ของโปรเซสอื่นว่าเป็น VRAM ของ LUKE
- `resource-governor.cjs` อ่าน memory pressure จาก macOS compressor/swap หรือ Linux `MemAvailable`/swap, ปรับเกณฑ์ตาม machine tier, และปลดเฉพาะ engine ที่โหลดคืนเองได้; การปลดก่อนโหลดเป็น all-or-nothing และปกป้องงานที่กำลังใช้อยู่ / Social Agency / image generation
- `telemetry-demand.cjs` หยุด polling ฮาร์ดแวร์เมื่อไม่มี client ดู monitor เกิน 30 วินาที; hidden browser tab หยุด poll ด้วย · AWS SDK ถูก defer จนกว่าจะเรียก cloud storage จริงเพื่อลด RSS ตอน idle
- RAM chip นำเสนอ footprint ที่ LUKE รับผิดชอบแยกจาก memory ของทั้งเครื่อง; `Generator.jsx` ตรวจสถานะ process ก่อนจะ skip การ restart backend ที่ถูก governor unload ไป
- เทสต์ใหม่ 4 ชุด: GPU telemetry 44, lazy cloud SDK 12, resource governor 120, telemetry demand 32 checks · Vite build ผ่าน · run-all **154 passed / 0 failed / 1 skipped** (Python suite รันแยกและผ่าน) · **ยังต้องยืนยันบน Mac จริง** — ดูเช็กลิสต์หัวข้อ 6

### PR #34 (session `arena/ccbe7be3…`, 2026-10-06 — **merged เป็น `58c8b9d`, CI เขียว**) — โมเดลภาพเข้า model cache + โหลดจากสำเนาบนดิสก์ภายในเมื่อมีสำเนา
> ⚠️ **เขียนใหม่ทั้งชุด** — session ก่อนทำไว้แล้วแต่ไม่เคย push จึงหายไปกับ sandbox (ดูหัวข้อ 7.6) สเปกชุดนี้จึงถูกสร้างใหม่จากการอ่านโค้ดจริงใน `main` ไม่ใช่จากการคาดเดา

- **`scripts/server/model-cache.cjs` รองรับ "โฟลเดอร์"** — เมื่อก่อน `cachePlan` ปฏิเสธทุกอย่างไม่ใช่ไฟล์ (`stat.isFile()`) ซึ่งโมเดลภาพที่ติดตั้งจริงเป็น **โฟลเดอร์ Core ML** (`unet.mlmodelc/`, `text_encoder.mlpackage/`, …) ทั้งโฟลเดอร์ → ไม่เคยเข้าเกณฑ์จะแคชเลย · เพิ่ม `treeFingerprint()` (นับไฟล์ + รวมไบต์ + mtime ล่าสุด, ข้าม `.DS_Store`, ตาม symlink แบบถอดเป็นไฟล์จริงเพราะ HF snapshot ใช้ symlink) และ `fingerprintMatches()` ที่ใช้กับทั้งไฟล์และโฟลเดอร์ · `primeCache` คัดลอกโฟลเดอร์เข้าชื่อ `.partial` ก่อนแล้วค่อย rename = โฟลเดอร์ที่ค้างครึ่งเดียวจะไม่ถูกเสนอเป็นแคช · ตรวจจำนวนไฟล์+ไบต์ของสำเนากับต้นฉบับ**ก่อน**เขียน manifest เสมอ
- **แก้บั๊กที่ทำให้ cache ไม่เคยถูกใช้** — ตัวโหลด (`startLlmWithBackend`) เรียก `cachePlan(modelPath)` แบบไม่บอกดิสก์ ซึ่งชี้ไปที่ `app/runtime-state/model-cache` (โฟลเดอร์ของแอป = อยู่ Volume เดียวกับโมเดล ซึ่ง `primeCache` ปฏิเสธการคัดลอก) ขณะที่ปุ่ม Copy ใน `Settings > Performance` เขียนสำเนาไว้ที่ `internalCacheRoot()` (`~/Library/Application Support/LUKE AI STUDIO/model-cache` บน Mac) → **มีสำเนาอยู่บนดิสก์ภายในอยู่แล้วแต่ไม่มีใครหาเจอ** · เพิ่ม `cachedCopyFor()` ที่ค้น **ทั้งสองที่** (ดิสก์ภายในก่อน) โดยยืนยัน fingerprint ทุกครั้ง แล้วให้ทั้งตัวโหลดโมเดลข้อความและตัวโหลดโมเดลภาพใช้ร่วมกัน
- **โมเดลภาพได้ path จากสำเนาแล้วจริง** — ใน `startBackend`:คำนวณ `imageLoadPath` จาก `cachedCopyFor(imageModelPath)` แล้วส่งค่านี้ให้ `--model` **ทั้งสอง backend** (Core ML และ stable-diffusion.cpp) แทน `currentSettings.model` · ใช้เฉพาะตอน `pathInside(cachedPath, cacheDir)` ผ่าน · memory budget ยังวัดจาก path จริงของผู้ใช้ · log บอกว่าโหลดจากดิสก์ภายในกี่ GB / กี่ไฟล์
- **`/api/model-cache/status` ตอบ `POST`** — panel เรียก POST มานานแล้วแต่ route รับเฉพาะ GET → ได้ 404 เงียบ ๆ แล้วไม่แสดงข้อมูลแคชเลย และ `useInternalDisk` ที่ panel ส่งไปใน body ถูกทิ้ง (hardcode `false`) ตอนนี้รับทั้ง GET/POST และเคารพค่าที่ส่งมา · ลิสต์**ทั้งโมเดลข้อความและโมเดลภาพ** (ใหม่: `cacheableModelPaths()`, ติด `kind`/`label`/`name`/`fileCount` ให้ UI แสดงด้วย) · ส่วน dropdown "Draft model" กรองเหลือเฉพาะ `kind !== "image"` เพราะ llama.cpp ใช้ได้แต่ GGUF
- **`/api/model-cache/prime` รับโมเดลภาพ** — ยังไม่รับ path จาก request (basename แล้ว lookup กลับเข้าไปในโฟลเดอร์โมเดลเหมือนเดิม) แต่เพิ่ม `scope: "text"|"image"` กันชื่อชนกันระหว่างสองโฟลเดอร์ · refuse case เดิม (`../../etc/passwd`, `/etc/hosts`) ยัง 400 · *"คัดลอกไปก็ไม่มีประโยชน์"* (ดิสก์เดียวกัน) เดิมตอบ **500** ตอนนี้ตอบ **400 พร้อมเหตุผล** (ตั้ง `statusCode` ใน `model-cache.cjs`)
- **`coreml_server.py` อ่านจากสำเนาก่อน** — `load_reference_pipeline()` เรียก `from_pretrained(..., local_files_only=True, cache_dir=app/runtime-state/huggingface-cache)` ก่อน ถ้าไม่มีสำเนาจึงดาวน์โหลด**ครั้งเดียว**แล้ว stays on disk · `use_auth_token` ยังส่งตามเดิม (ไม่พังกับ repo ที่ต้อง login) แต่ fallback เป็น `token=`/ไม่มีเมื่อ diffusers เวอร์ชันใหม่เปลี่ยนชื่อ kwarg · ไม่มี `use_auth_token=True` เดี่ยว ๆ อีก · error สุดท้ายบอกชัดว่าขาดแค่ config ไม่ใช่ weight · `LUKE_IMAGE_MODEL_CACHE` ย้ายโฟลเดอร์ได้ · `/health` ตอบ `reference_cache` ด้วย
- **worker ยังระบุรุ่นโมเดลได้แม้โฟลเดอร์ชื่อเป็น hash** — `serve.cjs` ส่ง `--model-version <สิ่งที่ผู้ใช้เลือก>` เพิ่ม และ `infer_model_version()` พับ `_`/ช่องว่างเป็น `-` ด้วย (ชื่อที่ cache สร้างคือ `<sha12>-Stable_Diffusion_v1-5` ซึ่งเดิมหาไม่เจอแล้ว fallback เป็น v1-5 = โหลด scheduler/tokenizer ผิดตัวกับโมเดล XL)
- **UI** (`PerformancePanel.jsx`) — รายการที่ต้องคัดลอกบอกชนิด (Text model / Image model) + อธิบายว่าโมเดลภาพได้ประโยชน์มากที่สุด · ส่ง `scope` ตามชนิด
- **เทสต์**: `scripts/validation/test-image-model-cache.cjs` (72 checks: fingerprint โฟลเดอร์, คัดลอก/ยืนยัน/คัดลอกใหม่เมื่อโมเดลเปลี่ยน, symlink, `cachedCopyFor` หาเจอทั้งสองดิสก์, asserts ว่า `--model` เป็น path ที่ resolve แล้ว, route ตอบ POST/ลิสต์โมเดลภาพ/ปฏิเสธ path outside folder) + `scripts/validation/helpers/coreml-reference-cache-probe.py` (17 checks บนตัว `coreml_server.py` จริงโดย stub torch/numpy/diffusers — พิสูจน์**ลำดับ**การเรียก คือมีสำเนาแล้วไม่แตะเน็ต) · suite นี้ skip ตัวเองถ้าเครื่องไม่มี python3
- **`validate-release.sh`** — เพิ่ม `py_compile` ให้ `coreml_server.py` และ probe · เดิมไม่มีอะไรคอมไพล์ worker ตัวนี้เลย ทั้งที่เป็นไฟล์เดียวที่รันเฉพาะบน Apple Silicon
- **รันแล้วบน Linux:** ชุดใหม่ 72 passed / 0 failed · `test-llm-performance` 56/0 · `test-api-route-methods` PASS · `test-api-cors-policy` / `test-frontend-bundle-budgets` / `test-static-file-containment` / `test-frontend-dist-freshness` / `test-runtime-state-not-in-git` PASS หลัง build frontend · `run-all` ทั้งชุด **148 passed / 1 failed / 1 skipped** — ตัวที่ fail เดียวคือ `validate-release.sh` ที่หยุดเพราะไม่มี `imageio_ffmpeg` บนเครื่อง (CI ติดตั้งให้ → บน CI ทุก step ✓) และ skip เดียวคือ suite Python ที่ต้อง flag `--include-python` ·ชุดเทสต์นี้รันบน Linux ยังไม่ได้รันบน macOS
- **ยังไม่ได้ยืนยันบน Mac (เช็กลิสต์อยู่หัวข้อ 7.6):** โหลด Core ML จริงจากสำเนาดิสก์ภายใน · สำเนาโฟลเดอร์ Core ML ขนาดจริง · เริ่มงานแบบ offline ไม่มีเน็ต

### PR #30 (session `arena/01a0f582…`, 2026-10-01 — merged แล้ว) — ป้ายรายการ + ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้" + โพสต์ Facebook 2 รูป (ภาพ AI + รูปสินค้า 500px) + ขนาดภาพ 1024×600
> สร้างใหม่ทั้งชุด: session ก่อนทำงานชุดนี้ไว้แล้วแต่**ไม่เคย push** → หายทั้งชุด (ดูท้ายหัวข้อ 7) — สเปกมาจากการคุยกับเจ้าของงานใหม่ทั้งหมดใน session นี้
- **ป้ายรายการ (tags)** — `entry.tags` เก็บถาวรใน runtime-state · ผ่าน `PATCH /api/social-agency/calendar/:entryId` ฟิลด์ `tags` (แทนที่ทั้งชุด) · `_normalizeTags`: trim/ยุบช่องว่าง/dedupe ไม่สนตัวพิมพ์ ≤ **8 ป้าย/รายการ × ≤24 ตัวอักษร** (ไทยได้) ผิดกฎ throw ทันที · `listCalendar` ค้นหา `q` เจอจากป้าย · UI: แถว "ป้าย" ในหน้าโพสต์ (ชิปกด × เอาออก + พิมพ์เพิ่ม + เสนอป้ายที่เคยใช้ในลูกค้าเดียวกัน 6 อัน) + ชิปป้ายเล็กบนการ์ดปฏิทิน (3 อัน เกินขึ้น `+N`) + ตัวกรอง "ป้าย" บนแถบฟิลเตอร์
- **ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้"** — `POST /api/social-agency/entry-image/reject` · จด fingerprint ลง `entry.imageRejections[]` (เก็บ 20 รายการล่าสุด) + **ล้าง `imageReview` ทันที** + ด่านตรวจเป็นสถานะ `rejected` → ส่งจริงไม่ได้เด็ดขาด (dry-run ใช้ได้) · **สร้างภาพใหม่อัตโนมัติ** หลังปฏิเสธ (ส่ง `regenerate:false` เพื่อปิด) · ภาพใหม่ที่ไบต์ตรงกับรูปที่เคยปฏิเสธ → ด่านตรวจคืนสถานะ `rejected` เอง · แม้กด "ตรวจภาพแล้ว" ทับก็ไม่ปลดล็อก (เช็ก fingerprint ก่อนผลตรวจเสมอ) · ปุ่มแดงอยู่ในด่านตรวจภาพทั้งหน้าโพสต์ และ `RunsTab` แสดงเหตุผลตามเดิม
- **โพสต์ Facebook 2 รูป (ตามที่เจ้าของงานเลือก)** — [1] ภาพ AI สร้างตามปกติ (settings img2img/denoise เดิม) [2] **รูปสินค้าจริงแบบไม่แก้ไขอะไร ยกเว้นย่อด้านยาวสุดให้เท่ากับ 500px คงสัดส่วน** (รูปเล็กกว่า 500px อยู่แล้วใช้ต้นฉบับ) · วิธีย่อ: `ensureProductRef500()` ใน `lib.js` ใช้ canvas ของเบราว์เซอร์ (JPEG q0.92) แล้ว `POST /api/social-agency/products/ref-image-500` แคชเป็น `app/outputs/sa-products/<client>/<sku>.ref500.jpg` — **เซิร์ฟเวอร์ไม่มี dependency ใหม่** · endpoint นี้มี GET เช็กสถานะด้วย · ทริกเกอร์: เปิดหน้าโพสต์ 1 ครั้งก็สร้างให้เงียบๆ · ส่งจริง: อัปโหลด 2 รูปแบบ `published=false` (ภาพ AI ก่อน) แล้ว `POST /{pageId}/feed` + `attached_media` ลำดับเดียวกัน · ไม่มีรูป/ปิดตั้งค่า → โพสต์รูปเดียวเหมือนเดิม · อัปโหลดรูปที่ 2 พลาด → โพสต์เฉพาะภาพ AI + note ในผลรัน · ยังไม่มี `ref500` → แนบต้นฉบับ + note บอกวิธีให้ระบบสร้าง · ผลรันมี `mediaKind: "multi-photo"` + `attachedProductRef`
- **ขนาดภาพปฏิทินตั้งได้รายลูกค้า** — `settings.imageWidth/imageHeight` (default **1024×600** แบนเนอร์ ปัดทวี 8 ช่วง 256–1536) ผ่านหน้า Connectors · ใช้ทั้ง txt2img (`size`) และ img2img (`width`/`height`) · `imageJob` บันทึก `width`/`height` · Generator ไม่กระทบ (ค่า global เดิม)
- เทสต์ใหม่ 3 ชุด: `test-social-agency-entry-tags.cjs` (11) · `test-social-agency-image-reject.cjs` (10) · `test-social-agency-fb-ref-multi-photo.cjs` (9) — mock ทั้งหมด รวม Graph API (อัปโหลดลำดับ/`attached_media`/fallback/ปิดตั้งค่า) · run-all **147 passed · 0 failed**
- **ยังไม่ได้ยืนยันบน Mac:** โพสต์ 2 รูปจริงบนเพจจริง · คุณภาพภาพ 1024×600 จาก backend จริง · ป้าย/ปุ่มปฏิเสธในงานจริง (เช็กลิสต์ท้ายหัวข้อ 6)

### PR #29 (session `arena/01a0f086…`, 2026-09-30 — merged เป็น `a86fb7c`, CI เขียว) — docs: บันทึกว่า PR #28 merged เป็น 66863bf ไม่มี PR ค้าง
> ต่อจาก PR #26 โดยตรง: หลังเปลี่ยนมาใช้ img2img ที่ denoise 0.38 แล้ว "สินค้าตรงขึ้น แต่ prompt แทบไม่มีผล" เพราะ backend ตัดตารางตาม denoise
- **ต้นเหตุ (ยืนยันจากซอร์สของ backend):** `stable-diffusion.cpp` ทำ img2img แบบ sd-webui — `src/pipeline/image.cpp` `prepare_image_generation_latents()`: `t_enc = (size_t)(plan->sample_steps * strength)` แล้วตัด sigma ตามนั้น → คำขอ 20 สเต็ปที่ denoise 0.38 รันจริง 7 สเต็ป · upstream แก้ปัญหาเดียวกันกับ hires fix ด้วยการหารกลับ (`src/pipeline/request.cpp`: `scheduler_steps = effective_steps / hires.denoising_strength`)
- `scripts/server/img2img-steps.cjs` — **กฎกลางไฟล์เดียว** (frontend import ไฟล์เดียวกับที่ server `require`): `ceil(steps/denoise)` แล้วขยับขึ้นจน `floor(sent × strength) ≥ steps`, เพดาน `MAX_IMG2IMG_SENT_STEPS = 150` + ธง `capped`, ค่าขยะ → ค่าเริ่มต้น (ไม่เป็น NaN), denoise = 1 ไม่แตะ
- `social-agency-runtime.cjs` — `_img2imgStepPlan()` + `_imageImg2ImgBody(..., stepPlan)` ส่ง `steps: plan.sent` และเก็บ `steps` / `stepsSent` / `stepsCapped` ลง `imageJob` (โหมด `reference` และเส้นทาง txt2img **ไม่สเกล**)
- `app/frontend/src/services/api.js` — `planImageSteps()` (export) ใช้กฎเดียวกัน: denoise window เดิม **0.15–0.75** ไม่ขยับ, txt2img ส่งจำนวนเดิม, `generateImage` คืน `steps` / `stepsSent` / `stepsCapped`
- `Generator.jsx` — ประมาณเวลา + ตัวนับสเต็ปตามจำนวนที่รันจริง (`activeTotalSteps` จาก progress ของ backend), บรรทัดบอกตอนสเกล/แตะเพดาน, `metadata.stepsSent`
- `social-agency/drawers.jsx` — `steps 20→53` ในหน้ารายการ + คำอธิบายใต้สไลเดอร์ (รวมต้นทุนเวลา ~1/denoise)
- `vite.config.js` — `server.fs.allow = [REPO_ROOT]` เพื่อให้ dev server เสิร์ฟไฟล์ที่ใช้ร่วมกันได้ (build ผ่านปกติ; bundle ยังกิน budget 300 KB — 292,266 bytes)
- เทสต์ใหม่ `scripts/validation/test-image-img2img-step-scaling.cjs` (16 checks, mock ทั้งหมด): กฎ (กวาด 3,000+ กรณี) · Social Agency (รวม flux 4 สเต็ป → 11) · **Generator: import `api.js` จริงแล้วเรียก `generateImage` จริง** ตรวจ body ที่ส่ง
- `validate-release.sh` — `node --check scripts/server/img2img-steps.cjs` (ไฟล์ที่ถูก require ตอนโหลด)
- **ยังไม่ได้ยืนยัน:** คุณภาพ/เวลาจริงบน Mac (ดูเช็กลิสต์ท้ายข้อ 6) · พฤติกรรมของ sampler เมื่อสเกลสเต็ปขึ้น (คาดว่าได้ตารางละเอียดขึ้นตามแบบ sd-webui)

### PR #26 (session `arena/01a0eb60…`, 2026-09-29 — รอ merge) — รูปสินค้าอ้างอิงเข้า backend จริง + เตือนใน UI + แก้เช็กบ็อกซ์
> ต่อจาก PR #25 โดยตรง: อาการคือ backend รับ `reference_images` แล้วตอบ 200 แต่**ไม่ได้ใช้รูปอ้างอิง** (กระเป๋าออกมาเป็นเดรส) — แก้ที่ต้นเหตุด้วยวิธีเดียวกับที่ Generator ใช้อยู่แล้ว
- `scripts/server/social-agency-runtime.cjs` — การสร้างภาพปฏิทินส่ง **img2img** เป็นค่าเริ่มต้น (`POST /sdapi/v1/img2img`, `init_images:[<รูปสินค้า>]`, `denoising_strength` 0.38) ให้เหมือน `app/frontend/src/services/api.js` ของ Generator
  - `settings.productRefMode` = `img2img` (เริ่มต้น) หรือ `reference` (วิธีเดิมที่ส่ง `reference_images`) · `settings.productRefDenoise` 0.15–0.75 (ค่าเริ่มต้น 0.38, `clampFloat` ไม่ปัดเป็นจำนวนเต็ม) · บันทึกผ่าน `saveConnectors`
  - ถ้า backend ไม่มี img2img (404/405/501 หรือ 400/422 ที่ error เอ่ยถึง `init_images`/`denoising_strength`) → ถอยไปใช้ `/v1/images/generations` แบบเดิม **และใส่ `imageJob.warning`** · 400 อื่นๆ ถือเป็น error จริง ไม่ retry
  - `entry.imageJob` เพิ่ม `refMode` (`img2img` | `reference` | `none` | `off`), `denoise`, คง `usedProductRef` และ `warning: "ไม่ได้ใช้รูปสินค้าอ้างอิง: …"` ไว้ให้ grep ได้เหมือนเดิม
  - `setImageBackendProvider(fn)` — อ่านพอร์ต Image API สดๆ จาก `PORT_BACKEND` ของ serve.cjs (พอร์ตขยับได้เมื่อ 8080 ไม่ว่าง หรือผู้ใช้ตั้ง `backendPort`)
- `scripts/server/serve.cjs` — ต่อ `setImageBackendProvider(() => "http://127.0.0.1:" + PORT_BACKEND)`
- Frontend: `lib.js` (`productRefNotice` + `PRODUCT_REF_MODE_LABEL`) · `drawers.jsx` (`ImageRefLine`, คำเตือนในด่านตรวจภาพ, ตัวเลือกโหมด + สไลเดอร์ denoise ใน Connectors) · `RunsTab.jsx` (เตือนในคิวอนุมัติ) · `social-agency.css`
- **สาเหตุของเช็กบ็อกซ์สี่เหลี่ยมขาว:** `.sa-shell input { width:100%; min-height:36px; background: card }` กินเช็กบ็อกซ์ด้วย → ใส่ `:not([type="checkbox"]):not([type="radio"])` ที่กฎเดิม + กฎขนาดเช็กบ็อกซ์ 15px และจัด `.sa-image-gate-confirm` เป็น grid `auto 1fr`
- เทสต์ใหม่ 2 ชุด: `test-social-agency-product-ref-img2img.cjs` (11 checks — mock fetch ทั้งหมด) · `test-social-agency-image-gate-ui.cjs` (10 checks) · `run-all` = **143 passed · 0 failed · 1 skipped**
- **ยังไม่ได้ยืนยัน:** คุณภาพ/img2img กับ backend จริงบนเครื่อง Mac (ต้อง `npx vite build` ใหม่หลัง pull) · ภาพเดรสเดิมของ WSB-019 ต้องสร้างใหม่แล้วตรวจเทียบรูปสินค้าก่อนอนุมัติ

### (session `arena/01a0eb2c…`, 2026-09-29) — ด่านตรวจภาพแยกจากการอนุมัติแคปชัน
> เขียนใหม่บน `main` ล่าสุด: แพตช์เดิมที่ทำบน Mac (ผลทดสอบ 104 checks) **ไม่เคยถูก push และกู้คืนไม่ได้** (`/Volumes/AI` สะอาด, `~/Desktop/Local AI` เป็นสำเนาเก่า) — อย่าเอาสำเนา `Local AI` มา commit/push เพราะมีการลบไฟล์ staged ค้างอยู่
- `scripts/server/social-agency-runtime.cjs` — ภาพที่แนบกับรายการต้องมีการ "ตรวจภาพ" โดยคนก่อนส่งจริงไป Facebook / Instagram / LINE OA broadcast (TikTok/demo ไม่เกี่ยว)
  - การอนุมัติผูกกับ fingerprint = sha256(ไบต์ไฟล์ภาพ + Public URL) + SKU · ไฟล์/URL/สินค้าเปลี่ยน → บล็อกอีกครั้ง · กำลังสร้างภาพทดแทน (`imageJob.running`) → บล็อก · สร้างภาพเสร็จใหม่ → ล้างผลตรวจ
  - `POST /api/social-agency/entry-image/review` `{entryId, confirmed:true}` (หรือ `approve:false` เพื่อยกเลิก) — **ไม่เริ่ม workflow ไม่เผยแพร่ ไม่แตะ status**
  - บังคับ 2 ชั้น: `_executeWorkflow` (8b — ส่งเข้า `needs_review` พร้อมเหตุผล ไม่ใช่ failed แม้กดอนุมัติแบบ force) และ `_publishEntry` (`_assertImageReviewed` ก่อนยิง API จริง) · dry-run ไม่โดนบล็อก
  - `_publishLiveState()` แยกตรรกะ "จะส่งจริงไหม" ให้ `_publishEntry` กับ workflow ใช้ตัวเดียวกัน
  - `entry.imageGate` เป็นฟิลด์ตอบกลับเท่านั้น (`getState`/`listCalendar`) ไม่ถูกเก็บลงไฟล์
  - พาธรูปสินค้า: `_resolveProductImageFile` ยอมเฉพาะ `app/outputs/sa-products/<clientId>/<sku>.<png|jpg|jpeg|webp|gif>` (กัน `..`, ลูกค้า/SKU อื่น, symlink) · `_applyProductImage` ปฏิเสธพาธ `/sa-products/` ที่ไม่ตรง · ถ้ารูปอ้างอิงถูกปฏิเสธ การสร้างภาพเดินต่อโดยไม่มี ref และใส่ `imageJob.warning`
- Frontend: `drawers.jsx` (`ImageReviewGate` — ติ๊กยืนยัน + ปุ่ม "ตรวจภาพแล้ว"), `RunsTab.jsx` (แจ้งเตือนในคิวอนุมัติ), `SocialAgency.jsx`, `social-agency.css`
- เทสต์: `scripts/validation/test-social-agency-image-review-gate.cjs` (19 checks, mock ทั้งหมด) · Social Agency smoke ยัง 104 checks · `run-all` 140 passed (ที่ล้ม 1 = `validate-release.sh` ต้องมี `imageio_ffmpeg` ซึ่งเครื่อง sandbox ไม่มี — CI ติดตั้งให้)
- **ยังไม่ได้ทำ/ยังไม่ยืนยัน:** คุณภาพภาพจาก backend จริงบน Mac · การส่งไปบัญชี Facebook/IG/LINE จริง · ภาพเดรสเดิมของ WSB-019 **อย่าอนุมัติ** — สร้างใหม่แล้วตรวจเทียบรูปสินค้าจริงก่อน

### PR #21 (2026-09-27) — ปิดงานค้างหัวข้อ 6 (baseline ว่าง · 140 passed / 0 failed)
- `app/frontend/src/lib/safe-link.mjs` — รับ `data:image/<raster>;base64,…` เฉพาะภาพที่แอปสร้างเอง (SVG และ `data:text/html` ยังถูกปฏิเสธ) · คุม `href` 2 จุดที่หลุด guard ใน `WorkflowBuilder.jsx` และ `ProductsTab.jsx`
- `scripts/server/work-github.cjs` — โวลุ่มที่เก็บ permission ไม่ได้ คืน `warning` ให้ผู้ใช้เห็น แทนที่จะกลืนความล้มเหลวของ `chmod` ใน `catch {}`
- `scripts/cloud-doctor.cjs` — ถามโวลุ่มก่อนว่าเก็บ file permission ได้ไหม แทนที่จะกล่าวหาไฟล์ที่ผู้ใช้แก้ไม่ได้
- `sync.sh` — `sed -z` เป็นส่วนเสริมของ GNU ที่ BSD sed (macOS) ไม่มี ทำให้ลูป "เอาของผู้ใช้คืน" ไม่เคยรัน และ `releases/` ถูกลบโดยที่สคริปต์ยังรายงานว่าสำเร็จ
- `scripts/validation/validate-release.sh` — `find` เดินขึ้นราก volume ไปโดน `.Trashes`/`.Spotlight-V100` บน macOS (คู่กับ `set -e` ทำให้ contract จบทันที) · แยก portable runtime ของเครื่องทำงานออกจากของที่แพ็ก
- `scripts/validation/check-api-contracts.cjs` — กลุ่ม optional ใน route regex ไม่ถูกแยกออก จึงไม่ match ทั้งรูปไม่มีส่วนและรูปมีส่วน
- `.github/workflows/validation.yml` — ติดตั้ง `imageio-ffmpeg` ซึ่ง release contract ต้องใช้
- เทสต์ 11 ชุดที่วัด **สภาพเครื่อง** แทน **ตัวโค้ด** แก้ที่ต้นเหตุทั้งหมด
- `scripts/validation/test-sync-script.cjs` + `test-releases-untracked.cjs` — ทั้งคู่อ่านชื่อ branch ของ checkout ที่ตัวเองกำลังรันอยู่ ไปสั่ง `git clone --branch` ของ fixture · ตอนนี้ให้ fixture ตั้งชื่อ branch เอง
- `scripts/validation/ci-baseline.json` — **ว่างแล้ว 0 รายการ**
- ผลวัด: เครื่องจริง (macOS) **140 passed · 0 failed · 1 skipped** · sandbox (Linux) **140 passed · 0 failed · 1 skipped** → `exit 0` ทั้งคู่

### PR #20 (2026-09-27) — CI + ตัวรันชุดเทสต์ (merged เป็น `b3fb3f8`)
- `.github/workflows/validation.yml` — รัน `scripts/validation/` ทุก PR ทุก push เข้า `main` และกดรันเองได้ (ubuntu-latest, Node 22, build frontend ก่อน)
- `run-all.cjs` + `ci-baseline.json` — รันทั้งชุด สรุปผล เขียนรายงาน · รายการที่ล้มอยู่แล้วถูกบันทึกเป็น XFAIL พร้อมเหตุผล (บางรายการ scope เฉพาะ `darwin` = ล้มได้บน macOS เท่านั้น ที่อื่นต้องผ่าน)
- แก้ `serve.cjs` — ที่ยังไม่ได้ดาวน์โหลดโมเดล speech/TTS ตอบ **503** แทน 500 (CI รอบแรกเจอ แก้ใน PR นี้เลย)
- ผลวัด: Linux CI **133 passed · 0 failed · 7 known-failing · 1 skipped** · เครื่องจริง (macOS) **129 passed · 0 failed · 10 known-failing · 1 xpassed · 1 skipped** → `exit 0` ทั้งคู่

### PR #12 (2026-09-27) — เก็บกวาด repo
- ลบไฟล์สำรองจากการ patch ที่หลุดเข้า git 13 ไฟล์ (~1.3 MB) + เพิ่ม `.gitignore` กันซ้ำ (ดูข้อ 6.1)
- ลบ branch เก่าบน GitHub ทั้งหมด เหลือแค่ `main` (ดูข้อ 4)
- อัปเดตไฟล์นี้ทุกหัวข้อ (ดูข้อ 6.3)
- ไม่มีการเปลี่ยนโค้ด product — `node --check` ผ่าน, smoke test ผ่าน 99 checks

### PR #11 (2026-09-26) — เอกสาร
- เพิ่มไฟล์นี้ (`ARENA_HANDOFF.md`) เข้า `main` — session ถัดไปอ่านไฟล์นี้ก่อนเริ่มงาน

### PR #10 (2026-09-26) — ฟีเจอร์

1. **Luke AI Workflow builder** (workspace ใหม่) — ต่อ AI หลายขั้นเป็นสายงานเดียว
   Chat (LLM) → สร้างภาพ → TTS → STT → จัดข้อความ → เงื่อนไข → ผลลัพธ์, ตัวแปร `{{input}}` / `{{ชื่อโหนด}}`
   Backend: `scripts/server/ai-workflow-runtime.cjs` (`/api/ai-workflow/*`)
2. **รูปสินค้าจากเว็บตาม SKU → ใช้เป็น Reference ตอนสร้างภาพปฏิทิน**
   - ปุ่ม "ดึงรูปสินค้าจากเว็บ" (ทั้งชุด/รายตัว) ดึง og:image / JSON-LD / รูปใหญ่สุด แล้วเก็บในเครื่อง
   - ปุ่ม "🎲 สุ่ม 1 สินค้า/วัน" ดึงรูปมาพร้อมสินค้าอัตโนมัติ
   - รูปสินค้าถูกแนบเป็น Reference (Appearance Lock) ตอนสร้างภาพโพสต์ — เปิด/ปิดได้ใน Settings ของลูกค้า
   - รูป demo 10 รูปฝังใน `app/config/social-agency-seeds/`
3. **Social Agency › Workflow tab** — โหนด "คะแนนไวรัล", ปุ่มรันเลย/อนุมัติ/ยกเลิก, ตัวกรองประวัติ, progress bar, export รายงาน

PR ก่อนหน้า (merge แล้วทั้งหมด): #4 Social Agency v2.3 · #5 release beta.16 · #6 validation 87/87 · #7 fix live publish · #8 Thai prompt auto-translate · #9 English-native imagePrompt · #2,#3 (Social Agency v2.2 + repo audit)

---

## 3. ⚠️ หลัง `git pull main` บนเครื่องจริง ต้อง build frontend ใหม่เสมอ

`app/dist/` **ไม่อยู่ใน git** — ถ้าไม่ build จะเห็น UI เวอร์ชันเก่า

```bash
git checkout main && git pull
bash validate.sh      # ติดตั้ง dependency (ถ้ายังไม่มี) + build UI + รันชุดทดสอบทั้งหมด
./start.sh            # เลือก mac.sh / linux.sh ให้เอง (บน Windows ใช้ windows.bat)
```

ถ้าอยากทำมือแบบเดิม: `cd app/frontend && npm install && npx vite build` แล้วรัน `mac.sh` / `linux.sh` / `windows.bat`

---

## 4. สถานะ branch อื่นบน GitHub (ตรวจและลบแล้ว 2026-09-27)

**หลัง session 2026-09-27 เหลือแค่ `main`** — branch เก่าทั้งหมดถูกลบไปแล้ว (เหลือแค่ branch ของ session ที่กำลังทำงานซึ่งจะ merge แล้วลบท้าย session) ตารางด้านล่างเก็บไว้เป็นบันทึกว่าลบอะไรไปบ้าง

| branch | สถานะก่อนลบ | ผลการตรวจ |
|---|---|---|
| `arena/01a03c94…`, `01a065e2…`, `01a08988…`, `01a08f7a…`, `01a09e4b…`, `01a0de84…`, `01a0df14…` | merge เข้า `main` ครบแล้ว | ยืนยันด้วย GitHub compare API: `ahead_by = 0` ทุก branch → ลบได้เลย ✅ ลบแล้ว |
| `backup/volumes-ai-20260914` | WIP จากเครื่อง local 14 ก.ย. (งาน image-to-video สำหรับโพสต์ Social Agency: `videoJob`, `setImageToVideoJobs`, progress bar) | ตรวจซ้ำแล้ว: commit เดียวที่ไม่ซ้ำกับ `main` (`3328d4f7`) มี 54 ไฟล์ แต่เป็น `app/dist/` + runtime state ที่ gitignore แล้วเกือบทั้งหมด เหลือโค้ดจริง 9 ไฟล์ — ไล่เทียบบรรทัดที่เพิ่มกับ `main` ทีละบรรทัดแล้ว **พบครบ ยกเว้น 6 บรรทัด ซึ่ง `main` พัฒนาต่อแล้ว** (`_imageGenBody(prompt, ref)` รองรับรูปสินค้าอ้างอิง, `reference_images`/`reference_settings`/`negative_prompt` เป็นแบบมี ref, `EntryDrawer` มี props เพิ่ม, `entryPatch` เพิ่ม `captionSource`/`hook`) → **ห้าม merge** แต่ลบได้ ✅ ลบแล้ว |

> ข้อมูลเดียวที่หายไปกับ branch นั้น: ค่า settings ของโมเดล `typhoon-1.5-8b-Q4_K_M.gguf` (Metal, threads 9, ctx 16384) ใน `app/config/llm-model-settings.json` ซึ่งเป็นค่าที่ตั้งบนเครื่อง local เอง — ถ้าเคยใช้โมเดลนี้ให้ตั้งค่าใหม่ในแอปได้

---

## 5. แผนที่โค้ดสำคัญ

| ส่วน | ตำแหน่ง |
|---|---|
| Frontend (Vite + React) | `app/frontend/src/` — Social Agency: `components/SocialAgency.jsx` + `social-agency/` |
| Server entry | `scripts/server/serve.cjs` |
| Social Agency runtime | `scripts/server/social-agency-runtime.cjs` (+ `social-agency-groups-smoke.cjs` สำหรับ smoke test) |
| AI Workflow runtime | `scripts/server/ai-workflow-runtime.cjs` |
| Image-to-video | `scripts/server/image-to-video-*.cjs` |
| Config / seed | `app/config/` |
| รายงาน validation / release | `validation-reports/`, `RELEASE-AUDIT.md`, `AI-LIBRARY-CHANGELOG.md` |

---

## 6. งานค้าง / สิ่งที่ควรทำต่อ

_(งานเก็บกวาด repo ข้อ 6.1–6.3 เสร็จแล้ว · ต่อมาเพิ่ม CI + ตัวรันชุดเทสต์ใน session เดียวกัน)_

**เสร็จแล้ว (session `arena/01a0e089…`, 2026-09-27):**
- [x] **6.1 ลบไฟล์สำรองจากการ patch ที่หลุดเข้า git** — ลบ 13 ไฟล์ (`*.p5w-orig` 6, `*.p5w2-orig` 2, `*.p5y-orig` 1, `*.p5z-orig` 1, `*.p5x-orig` 1) ใน `app/frontend/src/…` และ `scripts/server/…` รวมถึง `p5w-audit.txt`, `p5w-dump.txt` ที่ root
  - เพิ่มกฎกันซ้ำใน `.gitignore`: `*.p5*-orig`, `p5w-*.txt` (ของเดิมมีแค่ `*.orig` ซึ่งจับไฟล์พวกนี้ไม่ได้)
  - ตรวจแล้วว่าไม่มีไฟล์ไหน import ไฟล์เหล่านี้ · `node --check` ผ่าน · smoke test ผ่าน 99 checks
- [x] **6.2 ลบ branch เก่า** — ลบ arena branch ที่ merge แล้ว 7 ตัว + `backup/volumes-ai-20260914` (ตรวจโค้ดซ้ำก่อนลบ ดูตารางข้อ 4) เหลือแค่ `main`
- [x] **6.3 อัปเดตไฟล์นี้** — แก้ข้อ 1 (main), ข้อ 2 (เพิ่ม PR #11/#12), ข้อ 4 (บันทึกการลบ branch), ข้อ 6 (ติ๊กรายการ) — merge เข้า `main` แล้ว (PR #12)

**เสร็จแล้วเพิ่ม (session `arena/01a0e089…`, ต่อจากข้อ 6.3):**
- [x] **ตั้ง CI ให้รัน `scripts/validation/` ทุก PR** — `.github/workflows/validation.yml` + ตัวรัน `run-all.cjs` (ดูหัวข้อ 2)
- [x] **แยก known-failing ตามแพลตฟอร์ม** — `ci-baseline.json` รับได้แบบ `{reason, platforms}` · รายการที่ scope เป็น `darwin` ถูกเมินบนแพลตฟอร์มอื่น **และต้องผ่านจริง** ไม่ใช่ถูกบดบัง (มี 4 รายการ — เหตุผลอยู่ในไฟล์นั้น)
- [x] **ให้บรรทัดสรุปนับ xpassed ด้วย** — ก่อนหน้านี้ยอดรวมไม่ตรงกับผลจริงเพราะไม่นับชุดที่ผ่านทั้งที่ถูกบันทึกว่าล้ม
- [x] **แก้บั๊ก 503 ที่ CI เจอ** — `POST /api/speech/start` ตอบ 500 เมื่อยังไม่ได้ดาวน์โหลดโมเดล เพราะ `resolveSpeechModel()` โยน `Error` ที่ไม่มี `statusCode` (CI ติดตั้ง whisper.cpp ได้จึงเดินถึงจุดนั้น) · เปลี่ยนเป็น `serviceUnavailable()` → 503 แก้จุดเดียวกันใน `resolveTtsModel()` ด้วย

**ปิดครบแล้ว (PR #21, 2026-09-27) — `ci-baseline.json` ว่างแล้ว 0 รายการ**

ทั้ง 11 รายการแก้ที่ต้นเหตุแล้ว **ลบรายการออกจาก baseline ทั้งหมด** · ผลวัด 140 passed · 0 failed · 1 skipped ทั้ง macOS และ Linux

| ชุด / ไฟล์ | ประเภท | ต้นเหตุที่แก้ |
|---|---|---|
| `test-frontend-link-safety.cjs` | โค้ด | `safe-link.mjs` ปฏิเสธ `data:` ทั้งหมด แต่ workflow builder ส่ง `data:image/png;base64,…` มาเป็นลิงก์ — เพิ่ม raster base64 เท่านั้น และให้ทั้ง 2 จุดเรนเดอร์ลิงก์เมื่อ guard อนุมัติ |
| `validate-release.sh` | โค้ด | `check-api-contracts.cjs` อ่าน route แบบ regex ได้อยู่แล้ว แต่กลุ่ม optional ไม่ถูกแยก จึงไม่ match ทั้งสองรูป |
| `test-config-write-fixed-point.cjs` | โค้ด | เทสต์ยืม install record จาก `app/runtimes/` ของเครื่อง (ไม่มีใน clone สะอาด) และ copy `app/config` จาก working tree ซึ่งเป็นไฟล์ที่แอปเขียนทับ — เปลี่ยนเป็นเขียน record เอง และอ่าน config จาก git |
| `test-route-declarations.cjs` | เทสต์ | ~~cache-control helper~~ **คำอธิบายเดิมผิด** — ตัวจริงคือ `/sa-products/` static route จริงที่รายชื่อ namespace ในเทสต์แคบเกิน |
| `test-sync-script.cjs` | เทสต์ | scenario ผูกกับ branch ที่ checkout อยู่ — ให้ชุดเทสต์สร้างข้อตั้งต้นของตัวเอง ผลเหมือนกันทุกเครื่อง |
| `test-mac-launch-files-tracked.cjs` | สภาพแวดล้อม | `app/dist/` ถูก gitignore ไปแล้ว สมมติฐานว่ามันต้องมากับ git ล้าสมัย — เปลี่ยนเป็นเช็คว่า dist ที่มีอยู่ครบทุก bundle ที่ `index.html` อ้าง |
| `test-releases-untracked.cjs` | สภาพแวดล้อม | เช็คว่ามีโฟลเดอร์ `releases/` บนดิสก์ ซึ่ง clone สะอาดไม่มี — เปลี่ยนเป็นรายงาน ส่วนที่พิสูจน์ว่าอัปเดตไม่ลบของผู้ใช้คือการรัน `sync.sh` จริงถัดไป |
| `test-llm-performance.cjs` | สภาพแวดล้อม | fixture อยู่ใน `os.tmpdir()` แต่ cache root อยู่บน `/Volumes/AI` → คำถาม "ดิสก์เดียวกัน" กลายเป็น "คนละดิสก์" — สร้างทั้งสองกรณีขึ้นมาเอง |
| `test-api-route-methods.cjs` | สภาพแวดล้อม | teardown `rmSync` โดน ENOTEMPTY บน macOS เพราะ server ยังเขียนทับขณะลบ — retry และไม่ throw ใน `finally` (eslint จับ `no-unsafe-finally`) |
| `test-work-github.cjs` | สภาพแวดล้อม | ตรวจว่าไฟล์ token เป็น 0600 ซึ่งโวลุ่ม external เก็บ permission ไม่ได้ — ตอนนี้เช็คว่าโค้ด **บอก** แทนที่จะเงียบ คู่กับการแก้ `work-github.cjs` ให้คืน `warning` |
| `test-cloud-doctor.cjs` | สภาพแวดล้อม | "healthy chain" ออก 1 โดยไม่บอกสาเหตุ — ใส่ stdout/stderr ในข้อความ และเพิ่มเคสโวลุ่มที่เก็บ permission ไม่ได้ (พิสูจน์ด้วยโฟลเดอร์ที่เขียนไม่ได้จริง) |

**บั๊ก macOS ที่เจอระหว่างทาง — ไม่ได้อยู่ในรายการเดิม (แก้แล้วในรอบนี้):**
- **`sync.sh` ใช้ `sed -z`** ซึ่งเป็นส่วนเสริมของ GNU · BSD sed บน macOS ไม่มี → ลูป "เอาของผู้ใช้คืน" ไม่เคยรัน และ `releases/` ของผู้ใช้ถูกลบตอน sync โดยที่สคริปต์ยังออก 0 และรายงานว่าสำเร็จ · **กู้คืนแล้ว** ด้วย `git archive 761082b^ releases | tar -x -C .` (ไม่แตะ index เพราะ `releases/` ถูก gitignore)
- **`validate-release.sh` เดิน `find "$ROOT"`** ขึ้นถึงรากของ volume ซึ่งบน macOS มี `.Spotlight-V100` / `.TemporaryItems` / `.Trashes` ตอบ `Operation not permitted` · คู่กับ `set -e` ทำให้ release contract จบในวินาทีแรก

**ระบบที่สามที่จับได้ — CI (Linux บน GitHub):**
- `actions/checkout` เช็คเอาต์แบบ **detached HEAD** เสมอ จึงไม่มี branch ให้อ่าน · `test-releases-untracked.cjs` เอา `"HEAD"` ไปสั่ง `git clone --branch` → `fatal: Remote branch HEAD not found in upstream origin` · `test-sync-script.cjs` assert ว่า branch ต้องไม่เป็น `HEAD` → ล้มที่ assert นั้น · ทั้งสองชุดตอนนี้ตั้งชื่อ branch ให้ fixture เอง แล้ว `git checkout -B` สร้างมันหลัง clone
- ยืนยันด้วยการจำลองสภาพจริง: clone สะอาด + `git checkout --detach` แล้วรันสองชุด → ผ่านทั้งคู่ ส่วนก่อนแก้ล้มด้วยข้อความเดียวกับใน log CI

**ค้างของ session `arena/01a0fb7f…` (2026-10-02) — PR #32:**
- [x] PR #32 merged; prompt fix is on `main` (follow-up PR #33 translated Thai product names).
- [ ] **ยืนยัน image prompt บน Mac:** สร้างภาพปฏิทิน 1 ใบ → ดู image prompt ต้องไม่เป็น `"product (SKU)"` ถ้าสินค้ามีคำอังกฤษในชื่อหรือรายละเอียด · ถ้าสินค้าเป็นภาษาไทยล้วนทุกฟิลด์ ยังคงเป็น `"product"` (ข้อจำกัดของ SD ที่อ่านภาษาไทยไม่ได้) · **แนะนำ:** เพิ่มคำอธิบายสินค้าภาษาอังกฤษใน `category` หรือ `detail` เพื่อให้ prompt แม่นขึ้น

**ค้างของ session `arena/01a0f582…` (2026-10-01) — ทำบนเครื่อง Mac เท่านั้น (เช็กลิสต์ฟีเจอร์ใหม่):**
- [ ] **อัปเดต + build:** `cd /Volumes/AI && git pull && cd app/frontend && npm install && npx vite build` แล้วรัน server ตามปกติ (`mac.sh`)
- [ ] **ขนาดภาพใหม่:** สร้างภาพปฏิทินสินค้า **WLB-006** 1 ใบ → ภาพต้องออกขนาด **1024×600** (แบนเนอร์) · `imageJob.width/height` ในไฟล์สถานะต้องเป็น 1024/600 · ปรับค่าได้ใน Connectors › ขนาดภาพปฏิทิน
- [ ] **ป้าย (concept + pencil case):** หน้ารายการ (ปฏิทิน) ต้องมีชิปป้าย · เปิดหน้าโพสต์ → แถว "ป้าย" พิมพ์ `concept` แล้ว Enter แล้วพิมพ์ `pencil case` → ป้ายขึ้นบนการ์ดรายการทันที · ช่องค้นหาพิมพ์ `concept` ต้องเจอ · ตัวกรอง "ป้าย" ต้องมีให้เลือก
- [ ] **ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้":** ในด่านตรวจภาพกดปุ่มแดง → ระบบต้อง**สร้างภาพใหม่ให้อัตโนมัติ** + สถานะเป็น "รูปนี้ถูกปฏิเสธ" ระหว่างรอ · ภาพใหม่เสร็จ → ต้องตรวจภาพใหม่ก่อนส่งได้ (สถานะกลับ "ยังไม่ได้ตรวจ") · **สั่งส่งจริงตอนถูกปฏิเสธต้องถูกบล็อก**
- [x] **โพสต์ Facebook 2 รูป (handoff item D) — ยืนยันบน Mac จริงแล้ว (postId: 136018459777356_1751931016712575, mode: live, mediaKind: multi-photo, attachedProductRef: true):** เปิดหน้าโพสต์ของรายการ WLB-006 1 ครั้ง (หรืออัปโหลด/ดึงรูปในแท็บ สินค้า — ระบบจะสร้าง `WLB-006.ref500.jpg` ให้อัตโนมัติ) → รันตรวจความพร้อมก่อนโพสต์ด้วย `node scripts/verify-fb-post-readiness.cjs --sku WLB-006 --strict` (หรือเติม `--online` เพื่อเช็ก token กับ Meta) ให้ขึ้น `✅ พร้อมโพสต์ Facebook จริง 2 รูป` → ส่งจริงบนเพจ: โพสต์ต้องมี **2 รูป (ภาพ AI ก่อน → รูปสินค้า 500px หลัง)** แคปชัน/UTM เหมือนเดิม · ปิดตั้งค่าใน Connectors ("แนบรูปสินค้าจริง…") แล้วโพสต์ถัดไปต้องกลับเป็นรูปเดียว
- [ ] **grep สถานะ:** `grep -o '"tags": \[[^]]*\]\|"width": [0-9]*\|"height": [0-9]*\|"imageRejections": \[\]' /Volumes/AI/app/runtime-state/social-agency/<ลูกค้า>.json | tail` — หลังใช้ฟีเจอร์ต้องเห็น `"tags"`, `"width": 1024`, `"height": 600` และ `"imageRejections"` ตามที่ทำ

**ค้างของ session `arena/01a0eb60…` (2026-09-29) — ทำบนเครื่อง Mac เท่านั้น (ของเก่าที่ยังไม่ได้ยืนยัน):**
- [ ] **ยืนยัน img2img กับ backend จริง** — `git pull` → `cd app/frontend && npm install && npx vite build` → สร้างภาพปฏิทิน 1 ใบ แล้วตรวจว่า `imageJob.refMode` เป็น `img2img`, `imageJob.steps` = สเต็ปที่ตั้งไว้ และ `imageJob.stepsSent` ≈ steps/denoise (ค่าเริ่มต้น 20 @ 0.38 → 53) · ภาพออกมาตรงกับรูปสินค้าจริง · **เวลาต้องนานขึ้น ~2.6 เท่า** ถ้าไม่นานขึ้นเลยให้สงสัยว่า backend ไม่ได้ใช้ `steps` ที่ส่งไป (ถ้า backend รุ่นนั้นไม่มี `/sdapi/v1/img2img` จะเห็นคำเตือน "ไม่ได้ใช้รูปสินค้าอ้างอิง: backend ไม่รองรับ img2img" ในหน้ารายการ/คิวอนุมัติ ซึ่งแปลว่าต้องอัปเดต backend)
- [ ] **ภาพเดรสของ WSB-019** ที่สร้างตอน backend ไม่ใช้รูปอ้างอิง — กด "สร้างภาพใหม่" แล้วตรวจเทียบรูปสินค้าจริงก่อนอนุมัติ อย่าอนุมัติภาพเดิม
- [ ] **ตรวจไฟล์สถานะด้วย grep** (ใช้ได้ทั้งก่อน/หลังสร้างภาพใหม่):
  `grep -o '"refMode": "[a-z]*"\|"usedProductRef": [a-z]*\|"denoise": [0-9.]*\|"steps": [0-9]*\|"stepsSent": [0-9]*\|"stepsCapped": true\|"warning": "[^"]*"' /Volumes/AI/app/runtime-state/social-agency/thai-modern-bags.json | tail`
  ก่อนสร้างใหม่รายการเก่าจะไม่มี `refMode` (ดูในแอปจะขึ้นเตือนให้ตรวจภาพเทียบสินค้าเอง) · หลังสร้างใหม่ต้องเป็น `"refMode": "img2img"` + `"usedProductRef": true` และไม่มี `warning` เมื่อรูปสินค้าอยู่ครบ

**ค้างของ session `arena/0b8f90ba…` — ปฏิทิน auto-plan กดซ้ำได้ + หลายงานต่อวัน (ทำบนเครื่อง Mac ที่ `/Volumes/AI` เท่านั้น):**
- [ ] **อัปเดต + build:** `git pull --ff-only` แล้ว `cd app/frontend && npm install && npx vite build` (`app/dist/` ไม่อยู่ใน git — ไม่ build แล้ว UI ไม่เปลี่ยน) เปิดแอปตามปกติ
- [ ] **หลายงานต่อวัน:** แท็บ ปฏิทิน → ปล่อยแพลตฟอร์มครบ 4 (f/IG/LINE/WEB) กด "วางแผนอัตโนมัติทั้งเดือน" → ตัวอย่างแผนต้องมี 4 ช่อง/วัน เวลาไม่ซ้ำกัน (ราว 10:00 / 12:30 / 15:00 / 18:30) ชิปขึ้นครบ 4 แพลตฟอร์มในวันเดียว · แต่ละวันใช้สินค้าเดียวกันทุกช่อง และสินค้าต่างวันไม่ซ้ำกันเท่าที่คลังพอ
- [ ] **วางแผนซ้ำในเดือนเดิม:** หลังใช้แผนเต็มเดือน ยกเลิกแพลตฟอร์มเหลือ Facebook แล้วกดใหม่ → ต้องไม่วางทับของเดิม · ลองลบชิปวันละ 2–3 ใบแล้วกดใหม่ → ระบบเติมเฉพาะช่องที่ลบ (ใช้สินค้าเดิมของวันนั้น)
- [ ] **แทนที่แผนเดิม:** ติ๊ก "แทนที่แผนเดิม" แล้วกดวางแผน → แผนใหม่แทนที่เฉพาะรายการ "วางแผนไว้" · รายการที่เผยแพร่แล้ว/กำลังรันต้องอยู่ครบเหมือนเดิมทุกใบ
- [ ] **รันหลายงานในวันเดียว:** กด "รันเลยตอนนี้" กับโพสต์ต่างแพลตฟอร์มในวันเดียวกัน → workflow ต้องรันได้ทีละหลายงานตามเวลา ไม่มีข้อความ "ช่องเวลานี้มีคอนเทนต์อยู่แล้ว" จากการวางแผน (ส่วนเพิ่มรายการเองที่เวลาเดียวกันยังถูกกันเหมือนเดิม)
- [ ] **เลือกแพลตฟอร์ม:** ติ๊กเฉพาะ LINE+เว็บ → แผนต้องมีแค่ 2 ช่อง/วัน · ปุ่มวางแผนปิดเมื่อไม่เลือกแพลตฟอร์มเลย · ป้ายแพลตฟอร์ม demo แสดง "WEB"/"เว็บ (Demo)"
- [ ] ตรวจยอด `run-all` บน Mac ด้วย (ควร 158 passed · 0 failed · 1 skipped เท่า sandbox — `validate-release.sh` ต้อง `import imageio_ffmpeg` ได้)

**ค้างของ session `arena/4552ca9e…` — ปฏิทินอยู่ในช่องวัน (ยืนยันบน Mac ที่ `/Volumes/AI`):**
- [ ] หลัง PR รอบนี้ merge: `cd /Volumes/AI && git pull --ff-only && bash validate.sh` แล้ว `./start.sh` — ต้อง build ใหม่ เพราะ `app/dist/` ไม่อยู่ใน git (การดู layout ไม่ต้องโหลดโมเดล)
- [ ] เปิดปฏิทินที่มี Facebook/IG/LINE/WEB ในวันเดียวกัน: ต้องเห็น 4 การ์ดอยู่ในกรอบวันของตัวเอง, จำนวน `4 โพสต์`, เวลาเดิม และไม่มีการ์ดล้นทับแถวสัปดาห์ถัดไป
- [ ] วันที่มีมากกว่า 4 โพสต์: เห็น `↕ N โพสต์` · เลื่อนในช่องนั้นจนถึงรายการท้ายสุดได้ และแถวสัปดาห์ถัดไปไม่ขยับ/ถูกทับ · ลองโฟกัสรายการแล้วกด End/ลูกศรด้วย
- [ ] ย่อหน้าต่าง: เลื่อนปฏิทินแนวนอนได้ หัว จ–อา ตรงคอลัมน์เสมอ; เลื่อนเดือนแนวตั้งแล้วหัววันยังติดด้านบน
- [ ] ชื่อสินค้ายาว/หลายป้ายไม่ดันช่องให้กว้าง · hover เพื่อดูชื่อเต็ม/สถานะ/มุม/ป้าย; คลิกเปิดรายละเอียด/พรีวิวยังเหมือนเดิม · ลบเดี่ยว, เลือกลบหลายรายการ, กรอง/ค้นหา และลากย้ายวันยังทำงาน (ลากต้องเปลี่ยนเฉพาะวันที่ ไม่เปลี่ยนเวลา)
- [ ] ข้อมูล/คอนเทนต์/สถานะ/จำนวนโพสต์เดิมต้องยังอยู่ครบ — รอบนี้ไม่มีการย้ายหรือเขียน runtime-state

**ค้างของ session `arena/969a8048…` — คอนเทนต์อิงลูกค้า + `validate.sh`/`start.sh` (ทำบนเครื่อง Mac ที่ `/Volumes/AI` เท่านั้น):**
- [ ] **อัปเดต:** `cd /Volumes/AI && git pull --ff-only && bash validate.sh` (ติดตั้ง dependency ให้เองถ้ายังไม่มี + build UI + รันชุดทดสอบทั้งหมด) แล้วเปิดแอปด้วย `./start.sh` · จากนั้นในแอป: **แท็บ Text Models → โหลดโมเดลก่อน** ใช้ฟีเจอร์ Local AI
- [ ] **ประเภทธุรกิจของแต่ละลูกค้า:** เปิด Social Agency → หัวเรื่องลูกค้าต้องขึ้น "คอนเทนต์แบบ …" ตรงกับธุรกิจ (Thai Modern Bags = สินค้า/งานผลิต (OEM) · Oven บ้านๆ = อาหาร/เครื่องดื่ม · ดอยหอม = อาหาร/เครื่องดื่ม · ปลายฝน = บริการ/คลาสเรียน · Plant Club = ร้านค้า/ขายปลีก) · สลับลูกค้าแล้วค่าต้องเปลี่ยนตาม
- [ ] **ปฏิทินบอกว่าลูกค้าต้องการอะไร:** แท็บ ปฏิทิน → แถบเครื่องมือมี "มุมคอนเทนต์:" ที่ติ๊กไว้ครบทุกมุมของลูกค้ารายนั้น · ยกเลิกบางมุม (เช่นเหลือ "เมนูใหม่" อันเดียว) แล้วกด "วางแผนอัตโนมัติทั้งเดือน" → ตัวอย่างแผน/ชิปในปฏิทินต้องมีแต่มุมที่เลือก และหน้าต่างวางแผนขึ้นบรรทัด "มุมคอนเทนต์เดือนนี้ (… · N มุม): … ×จำนวน"
- [ ] **ไม่ใช่ของโรงงานอีกต่อไป:** ทดลองกับ **ปลายฝน (โยคะ)** — แผน/แคปชัน/ตัวอย่างสำเร็จรูปต้องไม่มีคำ "โรงงาน/ผลิต/OEM/สต็อก" และบรรทัดข้อมูลต้องเป็น "เริ่มต้น 1 คลาส · เปิดคลาสทุกสัปดาห์" · กับ **Oven บ้านๆ** ต้องได้ "เมนูใหม่/เบื้องหลังครัว/โปรโมชัน/เซตของขวัญ" และปิดท้ายด้วยโทนของร้าน ("ทักมาแชทได้เลยนะ แอดมินตอบไวมากจ้า")
- [ ] **เสาหลัก:** แท็บ สไตล์ → เสาหลักของแต่ละลูกค้าต้องเป็นของธุรกิจนั้น (โยคะ = ชวนมาใช้บริการ/ให้ความรู้/สร้างความเชื่อใจ โดยมีมุม "คลาส/บริการใหม่" ฯลฯ) · กดเพิ่ม/แก้น้ำหนักเสาเองแล้วประเภทธุรกิจเปลี่ยนภายหลัง (แก้ industry หรือเพิ่มสินค้า) → เสาที่แก้เองต้อง**ไม่ถูกทับ**
- [ ] **ข้อมูลเดิมต้องรอด:** `grep -o '"contentPillarsSyncedKind": "[a-z]*"\|"contentKind": "[a-z]*"' /Volumes/AI/app/runtime-state/social-agency/*.json` — ต้องเห็น `contentPillarsSyncedKind` ถูกบันทึก (ครั้งเดียว) และโพสต์/แคปชันเดิมในปฏิทินต้องยังอยู่ครบ ไม่มีอะไรถูกลบ
- [ ] **`validate.sh` บน Mac:** `bash validate.sh --filter social` ควรผ่านทุกชุด (รวมชุดใหม่ `test-social-agency-client-content.cjs` 17 checks) · ถ้ายังไม่ได้ `pip install imageio-ffmpeg` ให้รันแบบไม่ใส่ `--include-python` หรือติดตั้งแล้วรันเต็ม

**ค้างของ session `arena/c363a091…` — Social Agency: พรีวิวบนสุด / ตาในปฏิทิน / ตัวอย่างแคปชันสำเร็จรูป (ทำบนเครื่อง Mac เท่านั้น):**
- [ ] **อัปเดต + build:** `git pull --ff-only` แล้ว `cd app/frontend && npm install && npx vite build` (UI จะไม่เปลี่ยนถ้าไม่ build — `app/dist/` ไม่อยู่ใน git) แล้วเปิดแอปตามปกติ
- [ ] **ตาในปฏิทิน:** แท็บ "ปฏิทิน" → ชิปที่มีแคปชัน/ภาพอยู่แล้วต้องมีไอคอนรูปตาข้างป้ายแพลตฟอร์ม · ชิปที่ยังไม่มีอะไรเลยต้องไม่มีตา · tooltip ต้องบอกว่ามีพรีวิวให้ตรวจ
- [ ] **พรีวิวบนสุด:** คลิกชิป → เปิดหน้ารายการแล้วต้องเห็น "พรีวิวโพสต์เต็ม" เป็น section แรกใต้แถวสถานะ (ไม่ต้องเลื่อน) · ตรวจว่ามีสำเนาเดียว (ด้านล่างต้องไม่มีพรีวิวซ้ำ)
- [ ] **ตัวอย่าง 3 แบบ:** ในหน้ารายการ เห็นหัวข้อ "ตัวอย่างสำเร็จรูป (3 แบบ)" → สลับทั้ง 3 แท็บ ต้องเห็นพรีวิวเปลี่ยนตามข้อความและแพลตฟอร์มของรายการนั้น (FB/IG/LINE/TikTok เลย์เอาต์ต่างกัน) · แก้ข้อความในกล่องแล้วพรีวิวต้องเปลี่ยนตามทันที · ปุ่ม "ย้อนกลับเป็นข้อความตัวอย่าง" คืนข้อความเดิม
- [ ] **การใช้ตัวอย่างต้องแทนที่เฉพาะแคปชัน:** กดใช้บนรายการที่ยังเป็น `planned`/`needs_review` → หัวข้อพรีวิวขึ้น "(แก้เอง)" และ `grep -o '"captionManual": true\|"captionSource": "preset:[a-z-]*"' /Volumes/AI/app/runtime-state/social-agency/<ลูกค้า>.json` ต้องเห็นค่าทั้งสอง · **วัน/เวลา/รูป/สถานะต้องไม่เปลี่ยน** และ **ห้ามมีโพสต์เกิดขึ้นเอง** (ไม่มี run ใหม่, ไม่มี `publishedAt`)
- [ ] **รายการที่ถูกล็อก:** เปิดรายการ TikTok ที่ยืนยัน/ส่งไปแล้ว, รายการที่กำลังรัน, รายการที่เผยแพร่แล้ว และโพสต์ A/B → ต้องเห็นแบนเนอร์เหตุผลสีเหลืองแทนปุ่มใช้ และไม่มีทางกดใช้ได้
- [ ] **ยังไม่มีภาพโพสต์:** เปิดรายการที่ยังไม่สร้างภาพ → พรีวิวของตัวอย่างต้องแสดง **รูปสินค้าต้นฉบับ** พร้อมป้าย "รูปอ้างอิง · ยังไม่ใช่สื่อโพสต์" และบรรทัดอธิบายในแผงตัวอย่าง · ไม่มีรูปสินค้าเลย → ขึ้นข้อความ "ยังไม่ได้แนบภาพหรือวิดีโอ"
- [ ] **แคปชันที่ใช้แล้วต้องรอดถึงตอนรัน:** กด "รันเลยตอนนี้" หลังใช้ตัวอย่าง → workflow ต้องใช้ข้อความนั้น ไม่เขียนแคปชันใหม่ทับ (โค้ดเช็ค `captionManual` อยู่แล้ว) · ถ้ารันผ่าน LLM ให้ดูว่า AI Check ไม่ฟ้องเรื่องราคาเมื่อราคามาจาก `product.price`
- [ ] **LINE/TikTok ที่ข้อความยาว:** แก้ข้อความในตัวอย่างให้เกินเพดาน (LINE ~400 ตัวอักษร) → ต้องขึ้น error สีแดงและปุ่มใช้ถูกปิด

**ค้างของ session `arena/bd08f753…` — telemetry / resource governor (Linux CI ผ่าน; ต้องยืนยันบน Mac):**
- [ ] หลัง PR merge บนเครื่อง Mac ให้ `git pull --ff-only` แล้ว build ใหม่ (`cd app/frontend && npm install && npx vite build`); `app/dist/` ไม่อยู่ใน git
- [ ] โหลดโมเดลบน Apple Silicon → RAM chip ต้องแสดงส่วนที่ LUKE รับผิดชอบแยกจาก memory ทั้งเครื่อง และ VRAM used ต้องเพิ่มจากศูนย์; total ควรตาม learned Metal working set (เช่น ~14.3 GB บนเครื่อง 18 GB) ไม่ใช่ total RAM
- [ ] ทดสอบ governor: ให้แชทโหลดโมเดลแล้วปล่อย idle; เมื่อ memory pressure จริงสูง ให้ log/status แสดง decision + `lastRelease`; ส่งแชทใหม่แล้วโมเดลต้องโหลดคืนเองพร้อม log `[llm] restored …, released by governor`. ภาวะปกติและ swap เก่าที่ค้างหลัง spike ต้องไม่ปลดโมเดล
- [ ] ทดสอบเส้นทาง load ที่ไม่พอ RAM: governor ต้องคืนพื้นที่เฉพาะเมื่อมี engine ที่ restorable ครอบคลุม shortfall; ถ้ายังไม่พอหลังปลดต้องปฏิเสธ load ตามเดิมและไม่ปลดแบบครึ่งทาง
- [ ] ระหว่างสร้างภาพจริง/งาน Social Agency ที่กำลังรัน ต้องไม่ปลด image backend; เช็คว่า progress/run จบได้ และ generator restart backend ที่ถูก unload หลังงานเสร็จได้
- [ ] ซ่อนแท็บ/ปิด browser มากกว่า 30 วินาที → log `[telemetry] … sampling paused`; กลับมาเปิด monitor → sampling resumed และ chip ได้ตัวเลขใหม่ภายในประมาณ 5 วินาที
- [ ] ลอง list/upload/download ผ่าน cloud storage provider เพื่อยืนยันว่า AWS SDK โหลดเมื่อเรียกใช้จริง ไม่ใช่ตอน server boot

**สิ่งที่ควรรู้ก่อนรอบหน้า:**
- `ci-baseline.json` ว่าง → **ชุดที่ล้มอีกครั้งคือของใหม่จริง** · อย่าใส่รายการกลับเพื่อให้ CI เขียว ให้แก้ที่ต้นเหตุ
- หลายชุดเคยวัด **สภาพเครื่อง** แทน **ตัวโค้ด** (tmpdir กับ app อยู่คนละดิสก์ · working tree ที่แอปเขียนทับ · โฟลเดอร์ที่ setup ติดตั้งเอง · โฟลเดอร์ที่ gitignore) — เวลาเทสต์ล้มบนเครื่องหนึ่งแต่ผ่านอีกเครื่อง ให้ถามก่อนว่า "ข้อเท็จจริงที่ยืนยันคือเรื่องไหน" ไม่ใช่ "เครื่องนี้ต่างยังไง"
- `validate-release.sh` ต้อง Python ที่ `import imageio_ffmpeg` ได้ · CI ติดตั้งให้แล้วใน workflow (เครื่องนี้ติดตั้งด้วย `python3 -m pip install --break-system-packages imageio_ffmpeg`)
- **รอยตำหนิที่รู้อยู่และยังไม่แก้:** สไลเดอร์ Denoise Guidance ใน `ReferenceManager.jsx` เปิดถึง 0.85 แต่ `api.js` clamp ที่ 0.75 (และ Social Agency ที่ 0.75) — ค่าที่ส่งจริงคือ 0.75 เสมอ; ถ้าจะแก้ให้แก้ที่สไลเดอร์ ไม่ใช่ที่ clamp
- `mac.sh:55` ยังอ่าน `git ls-files app/dist` ซึ่งว่างเปล่ามาตั้งแต่ `app/dist/` ถูก gitignore · ยังไม่ได้แก้ เพราะเป็นโค้ดตัวเรียกแอป — เป็นงานค้างที่จงใจทิ้งไว้
- เทสต์ที่สร้าง fixture ด้วย `git clone` **ห้ามอ่านสถานะของ checkout ที่ตัวเองรันอยู่** (branch, remote, working tree) — สามระบบนี้มีสภาพต่างกันจริง: เครื่อง local อยู่บน branch · sandbox อยู่บน branch · CI เป็น detached HEAD · เทสต์ที่ผ่านสองในสามเครื่อง แปลว่ายังไม่ได้พิสูจน์บนเครื่องที่สาม

---

## 7. บันทึกการสืบหา commit `5be0bd0` / `1d7d26c` (session `arena/01a0f037…`, 2026-09-30)

## 7.5 บันทึกเคสงานหายของ session ก่อน (session `arena/01a0f582…`, 2026-10-01) — "งานชุดป้าย/reject/รูปสินค้าแนบโพสต์"

**คำขอที่เข้ามา:** ข้อความส่งต่อจาก session ก่อนบอกให้ session ใหม่ `git push origin arena/01a0f086…` → เปิด PR → merge พร้อมเช็กลิสต์บน Mac (WLB-006 · หน้ารายการขึ้น `concept` + `pencil case` · ปุ่ม "ไม่ใช่ — ห้ามใช้รูปนี้" · ลิงก์ Reference ในแคปชัน)

**ผลสรุป: PR นั้นเสร็จไปแล้ว แต่งานชุดใหม่หายทั้งชุด → สร้างใหม่ใน session นี้ (หัวข้อ 2)**
- ตรวจแล้ว: PR #29 (branch `arena/01a0f086…`) **merged เป็น `a86fb7c` เมื่อ 2026-09-30 04:40 UTC** (merge commit มี tip ของ branch เป็น parent ที่สอง) · CI `validation` บน `main` เขียว · ไม่มี PR ที่เปิดค้าง → **push branch เดิมซ้ำเป็น no-op**
- แต่งานที่ข้อความอ้าง (WLB-006, ป้าย, ปุ่มปฏิเสธ, Reference ในโพสต์) **ไม่มีบน GitHub เลย**: ไล่ branch ทุกตัว + `refs/pull/*` ทั้งหมด (#1–#29) · GitHub Events API หลัง 04:40 UTC ของ 30 ก.ย. **ไม่มี push แม้แต่ครั้งเดียว** · สแกน git object ทุกชิ้นบน origin (3,917 blobs) หา `WLB-006` / `pencil case` / `ห้ามใช้รูปนี้` / `ติดป้าย` = **0 ผลลัพธ์** → งานอยู่แค่ใน sandbox ของ session ก่อนและไม่เคยถูก push = **กู้คืนไม่ได้** (เครื่อง Mac ก็ไม่มี เพราะดึงของจาก GitHub เท่านั้น)
- **การสร้างใหม่ใน session นี้** ใช้สเปกที่คุยกับเจ้าของงานใหม่ทั้งหมด (มีการเปลี่ยนจากของเดิม 2 จุดตามที่เจ้าของงานเลือก: Reference เป็น **รูปที่ 2 ในโพสต์เดียว** แทนลิงก์ในแคปชัน · กดปฏิเสธแล้ว**สร้างใหม่อัตโนมัติ** · เพิ่มขนาดภาพ 1024×600 ตั้งได้)
- **บทเรียนซ้ำ (เดิมจากเคส 5be0bd0):** งานที่ทำใน sandbox ต้อง **commit + push + merge เข้า `main` ภายใน session เดียวกันทุกครั้ง** ถ้า session จะจบแล้วยัง merge ไม่ได้ ให้ย้อนกลับไปทำให้จบก่อน — อย่าปิด session ทิ้ง commit ไว้ใน sandbox · ข้อความส่งต่อที่บอกให้ session ถัดไป "push branch เดิม" ใช้ไม่ได้ถ้า branch นั้นไม่เคยถูก push

**คำขอ:** ตรวจว่า commit `5be0bd0` และ `1d7d26c` ยังอยู่ไหม แล้ว push `1d7d26c` ไปที่ `origin/arena/01a0eb60-luke-ai-studio-enterprise` โดยไม่ใช้ force push

**ผลสรุป: ไม่พบทั้งสอง commit ที่ไหนเลย → ไม่มีอะไรให้ push** (ไม่มี object = push ไม่ได้ ไม่ใช่เรื่อง force/ไม่ force)

| ที่ที่ตรวจ | วิธีตรวจ | `5be0bd0` | `1d7d26c` |
|---|---|---|---|
| sandbox (clone ของ Arena) | `git cat-file -t` · `git fsck --lost-found` · `git reflog --all` | ❌ | ❌ |
| sandbox หลัง `git fetch --unshallow` (ประวัติเต็ม 209 commits) | `git rev-list --all --objects` · สแกนทุก commit object ด้วย `git cat-file --batch-all-objects` | ❌ | ❌ |
| branch อื่นทั้งหมดบน GitHub (36 refs) | `git ls-remote origin` · `git fetch origin <sha>` | ❌ | ❌ |
| GitHub API 2 endpoint | `/commits/<sha>` → HTTP 422 · `/git/commits/<sha>` → HTTP 404 | ❌ | ❌ |
| เครื่อง Mac `/Volumes/AI` | `git cat-file -t` · `git log` · `git merge-base` | ❌ `Not a valid object name` | ❌ `Not a valid object name` |

**สิ่งที่พบเพิ่มบนเครื่อง Mac (จาก output ที่ผู้ใช้รันเอง 2026-09-30):**
- อยู่บน branch **`cutout-tmp`** ที่ track `origin/main` — `git status -sb` ขึ้น `## cutout-tmp...origin/main` **ไม่มี `[ahead N]`** แปลว่าซิงก์กับ `origin/main` อยู่ → **ไม่มี commit ค้างให้ push บนเครื่องนั้น**
- `luke-image-gate.patch` (untracked, 29 Sep 10:28) — **ไฟล์ว่าง 0 ไบต์** จึงไม่มีแพตช์อยู่ในนั้น ไม่ใช่ที่กู้ของด่านตรวจภาพ

**ข้อสรุปเชิงสาเหตุ:** commit สองตัวนี้น่าจะถูกสร้างใน sandbox ของ session ก่อน (คนละเครื่องกับ Mac) แล้วไม่เคยถูก push — พอ sandbox ถูกล้าง object จึงหายถาวร ตรงกับรูปแบบที่หัวข้อ 2 เตือนไว้แล้ว (`แพตช์เดิมที่ทำบน Mac … ไม่เคยถูก push และกู้คืนไม่ได้`) · **ตัวเนื้องานไม่หาย** เพราะงานชุดเดียวกัน (img2img + คำเตือน + เช็กบ็อกซ์) ขึ้น `main` แล้วเป็น `5d64236` + `f83ee8d` → merge `24c2a64` และไฟล์จริงอยู่ใน `main` ครบ (`scripts/server/social-agency-runtime.cjs`, เทสต์ 2 ชุด)

**ปิดเคส (สแกนครบทุกสำเนาบนเครื่อง Mac, 2026-09-30):** ไล่หา `.git` ทั้งหมดใต้ `/Users/ekky` และ `/Volumes` (maxdepth 7) ได้ **16 repo** แล้วสั่ง `git -C <repo> cat-file -e 5be0bd0` / `1d7d26c` ทุกตัว → **ไม่พบทั้งสอง sha ที่ไหนเลยแม้แต่ที่เดียว** · `/Volumes/AI` เอง: `git log --branches --not --remotes` **ว่าง** (ไม่มี commit ค้างให้ push) และ `git log origin/main..HEAD` **ว่าง** (branch `cutout-tmp` ตรงกับ `origin/main`) ⇒ **ไม่มีสำเนาที่กู้ได้ และไม่มีอะไรต้อง push — เคสนี้ปิด** · กู้ได้เฉพาะ "เนื้องาน" ที่อยู่ใน `main` แล้วเท่านั้น

**บทเรียนสำหรับรอบหน้า:** งานที่ทำใน sandbox ต้อง **commit + push + merge เข้า `main` ทันทีใน session เดียวกัน** · ห้ามอ้างอิง sha จาก session ก่อนแบบลอยๆ ในบทสนทนา — ให้อ้าง sha ที่อยู่ใน `main` แล้วเท่านั้น (บทสนทนาเก่าไม่ตามมา, sandbox เก่าถูกล้าง) · SHA ที่ไม่เคย push จะกู้จาก GitHub ไม่ได้แม้จะรู้ sha ก็ตาม

**กับดักของ zsh บนเครื่อง Mac (เจอซ้ำ 2 ครั้งใน session นี้):** คำสั่งที่ยกมาให้คัดลอกมักมีคำอธิบายภาษาไทยต่อท้ายด้วย `#` — zsh แบบ interactive ที่ **ไม่ได้เปิด** `interactivecomments` จะถือ `#` เป็นตัวอักษรธรรมดา แล้วส่งข้อความที่ตามหลังเป็น argument ของคำสั่ง (อาการ: `rm: #: No such file or directory`, `fatal: couldn't find remote ref #`, `git cat-file: too many arguments`) → แก้ถาวรครั้งเดียวด้วย `echo 'setopt interactivecomments' >> ~/.zshrc` แล้ว**เปิด terminal ใหม่** (ค่า `setopt` สั่งในหน้าต่างเดิมไม่ติดไปหน้าต่างใหม่ — คนละ shell)

---

## 7.6 บันทึกเคสงานหายรอบที่ 4 (session `arena/ccbe7be3…`, 2026-10-06) — "cache สำหรับโมเดลภาพ + โหลดจากสำเนาดิสก์ภายใน"

**คำขอที่เข้ามา:** ข้อความส่งต่อจาก session ที่ปิดไปแล้วระบุว่า *"การแก้ไขบันทึกอยู่ใน working tree ของ repo นี้แล้ว … แต่ไม่ได้อยู่บน GitHub"* และบอกให้ session ใหม่ "ส่งต่อการแก้ไขขึ้น GitHub"

**ผลสรุป: ไม่มีอะไรให้ส่งต่อ — งานนั้นไม่มีอยู่ใน sandbox ของ session นี้ และกู้คืนไม่ได้** (นี่คือเคสที่ 4 ของรูปแบบเดียวกัน: `5be0bd0`/`1d7d26c` → `01a0f086…`→`01a0f582…` → `01a0fba7…` (PR #32/#33 ซึ่งรอดเพราะถูก push) → เคสนี้)

| ที่ที่ตรวจ | วิธีตรวจ | ผล |
|---|---|---|
| working tree ของ session นี้ | `git status --porcelain` (รวม `--ignored`) | **ว่าง** — ไม่มีการแก้ไขใด ๆ |
| stash | `git stash list` | ว่าง |
| object ทั้งหมด + reflog | `git fsck --lost-found --no-reflogs` · `git reflog` · `git for-each-ref` | ไม่มี dangling object · ประวัติเริ่มที่ `clone: from github.com/...` เท่านั้น |
| refs บน GitHub | `git branch -a` · `gh pr list --state all` | `main` = `446d113` (merge PR #33) · **PR ล่าสุดคือ #33** ไม่มี PR เรื่อง image cache |
| ที่อื่นบน sandbox | `find / -maxdepth 2 -name .git` · `/tmp/arena-workspace` | มี repo เดียวคือ checkout ที่ clone ใหม่ · ไฟล์ว่าง/ไม่มี patch |

**สาเหตุ (ยืนยันแล้วทุกเคสที่ผ่านมา):** sandbox ของแต่ละ session เป็นเครื่องชั่วคราวที่ clone จาก `main` ใหม่เสมอ — ไฟล์ที่ไม่ได้ commit+push **ภายใน session นั้น** จะถูกล้างไปพร้อม sandbox การที่ข้อความส่งต่อพูดว่า "บันทึกอยู่ใน working tree แล้ว" จึงจริงตอนที่ session นั้นยังเปิดอยู่ และไม่เป็นจริงทันทีที่ session ปิด (ถ้อยคำนี้ทำให้เข้าใจว่ามีของให้กู้ ทั้งที่ไม่มี object อยู่เลย)

**สิ่งที่ทำแทนการกู้:** อ่านโค้ดจริงใน `main` แล้ว**เขียนงานชุดนั้นขึ้นใหม่** (หัวข้อ 2 "PR นี้") — ระหว่างไล่โค้ดเจอบั๊กที่ยังไม่มีใครสังเกต 2 ตัว ซึ่งงานชุดเก้าน่าจะเขียนทับไว้โดยไม่เจตนา: (1) cache เคยใช้ได้กับไฟล์เดี่ยวเท่านั้น โมเดลภาพเป็นโฟลเดอร์จึงไม่เข้าเกณฑ์เลย (2) **ตัวโหลดมองหาสำเนาคนละโฟลเดอร์กับที่ระบบเขียนสำเนาไว้** ทำให้อาการ "มีสำเนาบนดิสก์ภายในแต่ไม่เคยถูกใช้" ยังอยู่ทั้งที่มีไฟล์ครบ — ทั้งคู่ถูกแก้และเขียนเทสต์คุมไว้ใน PR นี้

**กติกาซ้ำที่ต้องไม่พลาดอีก:** งานในทุก session ต้อง `commit → push → เปิด PR → merge เข้า `main` ให้จบใน session เดียวกัน` ถ้าจะปิด session โดย merge ไม่ทัน ให้ push branch ไว้ **และ** เขียน sha ที่ push จริงลงหัวข้อ 1 (sha ที่ยังไม่ push ห้ามเขียนลงเอกสาร)

### วิธีเอางานชุดนี้ไปใช้บน Mac (หลังจาก PR merge แล้วเท่านั้น)

```bash
cd <โฟลเดอร์ repo บน Mac>          # ตามปกติคือ /Volumes/AI/LUKE-AI-STUDIO-Enterprise
git fetch origin
git checkout main
git pull --ff-only
cd app/frontend && npm install && npx vite build
cd ../.. && ./mac.sh
```

> ⚠️ **ต้อง build ใหม่** เพราะ `app/dist/` ไม่อยู่ใน git (หัวข้อ 3) ถ้าข้ามขั้นนี้ UI จะยังเป็นแบบเก่าและจะไม่เห็นรายการโมเดลภาพใน `Settings > Performance` เลย
> ⚠️ zsh บน Mac ไม่เปิด `interactivecomments` โดยค่าเริ่มต้น — ห้ามวางบรรทัดที่มี `#` ต่อท้ายคำสั่ง (ดูท้ายหัวข้อ 7.5)

### เช็กลิสต์ยืนยันบน Mac (ยังไม่มีใครทำ)

1. `Settings > Performance` → เปิด "Use the internal disk…" → ต้องเห็น **both** ไฟล์ GGUF *และ*โฟลเดอร์ Core ML พร้อมคำว่า `Image model` (เดิมไม่แสดงอะไรเลย เพราะ POST ถูก 404)
2. กด Copy ที่โมเดลภาพ → รอเสร็จ → log ของ server ต้องมี `[backend] Loading <ชื่อโมเดล> from the internal disk cache (… GB, … files)` ตอนโหลดครั้งถัดไป (ถ้ายังขึ้นว่ามาจาก external volume แปลว่า `cachedCopyFor` มองไม่เห็นสำเนา — ให้ grep `manifest.json` ใน `~/Library/Application Support/LUKE AI STUDIO/model-cache/`)
3. โหลดโมเดลภาพตอน **ปิดเน็ต**: log ต้องมี `[coreml-npu] Reference config for … read from the local copy in …` ไม่ใช่ข้อความ "No usable local copy"
4. ขนาดโฟลเดอร์ cache บนดิสก์ภายใน (`du -sh ~/Library/Application\ Support/LUKE\ AI\ STUDIO/model-cache`) ต้องเท่ากับขนาดโมเดลที่เลือก และ **ต้นฉบับบน external volume ต้องยังอยู่** (ข้อนี้คือเหตุผลที่ copy ไม่ใช่ move)

---

## 7.7 บันทึกเคสงานหายรอบที่ 5 (session `arena/c363a091…`, 2026-10-07) — "พรีวิวบนสุด + ตาในปฏิทิน + ตัวอย่างแคปชันสำเร็จรูป"

**คำขอที่เข้ามา:** ข้อความส่งต่อจาก session ที่ปิดไปแล้วระบุว่า *"บันทึกใน local commit `86f6cf2` แล้ว แต่ session นี้ปิดหลัง PR #37 merge จึงยังไม่ได้ push"* และให้ "เริ่ม Arena coding session ใหม่เพื่อเผยแพร่"

**ผลสรุป: ไม่มีอะไรให้ push — commit นั้นไม่มีอยู่จริงในที่ใดที่ session นี้มองเห็น** (เคสที่ 5 ของรูปแบบเดิม: `5be0bd0`/`1d7d26c` → `01a0f086…` → `01a0f582…` → `ccbe7be3…` → เคสนี้)

| ที่ที่ตรวจ | วิธีตรวจ | ผล |
|---|---|---|
| ปลายทางที่จะ push | `git ls-remote --heads origin` | ไม่มี branch ใดชี้ไปที่งานชุดนี้ · `main` = `494c158` (merge PR #37) |
| วัตถุในเครื่อง | `git cat-file -e 86f6cf2` · `git log --all --oneline` | `fatal: ambiguous argument '86f6cf2'` — ไม่มี object นี้ (clone เป็น shallow, history มีแค่ `494c158`) |
| PR บน GitHub | `gh pr list --state all --limit 15` | PR ล่าสุดคือ #37 (merged) — ไม่มี PR เรื่องพรีวิว/ตัวอย่างแคปชัน |
| working tree | `git status --porcelain` | สะอาด — ไม่มีการแก้ไขค้าง |

**สาเหตุ:** เหมือนทุกเคส — sandbox เป็นเครื่องชั่วคราวที่ clone จาก `main`; commit ที่ไม่ได้ push ภายใน session นั้นหายไปพร้อม sandbox · ข้อความ "บันทึกใน local commit แล้ว" จึงจริงเฉพาะตอน session ยังเปิดอยู่ และ "session นี้ปิดหลัง PR merge" คือเงื่อนไขที่ทำให้ไม่มีการ push เกิดขึ้นเลย

**สิ่งที่ทำแทนการกู้:** อ่านข้อความส่งต่อ (ซึ่งเป็นสเปกที่ละเอียดพอ) + อ่านโค้ดจริงใน `main` แล้ว**เขียนฟีเจอร์ชุดนี้ขึ้นใหม่ทั้งหมด** (หัวข้อ 2 "PR #38") — รวมถึงเทสต์ใหม่ 1 ชุด และบั๊กจริง 1 ตัวที่เจอระหว่างทาง (ด่านหลักฐานราคาไม่เคยนับ `product.price` เป็นหลักฐาน ทำให้แคปชันที่อ้างราคาจากข้อมูลจริงถูกตีว่าอ้างเกินทุกครั้ง) · **สิ่งที่เขียนใหม่ได้ตรงตามสเปก แต่ไม่ใช่ไบต์เดิมของ commit ที่หาย** — ถ้าเจ้าของงานมีสำเนา `86f6cf2` อยู่จริงบนเครื่อง Mac (เช่นใน reflog ของ repo ที่ `/Volumes/AI`) การเทียบ diff กับ PR #38 จะบอกได้ว่าของเดิมต่างตรงไหน

**กติกาซ้ำ:** ทุก session ต้อง `commit → push → เปิด PR → merge เข้า main` ให้จบใน session เดียวกัน · ถ้า merge ไม่ทัน ให้ push branch **และ** เขียน sha ที่ push จริงลงหัวข้อ 1 (sha ที่ยังไม่ push ห้ามเขียนลงเอกสาร — เอกสารที่อ้าง commit ที่ไม่มีอยู่ทำให้ session ถัดไปต้องเสียเวลาไล่หาของที่ไม่มี)
