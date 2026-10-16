"use strict";

/*
 * Luke Social Agency — "ลูกค้ารายนี้ทำธุรกิจอะไร" → มุมคอนเทนต์ของเขา
 *
 * Content used to be authored for one business only. Every client — a bakery,
 * a coffee roaster, a yoga studio, a plant shop — was planned with the same
 * angles ("เบื้องหลังการผลิต", "โปรโมชัน/ข้อเสนอ OEM") and the same caption
 * leads ("โรงงานเราวันนี้คึกคักมาก"), and hashtags fell back to factory tags
 * ("#สั่งทำ", "#ผ้าฝีมือคนไทย") whenever the product category was not one of
 * the five the tables happened to know. Unless a client really is a bag
 * factory, that copy is simply wrong.
 *
 * So the plan is derived from the client: `detectContentKind()` reads the
 * client's `industry` plus its products and picks one kind — goods / food /
 * service / shop / generic — and that kind owns
 *
 *   - the angle labels a month is planned with (roles: launch, behind,
 *     knowhow, customer, promo — the SAME five roles the planner always
 *     rotated through, so a month still has one slot per role),
 *   - the Thai caption leads for each role,
 *   - the default content pillars (name + angles + weight),
 *   - the hashtag tables + the fallback tags,
 *   - and the English Stable Diffusion style phrase per role.
 *
 * The legacy labels ("เปิดตัวสินค้า", "เบื้องหลังการผลิต", …) ARE the `goods`
 * kind, so an existing bag/printing client sees exactly what it saw before —
 * nothing is renamed, no stored entry is invalidated. `allAngles()` is the
 * union of every kind, which is what validation accepts (old entries and old
 * pillars keep working); `anglesForKind()` is what a specific client is
 * planned with.
 *
 * Pure data + pure functions: no state, no fs, no network. The runtime owns
 * persistence and the UI reads the per-client summary from the state payload.
 */

// ── kinds ────────────────────────────────────────────────────────────────────

// Order matters twice: `ANGLE_KIND_ORDER` decides the order of `allAngles()`
// (goods first, so CONTENT_ANGLES[0] stays "เปิดตัวสินค้า"), `DETECT_PRIORITY`
// breaks score ties in `detectContentKind()`.
const ANGLE_KIND_ORDER = ["goods", "food", "service", "shop", "generic"];
const DETECT_PRIORITY = ["food", "service", "goods", "shop"];
const KINDS = [...ANGLE_KIND_ORDER];

const KIND_LABELS = {
  goods: "สินค้า/งานผลิต (OEM)",
  food: "อาหาร/เครื่องดื่ม",
  service: "บริการ/คลาสเรียน",
  shop: "ร้านค้า/ขายปลีก",
  generic: "ทั่วไป",
};

// Keywords are matched against `industry` (weight 3), then each product's
// `category` (weight 2) and `name` (weight 1). Distinct keywords count, so one
// word repeated five times does not outvote four different ones.
const KIND_MATCHERS = {
  goods: /(ผู้ผลิต|ผลิต|โรงงาน|oem|รับทำ|รับผลิต|สั่งทำ|แฟชั่น|เสื้อผ้า|กระเป๋า|ถุง|ผ้า|สิ่งทอ|เฟอร์นิเจอร์|เครื่องประดับ|บรรจุภัณฑ์|กล่อง|พิมพ์|ปัก|ซิลค์สกรีน|manufactur|factory|wholesale|garment|bag|fabric|textile|furniture|jewel|package|printing|embroidery)/i,
  food: /(อาหาร|ขนม|เบเกอร|เบเกอรี่|เค้ก|คุกกี้|ขนมปัง|ของหวาน|กาแฟ|เมล็ดกาแฟ|เครื่องดื่ม|ชา|น้ำผลไม้|ร้านอาหาร|ก๋วยเตี๋ยว|หมูกระทะ|บุฟเฟ่|ครัว|food|bakery|cake|cookie|pastry|dessert|coffee|cafe|drink|beverage|restaurant|kitchen|meal|menu|brunch)/i,
  service: /(โยคะ|พิลาทิส|ฟิตเนส|สตูดิโอ|คลาส|คอร์ส|เรียน|สอน|ติว|บริการ|สปา|นวด|คลินิก|ทันต|ตัดผม|เสริมสวย|ซ่อม|ที่ปรึกษา|สมาชิก|yoga|pilates|fitness|class|course|workshop|lesson|studio|service|spa|massage|salon|clinic|consult|training)/i,
  shop: /(ร้าน|ขาย|จำหน่าย|ปลีก|ส่ง|ต้นไม้|กระถาง|ดอกไม้|ของใช้|ของแต่ง|ตลาด|ช็อป|shop|store|retail|plant|flower|nursery|garden|market|outlet|pot)/i,
};

// ── angle catalog ────────────────────────────────────────────────────────────
// Five roles per kind. `role` is what the planner/caption layer keys on, so a
// month keeps its launch / behind / knowhow / customer / promo rhythm no matter
// which business the client runs. `image` is the Stable Diffusion phrase (the
// image model cannot read Thai, so it is authored in English).

