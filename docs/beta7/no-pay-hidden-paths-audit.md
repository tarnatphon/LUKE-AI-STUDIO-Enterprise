# No-pay audit — ตามหา "ทางที่ต้องจ่ายตังค์มาใช้ต่อ" ที่แอบอยู่

> ตรวจตามนิยามที่เจ้าของแก้ไว้ใน PR #82: **"เสียตังค์" = ต้องจ่ายตังค์มาใช้ต่อ**
> ไม่ใช่ "vendor นี้ก็ขายแพ็กเกจจ่ายด้วย" → free tier / โควต้ารายวันไม่ต้องผูกบัตร /
> trial credit ที่ต้องผูกบัตรบนเว็บ provider **ใช้ได้ปกติจนหมด** แล้วค่อย local
> ห้าม top-up / paid upgrade / เก็บบัตร / จ่ายหลัง `402`

## ผลสรุป: **ไม่พบ payment path ที่ทำงานจริง** แต่พบ 3 ช่องโหว่ของ "การตรวจสอบเอง"

| # | สิ่งที่เจอ | ความเสี่ยง | สิ่งที่ทำ |
| :--- | :--- | :--- | :--- |
| 1 | `scripts/config/ai-provider-catalog.json` ส่วน `_readme` **ยังเป็นภาษา PR #80** — บอกว่า "card-backed trial credit ถูกลบทิ้ง", "every entry `requiresCard=false`", "`kind` มีแค่ `free-tier`/`local`" ทั้งที่ข้อมูลจริงมี **18 entries / 4 ชนิด trial-credit / 3 ตัว `requiresCard=true`** และ `policy.id` คือ `use-free-then-local` | **สูง** — นี่คือคำสั่งเก่าที่ทำให้คนลบ free trial credit อีกครั้งได้ง่ายๆ (ตรงข้ามกับที่เจ้าของแก้ไว้) และ **ไม่มีเทสต์ไหนอ่าน `_readme` เลย** | เขียน `_readme` ใหม่ให้ตรงข้อมูล + เพิ่มเช็ค pin ว่าเอกสารใน config ต้องตรงกับข้อมูลจริง (ห้ามมีประโยคเก่าจาก PR #80) |
| 2 | `PAYMENT_FIELDS` ใน `online-media.cjs` ปฏิเสธบัตร/top-up/upgrade อยู่แล้ว แต่ **ยังไม่มี handle ของผู้ประมวลผลจ่ายเงิน** (`priceId`, `planId`, `subscriptionId`, `stripe`, `paypal`, `checkoutUrl`, `paymentToken`, `buyCredits` ฯลฯ) → field พวกนี้ผ่านเข้าไปเป็น "unknown field" ได้ | กลาง — วันหน้าถ้ามีคนต่อ adapter แล้วอ่าน field พวกนี้ จะกลายเป็นทางจ่ายเงียบๆ | เพิ่ม **18 field** ลง denylist (รวม 38) + เทสต์ว่าปฏิเสธด้วย `payment_field_rejected` / `fallback: "local"` ก่อนมี dispatch |
| 3 | `test-no-pay-audit.cjs` เดินสแกนแค่ `scripts/server`, `scripts/search`, `scripts/config`, `app/frontend/src` + 3 ไฟล์ → **มองไม่เห็น** `scripts/updater/update.cjs` (รันทุกครั้งที่เปิดแอป), ตัวช่วย token ของ Social Agency, `scripts/cloud-doctor.cjs`, `scripts/setup/*.sh`, `app/frontend/public/*`, root launcher | กลาง — ไฟล์ที่ออก network ได้จริงกลับอยู่นอกขอบเขต audit | ชุดใหม่เดินสแกน **production tree ทั้งหมด** และมี meta-check ยืนยันว่าเห็นไฟล์ตัวแทนแต่ละพื้นที่จริง (ไม่ใช่ walk ว่างแล้วผ่านเงียบๆ) |

