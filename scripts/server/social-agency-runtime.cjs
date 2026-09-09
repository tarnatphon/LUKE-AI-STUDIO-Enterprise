const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const seedProducts = [
  {
    sku: "CAM-009",
    name: "กระเป๋ากล้อง CAM-009",
    category: "Camera bags",
    minimumOrder: "100–200 ใบ",
    productionTime: "30–45 วัน",
    decoration: "ซิลค์สกรีน, โลโก้ยาง, ปัก, ป้ายทอ",
    status: "verified-source",
    sourceUrl:
      "https://www.thaimodernbags.com/รายการสินค้าและผลิตภัณฑ์กระเป๋า/กระเป๋ากล้อง/ผลิตภัณฑ์/กระเป๋ากล้อง-cam-009.html"
  },
  {
    sku: "SGB-012",
    name: "กระเป๋าเชือกรูด SGB-012",
    category: "Drawstring bags",
    minimumOrder: "100–200 ใบ",
    productionTime: "30–45 วัน",
    decoration: "ซิลค์สกรีน, โลโก้ยาง, ปัก, ป้ายทอ",
    status: "verified-source",
    sourceUrl:
      "https://www.thaimodernbags.com/รายการสินค้าและผลิตภัณฑ์กระเป๋า/กระเป๋าเชือกรูด/ผลิตภัณฑ์/กระเป๋าเชือกรูด-sgb-012.html"
  }
];

class SocialAgencyRuntime {
  constructor({ root }) {
    this.filePath = path.join(
      root,
      "app",
      "runtime-state",
      "social-agency",
      "thai-modern-bags.json"
    );
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return {
        version: 1,
        client: {
          id: "thai-modern-bags",
          name: "Thai Modern Bags Co.,Ltd.",
          website: "https://www.thaimodernbags.com"
        },
        products: seedProducts,
        drafts: [],
        selectionHistory: [],
        createdAt: new Date().toISOString()
      };
    }
  }

  write(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }

  getState() {
    return this.read();
  }

  createDailyDraft() {
    const state = this.read();

    const recent = new Set(
      state.selectionHistory.slice(-14).map((item) => item.sku)
    );

    const eligible = state.products.filter(
      (item) => item.status === "verified-source" && !recent.has(item.sku)
    );

    const candidates = eligible.length
      ? eligible
      : state.products.filter(
          (item) => item.status === "verified-source"
        );

    if (!candidates.length) {
      throw new Error("No verified product is eligible for a daily draft.");
    }

    const product =
      candidates[Math.floor(Math.random() * candidates.length)];

    const draft = {
      id: crypto.randomUUID(),
      sku: product.sku,
      productName: product.name,
      sourceUrl: product.sourceUrl,
      status: "needs-approval",
      evidence: "verified-source",
      createdAt: new Date().toISOString(),
      caption: `${product.name}

ออกแบบให้เหมาะกับแบรนด์ การใช้งาน และงบประมาณของคุณ พร้อมเลือกการตกแต่งโลโก้ได้

ขั้นต่ำ ${product.minimumOrder} · ระยะเวลาผลิต ${product.productionTime}

ทักเพื่อขอคำแนะนำและใบเสนอราคา`
    };

    state.drafts.unshift(draft);
    state.selectionHistory.push({
      sku: product.sku,
      selectedAt: draft.createdAt
    });

    this.write(state);
    return draft;
  }

  updateDraftStatus(id, status) {
    if (!["needs-approval", "approved", "rejected"].includes(status)) {
      throw new Error("Unsupported draft status.");
    }

    const state = this.read();
    const draft = state.drafts.find((item) => item.id === id);

    if (!draft) {
      throw new Error("Draft not found.");
    }

    draft.status = status;
    draft.updatedAt = new Date().toISOString();

    this.write(state);
    return draft;
  }
}

module.exports = { SocialAgencyRuntime };