const KIND_ANGLES = {
  goods: [
    { role: "launch", angle: "เปิดตัวสินค้า", image: "new product launch showcase" },
    { role: "behind", angle: "เบื้องหลังการผลิต", image: "behind-the-scenes artisan workshop" },
    { role: "knowhow", angle: "เคล็ดลับการใช้งาน", image: "product in everyday use, lifestyle context" },
    { role: "customer", angle: "เรื่องจากลูกค้า", image: "happy customer lifestyle testimonial scene" },
    { role: "promo", angle: "โปรโมชัน/ข้อเสนอ OEM", image: "promotional sale display, gift-ready packaging" },
  ],
  food: [
    { role: "launch", angle: "เมนูใหม่", image: "freshly made food and drink hero shot on a table" },
    { role: "behind", angle: "เบื้องหลังครัว", image: "behind-the-scenes kitchen, hands preparing fresh food" },
    { role: "knowhow", angle: "วิธีเก็บ/วิธีทาน", image: "food storage and serving tip close-up, neat details" },
    { role: "customer", angle: "เสียงจากลูกค้า", image: "happy customer enjoying the food, warm candid moment" },
    { role: "promo", angle: "โปรโมชัน/เซตของขวัญ", image: "gift set of treats, promotional flat lay" },
  ],
  service: [
    { role: "launch", angle: "คลาส/บริการใหม่", image: "new class session in a bright calm studio" },
    { role: "behind", angle: "เบื้องหลังทีมงาน", image: "behind-the-scenes instructors preparing the studio" },
    { role: "knowhow", angle: "ความรู้/วิธีปฏิบัติ", image: "step-by-step technique demonstration in a studio" },
    { role: "customer", angle: "เสียงจากสมาชิก", image: "happy member after class, candid testimonial" },
    { role: "promo", angle: "โปรโมชัน/แพ็กเกจ", image: "promotional package card in a welcoming studio" },
  ],
  shop: [
    { role: "launch", angle: "ของเข้าใหม่", image: "new arrivals display in a small shop" },
    { role: "behind", angle: "เบื้องหลังร้าน", image: "behind-the-scenes shop counter and packing station" },
    { role: "knowhow", angle: "วิธีดูแล/วิธีใช้", image: "care and usage tips with the product in hand" },
    { role: "customer", angle: "เสียงจากลูกค้า", image: "happy customer at the shop, candid moment" },
    { role: "promo", angle: "โปรโมชัน/จัดเซต", image: "promotional bundle arrangement on a shop display" },
  ],
  generic: [
    { role: "launch", angle: "ของใหม่จากร้าน", image: "new arrival hero shot on a clean background" },
    { role: "behind", angle: "เบื้องหลังการทำงาน", image: "behind-the-scenes workspace, hands at work" },
    { role: "knowhow", angle: "ความรู้/วิธีใช้", image: "product in everyday use, lifestyle context" },
    { role: "customer", angle: "เสียงจากลูกค้า", image: "happy customer candid testimonial scene" },
    { role: "promo", angle: "โปรโมชัน/ข้อเสนอพิเศษ", image: "promotional display with a special offer layout" },
  ],
};

// ── caption leads ────────────────────────────────────────────────────────────
// Three openings per kind+role; the runtime picks one by seed. `{name}` is
// replaced with the product name. The `goods` copy is the original set,
// character for character, so clients that were already right never change.