### สิ่งที่ **จงใจไม่เปลี่ยน** (สำคัญมาก)
`egressLedger` มี entry แบบ `{ decision: "blocked", paid: true }` ใน 3 จุด (`online-media.cjs`, `remote-text-provider.cjs`) ฟิลด์ `paid` ตรงนี้แปลว่า *"endpoint นี้กลายเป็นแบบจ่ายแล้ว / ถูกปฏิเสธ"* **ไม่ใช่** "LUKE จ่ายเงิน" — `stats().paidCalls` นับเฉพาะ `paid === true && decision === "allowed"` และ `test-online-surfaces.cjs:549` ยืนยันพฤติกรรมนี้ชัดเจน ถ้า "แก้" ให้ `paid: false` จะทำให้ attestation โกหกในทางตรงข้าม ชุดใหม่จึงเพิ่มเช็คยืนยันว่า blocked entry **ไม่เคยถูกนับเป็น paid call**

## หลักฐานว่าไม่มีทางจ่าย

- ไม่มี host ของผู้ประมวลผลจ่ายเงิน (`api.stripe.com`, `checkout.stripe.com`, `paypal.com`, `api.paddle.com`, `lemonsqueezy.com`, `gumroad.com` ฯลฯ) ใน production code
- ไม่มี env `STRIPE_* / PAYPAL_* / PADDLE_* / PAYMENT_* / BILLING_* / CHECKOUT_* / SUBSCRIPTION_*`
- ไม่มี URL ออกนอกที่ชี้ `/checkout`, `/billing`, `/subscribe`, `/upgrade`, `/pricing`, `/pay`, `/donate`, `/plans`
- ไม่มี `/api/...` route ชื่อ bill/pay/checkout/subscri/upgrade/topup/purchase/order
- ไม่มีข้อความ UI ประเภท Upgrade / Subscribe / Buy credits / Add card / Pay now
- `requiresCard` ปรากฏเฉพาะใน **data / normalisation / label UI** ไม่มี `if` หรือ eligibility decision ใดใช้มันเป็น gate
- `NO_PAY` เป็น constant ไม่ใช่สวิตช์; config ที่ถูกแก้มือใส่ `priceId` / `stripe` / `paidAllowed` ไม่ถูกเก็บ
- `402` → `now_paid` → ข้อความเสนอ "free model อื่น / local model" **ไม่มีคำ upgrade/subscription/buy/card/top-up** และ chain ยัง fail-closed กับ provider ที่ `free !== true`

## พฤติกรรมที่ถูกล็อกด้วยเทสต์ (ไม่ใช่แค่ grep)

ชุดใหม่ **`test-hidden-paid-paths.cjs` — 56 checks**:

1. **Consent / dry-run**: ไม่มี `explicitConsent` → `consent_required`; ไม่มี `creditConfirmed` → `credit_confirmation_required`; ค่าเริ่มต้นเป็น dry run (ไม่ dispatch ไม่หัก credit); `priceId`/`stripe`/`subscriptionId`/`paid` ถูกปฏิเสธก่อนมี transport; เฉพาะ `live: true` ที่ dispatch จริง 1 ครั้ง
2. **ใช้ grant จนหมดทั้ง 4 provider** — `fal_trial` 20, `veo_gcp_trial` 300, `stability_trial` 25, `kling_free` 6 → งานถัดไปได้ `409 free_credit_exhausted` + `fallback: "local"` + **ไม่มี dispatch เพิ่ม** + ไฟล์ spend มีแค่ `{spent, day, savedAt}` ไม่มี card/payment data
3. **402**: จำลอง upstream ตอบ 402 → `now_paid` / `fallback: local` / grant ถูก mark spent / ไม่มี allowed-paid egress
4. **Ledger**: blocked `paid: true` ไม่นับเป็น `Paid endpoints called` (attestation ยัง `0`)

ชุดเดิมยังผ่านครบ: `test-no-pay-audit.cjs` 62/0 · `test-online-surfaces.cjs` 144/0 · `test-remote-text-provider.cjs` 105/0 · `test-launcher-deps-guard.cjs` 58/0 · `test-frontend-build-self-heal.cjs` 32/0 · `run-all --include-python` 193/0

## วิธีรัน
```bash
node scripts/validation/test-hidden-paid-paths.cjs
node scripts/validation/test-no-pay-audit.cjs
```

> ถ้าจะเพิ่ม provider/endpoint ใหม่ ต้องแก้ allowlist ใน `test-no-pay-audit.cjs` **และ** ชุดนี้พร้อมบอกเหตุผล — ทางจ่ายต้องไม่เข้ามาเงียบๆ