const KIND_LEADS = {
  goods: {
    launch: [
      "{name} ตัวใหม่ของเรา มาแล้วนะครับ 🎉",
      "เปิดตัวแล้วครับ {name} รุ่นใหม่ล่าสุดของร้าน ใครกำลังมองหาอยู่ต้องดู ✨",
      "มาแล้วครับ {name} โฉมใหม่ สั่งทำตามแบบแบรนด์คุณได้เลย 🙌",
    ],
    behind: [
      "วันนี้พาไปดูเบื้องหลังการทำงานจริงๆ กันนะครับ ทุกชิ้นเราใส่ใจตั้งแต่เลือกวัสดุจนส่งมอบ 🙌",
      "กว่าจะเป็นแต่ละชิ้นต้องผ่านหลายขั้นตอน วันนี้เก็บภาพเบื้องหลังมาฝากครับ 🧵",
      "โรงงานเราวันนี้คึกคักมาก พามาดูว่าทีมช่างใส่ใจรายละเอียดแค่ไหน 👀",
    ],
    knowhow: [
      "ขอแนะนำวิธีดูแลให้ใช้ได้นานๆ แบบเข้าใจง่าย อ่านจบใช้ได้เลยครับ ✨",
      "ใช้ยังไงให้คุ้มและทนที่สุด รวมทริคดีๆ มาฝากกันครับ 📌",
      "หลายคนถามมาเยอะว่าดูแลรักษายังไง โพสต์นี้มีคำตอบครับ 💡",
    ],
    customer: [
      "เมื่อสัปดาห์ที่ผ่านมามีลูกค้าเอาไปใช้แล้วส่งรูปมาให้ดู ขอบคุณมากๆ นะครับ 🥰",
      "รีวิวจากลูกค้าตัวจริงเสียงจริง เอามาฝากกันครับ ขอบคุณที่ไว้ใจร้านเรา 🙏",
      "ลูกค้าส่งฟีดแบ็กมาว่าใช้ดีมาก ดีใจจนต้องเอามาแชร์เลยครับ ⭐",
    ],
    promo: [
      "ทีมรับปรึกษางาน OEM พร้อมช่วยดูแบบให้เหมาะกับแบรนด์ของคุณ ทักมาคุยกันก่อนได้เลยครับ 💬",
      "โปรดีๆ สำหรับแบรนด์ที่กำลังหาผู้ผลิต สั่งขั้นต่ำไม่เยอะ เริ่มคุยกันก่อนได้ครับ 🎁",
      "รับผลิต OEM ตามแบบที่ลูกค้าต้องการ ราคาโรงงานโดยตรง สนใจทักมาเลยครับ 📩",
    ],
  },
  food: {
    launch: [
      "เมนูใหม่ของร้านมาถึงแล้วครับ 🎉 {name} ที่หลายคนรอ",
      "เปิดตัวแล้วครับ {name} ของใหม่ที่อยากให้ลองสักครั้ง 🍽️",
      "ของใหม่มาแล้วครับ {name} ทำสดใหม่ทุกวัน",
    ],
    behind: [
      "วันนี้พาเข้าครัวไปดูเบื้องหลังกันครับ วัตถุดิบทุกอย่างคัดมาแล้วทั้งนั้น 🙌",
      "กว่าจะได้แต่ละจาน ต้องผ่านมือทีมครัวทุกขั้นตอน วันนี้เก็บภาพมาฝากครับ 👩‍🍳",
      "ครัวเราวันนี้หอมไปหมด พามาดูว่าทำไมถึงอร่อยแบบนี้ครับ 👀",
    ],
    knowhow: [
      "วิธีเก็บให้ยังอร่อยเหมือนวันแรก พร้อมวิธีทานให้ได้รสเต็มๆ มาฝากครับ ✨",
      "ซื้อกลับบ้านแล้วเก็บยังไงไม่ให้เสียรสชาติ อ่านจบทำได้เลยครับ 📌",
      "หลายคนถามว่าทานคู่กับอะไรดี โพสต์นี้รวมคำตอบไว้แล้วครับ 💡",
    ],
    customer: [
      "ลูกค้าส่งรูปกลับมาให้ดูพร้อมคำชม ขอบคุณมากๆ นะครับ 🥰",
      "รีวิวจากลูกค้าตัวจริง เอามาฝากให้อ่านกันครับ 🙏",
      "ลูกค้าบอกว่าอร่อยจนต้องกลับมาซื้อซ้ำ ดีใจมากครับ ⭐",
    ],
    promo: [
      "มีเซตของขวัญพร้อมส่งให้คนสำคัญ ทักมาถามรายละเอียดก่อนได้เลยครับ 🎁",
      "โปรช่วงนี้คุ้มมาก ทั้งเซตทานเองกับเซตฝากเพื่อน ทักมาจองได้เลยครับ 💬",
      "จัดเซตให้ตามงบได้เลยครับ อยากได้แบบไหนบอกกันได้ 📩",
    ],
  },
  service: {
    launch: [
      "คลาสใหม่เปิดรับแล้วครับ 🎉 {name} สำหรับคนที่อยากเริ่ม",
      "เปิดรอบใหม่แล้วครับ {name} ใคร ๆ ก็เริ่มได้ ✨",
      "มีรอบใหม่มาแล้วครับ {name} จำนวนจำกัดนะครับ 🙌",
    ],
    behind: [
      "วันนี้พามาดูเบื้องหลังการเตรียมคลาสของทีมเรา ใส่ใจทุกจุดเลยครับ 🙌",
      "กว่าจะเป็นคลาสหนึ่งคลาส ทีมเราซ้อมและเตรียมกันทุกขั้นตอน วันนี้เก็บภาพมาฝากครับ 🧘",
      "ทีมครูของเราวันนี้พร้อมมาก พามาดูบรรยากาศก่อนเปิดคลาสกันครับ 👀",
    ],
    knowhow: [
      "เทคนิคพื้นฐานที่มือใหม่ก็ทำได้ อ่านจบลองได้เลยครับ ✨",
      "หลายคนทำแล้วเจ็บตัว นี่คือวิธีที่ถูกต้องและปลอดภัยครับ 📌",
      "เริ่มยังไงให้ไม่ท้อ รวมคำแนะนำจากครูของเรามาฝากครับ 💡",
    ],
    customer: [
      "สมาชิกส่งข้อความมาบอกว่าเริ่มแล้วรู้สึกดีขึ้นมาก ขอบคุณที่ไว้ใจครับ 🥰",
      "ฟีดแบ็กจากสมาชิกตัวจริง เอามาแชร์ให้อ่านกันครับ 🙏",
      "สมาชิกที่เริ่มจากศูนย์ตอนนี้ทำได้เองแล้ว ดีใจมากครับ ⭐",
    ],
    promo: [
      "แพ็กเกจเริ่มต้นสำหรับมือใหม่ จองได้ทั้งสัปดาห์ ทักมาถามก่อนได้ครับ 💬",
      "โปรเฉพาะเดือนนี้สำหรับคนที่จองแพ็กเกจเริ่ม ทักมาจองคิวได้เลยครับ 🎁",
      "อยากจัดตารางเรียนให้เข้ากับชีวิต แชทมาคุยกับเราได้เลยครับ 📩",
    ],
  },
  shop: {
    launch: [
      "ของเข้าใหม่ครับ {name} เพิ่งมาถึงร้านเลย 🎉",
      "เข้าร้านแล้วครับ {name} ที่หลายคนถามหา ✨",
      "มาใหม่ครับ {name} จำนวนจำกัดนะครับ 🙌",
    ],
    behind: [
      "วันนี้พามาดูหลังบ้านร้านเรา ตั้งแต่จัดของจนแพ็กส่งให้ทุกคนครับ 🙌",
      "กว่าของจะถึงมือลูกค้า เราตรวจเองทุกชิ้น วันนี้เก็บภาพมาฝากครับ 📦",
      "ร้านเราวันนี้ยุ่งมาก มีของใหม่รอจัด พามาดูบรรยากาศกันครับ 👀",
    ],
    knowhow: [
      "วิธีดูแลให้อยู่กับเรานาน ๆ และวิธีใช้ให้คุ้ม อ่านจบทำได้เลยครับ ✨",
      "ซื้อไปแล้วดูแลยังไงให้ไม่พัง รวมทริคง่าย ๆ มาฝากครับ 📌",
      "วางตรงไหนให้สวยและอยู่ตัว โพสต์นี้มีคำตอบครับ 💡",
    ],
    customer: [
      "ลูกค้าส่งรูปมุมที่บ้านมาให้ดู พร้อมบอกว่าเข้ากับมุมนี้มาก ขอบคุณครับ 🥰",
      "รีวิวจากลูกค้าตัวจริง กับมุมที่เขาเลือกไป เอามาฝากกันครับ 🙏",
      "ลูกค้ากลับมาซื้อซ้ำอีก บอกว่าถูกใจมากครับ ⭐",
    ],
    promo: [
      "จัดเซตให้ตามมุมที่คุณอยากได้ ทักมาถามได้เลยครับ ราคาเริ่มสบาย ๆ 🎁",
      "โปรเดือนนี้ ซื้อคู่คุ้มกว่า ทักมาจองก่อนของหมดได้เลยครับ 💬",
      "อยากได้แบบจัดเซตพร้อมใช้ บอกงบมาได้เลยครับ 📩",
    ],
  },
  generic: {
    launch: [
      "ของใหม่จากเรา มาแล้วครับ {name} 🎉",
      "เพิ่งถึงร้านเลยครับ {name} ใครรออยู่ต้องดู ✨",
      "มาใหม่ครับ {name} ทักมาถามรายละเอียดกันได้เลย 🙌",
    ],
    behind: [
      "วันนี้พามาดูเบื้องหลังการทำงานของเรา ทุกขั้นตอนใส่ใจครับ 🙌",
      "กว่าจะได้มาแต่ละชิ้น ทีมเราต้องผ่านอะไรบ้าง เก็บภาพมาฝากครับ 📷",
      "ที่ทำงานเราวันนี้คึกคักมาก พามาดูบรรยากาศกันครับ 👀",
    ],
    knowhow: [
      "วิธีใช้ให้คุ้มและอยู่กับเรานาน ๆ อ่านจบทำได้เลยครับ ✨",
      "รวมคำถามที่ลูกค้าถามบ่อยไว้ในโพสต์นี้แล้วครับ 📌",
      "หลายคนยังใช้ไม่ถูกวิธี โพสต์นี้มีคำตอบให้ครับ 💡",
    ],
    customer: [
      "ลูกค้าส่งข้อความมาเล่าให้ฟัง ขอบคุณมาก ๆ นะครับ 🥰",
      "ฟีดแบ็กจากลูกค้าตัวจริง เอามาฝากกันครับ 🙏",
      "ลูกค้าบอกว่าถูกใจมาก ดีใจจนต้องมาแชร์ครับ ⭐",
    ],
    promo: [
      "มีข้อเสนอพิเศษช่วงนี้ ทักมาถามรายละเอียดกันก่อนได้เลยครับ 💬",
      "โปรนี้เหมาะกับคนที่กำลังมองหาอยู่พอดี ทักมาได้เลยครับ 🎁",
      "อยากได้แบบไหนบอกกันได้เลยครับ ช่วยดูให้ว่าอะไรคุ้มที่สุด 📩",
    ],
  },
};

// ── closing "tone" lines ─────────────────────────────────────────────────────
// The last line before the hashtags is about the tone of voice, and it used to
// talk about production ("ประเมินราคาและเวลาผลิตให้ฟรี") for every business. The
// goods table is the original one; the other kinds answer what their own
// customers actually ask ("มีรอบไหนบ้าง", "อยากได้รสไหน").

const KIND_TONE_LINES = {
  goods: {
    "เจ้าของแบรนด์": [
      "อยากให้ลองดูของจริงแล้วตัดสินใจเองนะครับ ทักมาคุยกันได้เสมอ",
      "ของดีต้องบอกต่อครับ ลองเปิดใจดูสักชิ้นแล้วจะติดใจ 🤍",
      "ทำเองทุกขั้นตอน มั่นใจในคุณภาพครับ มีอะไรสงสัยทักมาได้เลย 💪",
    ],
    "พนักงานขาย": [
      "สนใจสอบถามรายละเอียดเพิ่มเติม ทักมาได้ทุกวันครับ ยินดีช่วยเลือกให้ครับ 🙏",
      "อยากได้แบบไหนบอกมาได้เลยครับ ช่วยประเมินราคาและเวลาผลิตให้ฟรี 📋",
      "พร้อมให้คำปรึกษาก่อนตัดสินใจครับ ไม่ซื้อไม่เป็นไร ทักมาคุยกันก่อนได้ 🤝",
    ],
    "แอดมินเพจ": [
      "ทักมาแชทได้เลยนะ แอดมินตอบไวมากจ้า 💬",
      "สนใจชิ้นไหนแคปมาจ้า เดี๋ยวแอดมินเช็กสต็อกและราคาให้เลย 📸",
      "มีคำถามอะไรถามได้ตลอดเลยนะ แอดมินอยู่ตอบทั้งวันจ้า ☀️",
    ],
    default: [
      "อยากให้ลองดูของจริงแล้วตัดสินใจเองนะครับ ทักมาคุยกันได้เสมอ",
      "ของดีต้องบอกต่อครับ ลองเปิดใจดูสักชิ้นแล้วจะติดใจ 🤍",
      "ทำเองทุกขั้นตอน มั่นใจในคุณภาพครับ มีอะไรสงสัยทักมาได้เลย 💪",
    ],
  },
  food: {
    "เจ้าของแบรนด์": [
      "อยากให้ได้ลองของที่เราทำเองครับ ทักมาคุยกันได้เสมอ 🤍",
      "ทำเองทุกวัน ตั้งใจทุกชิ้นครับ มีอะไรสงสัยทักมาได้เลย 💪",
    ],
    "พนักงานขาย": [
      "สนใจทักมาถามได้เลยครับ เดี๋ยวเล่าให้ฟังว่าอะไรอร่อยที่สุด 🙏",
      "อยากได้รสไหนหรือจัดแบบไหน บอกมาได้เลยครับ ยินดีช่วยเลือกให้ 🍽️",
      "พร้อมช่วยจัดให้ตามโอกาสครับ ทักมาคุยกันก่อนได้ 🤝",
    ],
    "แอดมินเพจ": [
      "ทักมาแชทได้เลยนะ แอดมินตอบไวมากจ้า 💬",
      "สนใจแคปเมนูมาถามได้เลยจ้า เดี๋ยวแอดมินเช็กคิวให้ 📸",
      "อยากสั่งไว้ล่วงหน้าทักมาได้ตลอดเลยนะ แอดมินอยู่ตอบทั้งวันจ้า ☀️",
    ],
    default: [
      "ของอร่อยต้องบอกต่อครับ ลองดูรายละเอียดก่อนได้เลย 🤍",
      "มีอะไรสงสัยทักมาคุยกันได้เลยครับ ยินดีตอบให้ 💬",
    ],
  },
  service: {
    "เจ้าของแบรนด์": [
      "อยากให้ลองก่อนตัดสินใจครับ ทักมาคุยกับเราได้เสมอ 🤍",
      "เราดูแลทุกคลาสเองครับ มีอะไรสงสัยทักมาได้เลย 💪",
    ],
    "พนักงานขาย": [
      "สนใจรอบไหนบอกมาได้เลยครับ เดี๋ยวช่วยจัดตารางให้ 🙏",
      "อยากเริ่มแบบไหน ทักมาคุยกันก่อนได้ครับ ไม่มีพื้นฐานก็เริ่มได้ 🧘",
      "พร้อมให้คำปรึกษาก่อนตัดสินใจครับ ทักมาคุยกันก่อนได้ 🤝",
    ],
    "แอดมินเพจ": [
      "ทักมาแชทได้เลยนะ แอดมินตอบไวมากจ้า 💬",
      "สนใจรอบไหนแคปตารางมาให้ดูได้เลยจ้า เดี๋ยวแอดมินเช็กคิวให้ 📸",
      "มีคำถามเรื่องคลาสถามได้ตลอดเลยนะ แอดมินอยู่ตอบทั้งวันจ้า ☀️",
    ],
    default: [
      "อยากให้ลองก่อนตัดสินใจครับ ทักมาคุยกันได้เสมอ 🤍",
      "มีอะไรสงสัยทักมาคุยกันได้เลยครับ ยินดีตอบให้ 💬",
    ],
  },
  shop: {
    "เจ้าของแบรนด์": [
      "อยากให้ได้ลองของที่เราคัดเองครับ ทักมาคุยกันได้เสมอ 🤍",
      "คัดเองทุกชิ้นครับ มีอะไรสงสัยทักมาได้เลย 💪",
    ],
    "พนักงานขาย": [
      "สนใจแบบไหนบอกมาได้เลยครับ เดี๋ยวช่วยดูให้เข้ากับมุมของคุณ 🙏",
      "อยากได้แบบจัดเซตพร้อมใช้ บอกงบมาได้เลยครับ 📋",
      "พร้อมช่วยเลือกก่อนตัดสินใจครับ ทักมาคุยกันก่อนได้ 🤝",
    ],
    "แอดมินเพจ": [
      "ทักมาแชทได้เลยนะ แอดมินตอบไวมากจ้า 💬",
      "สนใจชิ้นไหนแคปมาให้ดูได้เลยจ้า เดี๋ยวแอดมินเช็กของให้ 📸",
      "มีคำถามอะไรถามได้ตลอดเลยนะ แอดมินอยู่ตอบทั้งวันจ้า ☀️",
    ],
    default: [
      "ของดีต้องบอกต่อครับ ลองดูรายละเอียดก่อนได้เลย 🤍",
      "มีอะไรสงสัยทักมาคุยกันได้เลยครับ ยินดีตอบให้ 💬",
    ],
  },
  generic: {
    "เจ้าของแบรนด์": [
      "อยากให้ลองก่อนตัดสินใจครับ ทักมาคุยกันได้เสมอ 🤍",
      "เราดูแลเองทุกขั้นตอนครับ มีอะไรสงสัยทักมาได้เลย 💪",
    ],
    "พนักงานขาย": [
      "สนใจแบบไหนบอกมาได้เลยครับ ยินดีช่วยดูให้ 🙏",
      "อยากได้แบบไหนบอกมาได้เลยครับ เดี๋ยวช่วยเลือกให้ 📋",
      "พร้อมให้คำปรึกษาก่อนตัดสินใจครับ ทักมาคุยกันก่อนได้ 🤝",
    ],
    "แอดมินเพจ": [
      "ทักมาแชทได้เลยนะ แอดมินตอบไวมากจ้า 💬",
      "สนใจแบบไหนแคปมาให้ดูได้เลยจ้า เดี๋ยวแอดมินเช็กให้ 📸",
      "มีคำถามอะไรถามได้ตลอดเลยนะ แอดมินอยู่ตอบทั้งวันจ้า ☀️",
    ],
    default: [
      "ของดีต้องบอกต่อครับ ลองดูรายละเอียดก่อนได้เลย 🤍",
      "มีอะไรสงสัยทักมาคุยกันได้เลยครับ ยินดีตอบให้ 💬",
    ],
  },
};

function toneLines(kind, tone) {
  const k = isKind(kind) ? kind : "generic";
  const table = KIND_TONE_LINES[k];
  const wanted = clean(tone);
  if (table[wanted] && table[wanted].length) return [...table[wanted]];
  if (KIND_TONE_LINES.goods[wanted] && KIND_TONE_LINES.goods[wanted].length) return [...KIND_TONE_LINES.goods[wanted]];
  return [...(table.default || KIND_TONE_LINES.goods.default)];
}

// ── default content pillars ──────────────────────────────────────────────────
// Pillar ids stay pl-sell / pl-teach / pl-trust for every kind: they are the
// same three roles (sell / teach / trust) with a client-appropriate name and
// angles, so nothing downstream has to learn a new id.

const KIND_PILLARS = {
  goods: [
    { id: "pl-sell", name: "ขายตรง", angles: ["เปิดตัวสินค้า", "โปรโมชัน/ข้อเสนอ OEM"], weight: 2 },
    { id: "pl-teach", name: "ให้ความรู้", angles: ["เคล็ดลับการใช้งาน"], weight: 2 },
    { id: "pl-trust", name: "สร้างความเชื่อใจ", angles: ["เบื้องหลังการผลิต", "เรื่องจากลูกค้า"], weight: 1 },
  ],
  food: [
    { id: "pl-sell", name: "ขายเมนู", angles: ["เมนูใหม่", "โปรโมชัน/เซตของขวัญ"], weight: 2 },
    { id: "pl-teach", name: "ความรู้เรื่องของกิน", angles: ["วิธีเก็บ/วิธีทาน"], weight: 2 },
    { id: "pl-trust", name: "สร้างความเชื่อใจ", angles: ["เบื้องหลังครัว", "เสียงจากลูกค้า"], weight: 1 },
  ],
  service: [
    { id: "pl-sell", name: "ชวนมาใช้บริการ", angles: ["คลาส/บริการใหม่", "โปรโมชัน/แพ็กเกจ"], weight: 2 },
    { id: "pl-teach", name: "ให้ความรู้", angles: ["ความรู้/วิธีปฏิบัติ"], weight: 2 },
    { id: "pl-trust", name: "สร้างความเชื่อใจ", angles: ["เบื้องหลังทีมงาน", "เสียงจากสมาชิก"], weight: 1 },
  ],
  shop: [
    { id: "pl-sell", name: "ชวนซื้อของ", angles: ["ของเข้าใหม่", "โปรโมชัน/จัดเซต"], weight: 2 },
    { id: "pl-teach", name: "ให้ความรู้", angles: ["วิธีดูแล/วิธีใช้"], weight: 2 },
    { id: "pl-trust", name: "สร้างความเชื่อใจ", angles: ["เบื้องหลังร้าน", "เสียงจากลูกค้า"], weight: 1 },
  ],
  generic: [
    { id: "pl-sell", name: "ขายตรง", angles: ["ของใหม่จากร้าน", "โปรโมชัน/ข้อเสนอพิเศษ"], weight: 2 },
    { id: "pl-teach", name: "ให้ความรู้", angles: ["ความรู้/วิธีใช้"], weight: 2 },
    { id: "pl-trust", name: "สร้างความเชื่อใจ", angles: ["เบื้องหลังการทำงาน", "เสียงจากลูกค้า"], weight: 1 },
  ],
};

// ── hashtags ─────────────────────────────────────────────────────────────────
// Tables keep the categories that already had good copy (bags, cakes, coffee,
// yoga, plants, flowers) and every kind now has its own fallback, so an
// unknown product gets tags that fit the business instead of the factory
// defaults. Order matters: the first table that matches wins.

const KIND_HASHTAGS = {
  goods: {
    tables: [
      [/bag|กระเป๋า/, ["#กระเป๋าผ้า", "#ผลิตกระเป๋า", "#OEMกระเป๋า", "#กระเป๋าสั่งทำ", "#โรงงานกระเป๋า"]],
      [/print|พิมพ์|ปัก|ซิลค์สกรีน|เสื้อ|uniform|ยูนิฟอร์ม/, ["#งานพิมพ์", "#ปักโลโก้", "#ยูนิฟอร์ม", "#ของพรีเมียม", "#งานสั่งทำ"]],
    ],
    fallback: ["#รับผลิต", "#งานสั่งทำ", "#ฝีมือคนไทย", "#ของดีแนะนำ", "#สอบถามได้เลย"],
  },
  food: {
    tables: [
      [/cake|เค้ก/, ["#เค้กสั่งทำ", "#เบเกอรี่บ้านๆ", "#คุกกี้ของขวัญ", "#ขนมฝีมือบ้าน", "#เค้กวันเกิด"]],
      [/cookie|คุกกี้|ขนม|bakery|เบเกอร|croissant|ครัวซอง/, ["#คุกกี้ของขวัญ", "#ขนมฝีมือบ้าน", "#ของอร่อยบอกต่อ", "#กล่องของขวัญ", "#สั่งทำได้"]],
      [/coffee|กาแฟ|เครื่องดื่ม|ชา|drink|tea/, ["#กาแฟคั่วบด", "#กาแฟดอย", "#กาแฟสด", "#ร้านกาแฟ", "#เมล็ดกาแฟ"]],
    ],
    fallback: ["#ของอร่อยบอกต่อ", "#เมนูใหม่", "#กินอะไรดี", "#ร้านน่าติดตาม", "#แวะมาชิม"],
  },
  service: {
    tables: [
      [/yoga|โยคะ|pilates|พิลาทิส|stretch|ยืด/, ["#โยคะ", "#คลาสโยคะ", "#โยคะมือใหม่", "#ออกกำลังกาย", "#สุขภาพดี"]],
      [/fitness|ฟิต|เวท|ยิม|gym|workout/, ["#ออกกำลังกาย", "#เทรนเนอร์", "#สุขภาพดี", "#เริ่มต้นได้เลย", "#คลาสเรียน"]],
    ],
    fallback: ["#คลาสใหม่", "#สุขภาพดี", "#เริ่มต้นได้เลย", "#จองคลาส", "#ของดีบอกต่อ"],
  },
  shop: {
    tables: [
      [/plant|ต้นไม้|กระถาง|monstera|nursery/, ["#ต้นไม้", "#มอนสเตอร่า", "#กระถางสวยๆ", "#ต้นไม้ฟอกอากาศ", "#คนรักต้นไม้"]],
      [/flower|ดอกไม้|ช่อ|bouquet/, ["#ดอกไม้สด", "#ช่อดอกไม้", "#จัดช่อ", "#ของขวัญ", "#ร้านดอกไม้"]],
    ],
    fallback: ["#ของเข้าใหม่", "#ร้านน่าติดตาม", "#ช้อปสบายๆ", "#ของดีบอกต่อ", "#สอบถามได้เลย"],
  },
  generic: {
    tables: [],
    fallback: ["#ของใหม่น่าสนใจ", "#ของดีบอกต่อ", "#ร้านน่าติดตาม", "#โปรโมชัน", "#สอบถามได้เลย"],
  },
};

// The pre-kind behaviour, kept for callers that have no client at hand (and so
// that `templateHashtags(product, platform)` keeps answering what it always
// did when it is called without one).
const LEGACY_HASHTAG_TABLES = [
  [/bag|กระเป๋า/, ["#กระเป๋าผ้า", "#ผลิตกระเป๋า", "#OEMกระเป๋า", "#กระเป๋าสั่งทำ", "#โรงงานกระเป๋า"]],
  [/cake|เค้ก|คุกกี้|ขนม|bakery/, ["#เค้กสั่งทำ", "#เบเกอรี่บ้านๆ", "#คุกกี้ของขวัญ", "#ขนมฝีมือบ้าน", "#เค้กวันเกิด"]],
  [/coffee|กาแฟ/, ["#กาแฟคั่วบด", "#กาแฟดอย", "#กาแฟสด", "#ร้านกาแฟ", "#เมล็ดกาแฟ"]],
  [/yoga|โยคะ|fitness|ฟิต/, ["#โยคะ", "#คลาสโยคะ", "#โยคะมือใหม่", "#ออกกำลังกาย", "#สุขภาพดี"]],
  [/plant|ต้นไม้|กระถาง|monstera/, ["#ต้นไม้", "#มอนสเตอร่า", "#กระถางสวยๆ", "#ต้นไม้ฟอกอากาศ", "#คนรักต้นไม้"]],
];
const LEGACY_HASHTAG_FALLBACK = ["#สั่งทำ", "#ฝีมือคนไทย", "#ของดีแนะนำ", "#ร้านน่าติดตาม", "#ช้อปสบายๆ"];

// How the caption states ordering facts. A factory "ผลิต 30–45 วัน"; a studio
// "เปิดคลาสทุกสัปดาห์" and a bakery "สั่งล่วงหน้า 3 วัน" must not be prefixed
// with the word ผลิต (or the whole sentence reads wrong).
const KIND_ORDER_WORDING = {
  goods: { minimum: "สั่งขั้นต่ำ", production: "ผลิต" },
  food: { minimum: "จำนวนขั้นต่ำ", production: "" },
  service: { minimum: "เริ่มต้น", production: "" },
  shop: { minimum: "เริ่มต้น", production: "" },
  generic: { minimum: "จำนวนขั้นต่ำ", production: "" },
};

// Closing lines for the three ready-made caption examples, per kind — so a yoga
// studio is not invited to ask about "แบบหรือสี" of a class.
const KIND_PRESET_CLOSERS = {
  goods: [
    "สนใจทักมาถามรายละเอียดได้เลยครับ ช่วยดูให้ว่าแบบไหนเหมาะกับงานของคุณ",
    "คอมเมนต์เล่าโจทย์ของคุณมาก่อนได้เลยครับ เดี๋ยวช่วยดูให้ว่าควรเริ่มแบบไหน",
    "คอมเมนต์บอกกันได้เลย หรือทักแชทมาคุยก็ได้ครับ",
  ],
  food: [
    "สนใจทักมาถามรายละเอียดได้เลยครับ เดี๋ยวช่วยเลือกให้ว่าอะไรเหมาะกับโอกาสของคุณ",
    "คอมเมนต์บอกมาก่อนได้เลยครับ อยากให้จัดแบบไหน เดี๋ยวช่วยดูให้",
    "คอมเมนต์บอกกันได้เลยครับ อยากได้รสไหนหรือเซตแบบไหน ทักแชทมาก็ได้",
  ],
  service: [
    "สนใจทักมาถามรายละเอียดได้เลยครับ ช่วยดูให้ว่าคลาสไหนดึงมาะกับคุณ",
    "คอมเมนต์เล่าเป้าหมายของคุณมาก่อนได้เลยครับ เดี๋ยวช่วยดูว่าควรเริ่มคลาสแบบไหน",
    "คอมเมนต์บอกกันได้เลยครับ อยากเริ่มจากตรงไหน หรือจะทักแชทมาคุยก่อนก็ได้",
  ],
  shop: [
    "สนใจทักมาถามรายละเอียดได้เลยครับ ช่วยดูให้ว่าแบบไหนเข้ากับมุมของคุณ",
    "คอมเมนต์เล่ามุมที่คุณจะวางก่อนได้เลยครับ เดี๋ยวช่วยดูให้ว่าเลือกแบบไหนดี",
    "คอมเมนต์บอกกันได้เลยครับ อยากได้สไตล์ไหน หรือทักแชทมาถามก็ได้",
  ],
  generic: [
    "สนใจทักมาถามรายละเอียดได้เลยครับ ยินดีช่วยดูให้ครับ",
    "คอมเมนต์เล่าโจทย์ของคุณมาก่อนได้เลยครับ เดี๋ยวช่วยดูให้ว่าควรเริ่มแบบไหน",
    "คอมเมนต์บอกกันได้เลยครับ หรือทักแชทมาคุยก็ได้",
  ],
};

// ── helpers ──────────────────────────────────────────────────────────────────

const isKind = (kind) => Boolean(KIND_LABELS[kind]);
const clean = (value) => String(value === undefined || value === null ? "" : value);

function globalize(re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return new RegExp(re.source, flags);
}

// Distinct keywords matched, not raw occurrences: "กาแฟ…กาแฟ" counts once.
function hitCount(re, text) {
  const found = new Set();
  for (const match of clean(text).matchAll(globalize(re))) found.add(match[0].toLowerCase());
  return found.size;
}

/** Every angle label any kind uses — the validation superset. */
function allAngles() {
  const out = [];
  for (const kind of ANGLE_KIND_ORDER) {
    for (const entry of KIND_ANGLES[kind]) if (!out.includes(entry.angle)) out.push(entry.angle);
  }
  return out;
}

/** The five angle labels this kind is planned with (role order preserved). */
function anglesForKind(kind) {
  return KIND_ANGLES[isKind(kind) ? kind : "generic"].map((entry) => entry.angle);
}

function kindLabel(kind) {
  return KIND_LABELS[isKind(kind) ? kind : "generic"];
}

/**
 * Which business is this client in? `client.contentKind` is the operator's
 * explicit choice ("auto" or a kind) and always wins; otherwise the industry
 * and the product list are scored.
 */
function detectContentKind(client) {
  const explicit = clean(client?.contentKind).trim().toLowerCase();
  if (isKind(explicit)) return explicit;
  const industry = clean(client?.industry);
  const products = Array.isArray(client?.products) ? client.products : [];
  const scores = new Map();
  const bump = (kind, points) => { if (points > 0) scores.set(kind, (scores.get(kind) || 0) + points); };
  for (const kind of KINDS) {
    const re = KIND_MATCHERS[kind];
    if (!re) continue;
    bump(kind, hitCount(re, industry) * 3);
    for (const product of products) {
      bump(kind, hitCount(re, product?.category) * 2);
      bump(kind, hitCount(re, product?.name) * 1);
    }
  }
  let best = "generic";
  let bestScore = 0;
  for (const kind of [...DETECT_PRIORITY, "generic"]) {
    const score = scores.get(kind) || 0;
    if (score > bestScore) { best = kind; bestScore = score; }
  }
  return best;
}

/** Role of an angle label — the client's own kind first, then any kind. */
function roleOfAngle(angle, kind) {
  const want = clean(angle);
  if (!want) return null;
  const order = isKind(kind) ? [kind, ...KINDS.filter((k) => k !== kind)] : KINDS;
  for (const k of order) {
    const hit = KIND_ANGLES[k].find((entry) => entry.angle === want);
    if (hit) return hit.role;
  }
  return null;
}

/** English SD style phrase for an angle, per kind (falls back by role). */
function angleImagePrompt(angle, kind) {
  const k = isKind(kind) ? kind : "generic";
  const hit = KIND_ANGLES[k].find((entry) => entry.angle === clean(angle));
  if (hit) return hit.image;
  const role = roleOfAngle(angle, k);
  const byRole = KIND_ANGLES[k].find((entry) => entry.role === role);
  return byRole ? byRole.image : "elegant studio product showcase";
}

function captionLeads(kind, role) {
  const k = isKind(kind) ? kind : "generic";
  const table = KIND_LEADS[k];
  const leads = table[role] || table.launch;
  return [...leads];
}

function pillarsForKind(kind, now = new Date().toISOString()) {
  const k = isKind(kind) ? kind : "generic";
  return KIND_PILLARS[k].map((pillar) => ({ ...pillar, angles: [...pillar.angles], createdAt: now }));
}

/**
 * True when a client still carries the untouched legacy default pillars (the
 * three factory-flavoured ones shipped before kinds existed). Only then is it
 * safe to swap them for the client's own kind — a pillar the operator edited
 * is never overwritten.
 */
function isLegacyDefaultPillars(pillars) {
  const list = Array.isArray(pillars) ? pillars : [];
  const legacy = KIND_PILLARS.goods;
  if (list.length !== legacy.length) return false;
  return legacy.every((want, i) => {
    const got = list[i] || {};
    const angles = Array.isArray(got.angles) ? got.angles : [];
    return clean(got.name) === want.name
      && Number(got.weight) === want.weight
      && angles.length === want.angles.length
      && want.angles.every((a) => angles.includes(a));
  });
}

/**
 * The rotation pool for one month: the client's pillar angles, each repeated by
 * its pillar's weight, so a weight-3 pillar really does fill three times as
 * many slots. `only` (the calendar's angle picker) narrows the pool to the
 * angles the operator ticked. Repeats are intentional — dedupe at the call
 * site when a plain list is needed.
 */
function planAnglesFor(client, only) {
  const kind = detectContentKind(client);
  const kindAngles = anglesForKind(kind);
  const allowed = new Set(allAngles());
  const wanted = (Array.isArray(only) ? only : []).map(clean).filter((a) => allowed.has(a));
  const filter = wanted.length ? new Set(wanted) : null;
  const pillars = Array.isArray(client?.pillars) && client.pillars.length ? client.pillars : pillarsForKind(kind, "");
  // An angle's weight is the sum of the pillars that claim it, capped at 5 —
  // the same 1–5 scale a pillar carries.
  const weights = new Map();
  const order = [];
  for (const pillar of pillars) {
    const weight = Math.min(5, Math.max(1, Number(pillar?.weight) || 1));
    const angles = Array.isArray(pillar?.angles) && pillar.angles.length ? pillar.angles : kindAngles;
    for (const angle of angles) {
      if (!allowed.has(angle)) continue;
      if (filter && !filter.has(angle)) continue;
      if (!weights.has(angle)) { weights.set(angle, 0); order.push(angle); }
      weights.set(angle, Math.min(5, weights.get(angle) + weight));
    }
  }
  // Weights are spent ROUND BY ROUND (not in one block per pillar) so two
  // consecutive days never land on the same angle: launch, promo, knowhow,
  // trust… then a second pass of whatever carries weight 2+.
  const pool = [];
  const heaviest = order.reduce((max, angle) => Math.max(max, weights.get(angle)), 0);
  for (let round = 1; round <= heaviest; round += 1) {
    for (const angle of order) if (weights.get(angle) >= round) pool.push(angle);
  }
  if (pool.length) return pool;
  return filter ? wanted : [...kindAngles];
}

/** What the calendar shows the operator: which angles this client plans with. */
function angleOptionsFor(client) {
  const kind = detectContentKind(client);
  const pillars = Array.isArray(client?.pillars) && client.pillars.length ? client.pillars : pillarsForKind(kind, "");
  const rows = new Map();
  for (const pillar of pillars) {
    const weight = Math.min(5, Math.max(1, Number(pillar?.weight) || 1));
    for (const angle of (Array.isArray(pillar?.angles) ? pillar.angles : [])) {
      const row = rows.get(angle) || { angle, pillars: [], weight: 0 };
      if (!row.pillars.includes(pillar.name)) row.pillars.push(pillar.name);
      row.weight += weight;
      rows.set(angle, row);
    }
  }
  const fromPillars = [...rows.values()];
  const covered = new Set(fromPillars.map((row) => row.angle));
  const rest = anglesForKind(kind).filter((angle) => !covered.has(angle)).map((angle) => ({ angle, pillars: [], weight: 0 }));
  return {
    kind,
    kindLabel: kindLabel(kind),
    angles: anglesForKind(kind),
    options: [...fromPillars, ...rest],
  };
}

/** Hashtags for a product, chosen by the client's kind. */
function hashtagsForKind(kind, product) {
  const k = isKind(kind) ? kind : "generic";
  const profile = KIND_HASHTAGS[k];
  const category = clean(product?.category).toLowerCase();
  const name = clean(product?.name);
  const hit = profile.tables.find(([re]) => re.test(category) || re.test(name));
  return [...(hit ? hit[1] : profile.fallback)];
}

/** Hashtags as they were before kinds existed (no client at hand). */
function legacyHashtags(product) {
  const category = clean(product?.category).toLowerCase();
  const name = clean(product?.name);
  const hit = LEGACY_HASHTAG_TABLES.find(([re]) => re.test(category) || re.test(name));
  return [...(hit ? hit[1] : LEGACY_HASHTAG_FALLBACK)];
}

function orderWording(kind) {
  return KIND_ORDER_WORDING[isKind(kind) ? kind : "generic"];
}

function presetClosers(kind) {
  return [...KIND_PRESET_CLOSERS[isKind(kind) ? kind : "generic"]];
}

module.exports = {
  KINDS,
  KIND_LABELS,
  KIND_ANGLES,
  KIND_LEADS,
  KIND_PILLARS,
  KIND_HASHTAGS,
  detectContentKind,
  allAngles,
  anglesForKind,
  isKind,
  kindLabel,
  roleOfAngle,
  angleImagePrompt,
  captionLeads,
  KIND_TONE_LINES,
  toneLines,
  pillarsForKind,
  isLegacyDefaultPillars,
  planAnglesFor,
  angleOptionsFor,
  hashtagsForKind,
  legacyHashtags,
  orderWording,
  presetClosers,
};
