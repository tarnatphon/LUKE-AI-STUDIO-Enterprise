import { useEffect, useState } from "react";
import { Package, Plus, Trash2, Globe, FolderOpen, Link2, Wand2, ImagePlus, ImageOff, Upload } from "lucide-react";
import { api, postJson } from "./lib.js";

// ── product image helpers ───────────────────────────────────────────────────
// Downscale an uploaded photo to a compact data URL (640px JPEG) so it fits
// the 1MB JSON body limit and stores as a lightweight thumbnail.
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    r.readAsDataURL(file);
  });
}

async function fileToProductImage(file) {
  if (!file) throw new Error("ไม่พบไฟล์");
  if (file.size > 25 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกินไป (สูงสุด 25MB)");
  const type = String(file.type || "").toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(type)) throw new Error("รับเฉพาะไฟล์รูป PNG/JPEG/WebP/GIF");
  if (type === "image/gif" && file.size <= 900 * 1024) return readAsDataUrl(file); // keep small GIFs intact
  const dataUrl = await readAsDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("ไฟล์รูปไม่ถูกต้อง"));
    i.src = dataUrl;
  });
  const maxDim = 640;
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
  if (scale >= 1 && file.size <= 400 * 1024 && type === "image/png") return dataUrl; // small PNG: keep as-is
  const w = Math.max(1, Math.round((img.width || maxDim) * scale));
  const h = Math.max(1, Math.round((img.height || maxDim) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  return out.length > 1024 * 1024 ? canvas.toDataURL("image/jpeg", 0.7) : out;
}

// Thumbnail with graceful fallback: missing → dashed placeholder (click to add),
// unloadable (404 / blocked / offline) → broken placeholder hinting a fix.
function ProductThumb({ src, onPick, small = false, title }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const cls = `sa-prod-thumb${small ? " sm" : ""}${!src || broken ? " placeholder" : ""}${broken ? " broken" : ""}`;
  const inner = src && !broken
    ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
    : broken ? <ImageOff size={small ? 13 : 16} /> : <ImagePlus size={small ? 13 : 16} />;
  if (!onPick) return <span className={cls} title={title || (broken ? "รูปโหลดไม่ได้" : "ไม่มีรูป")}>{inner}</span>;
  return (
    <button
      type="button"
      className={cls}
      onClick={onPick}
      title={title || (broken ? "รูปโหลดไม่ได้ — คลิกเพื่อแก้ (อัปโหลดใหม่ หรือใช้ลิงก์อื่น)" : src ? "คลิกเพื่อเปลี่ยนรูปสินค้า" : "เพิ่มรูปสินค้า")}
      aria-label={broken ? "แก้รูปสินค้า" : "รูปสินค้า"}
    >
      {inner}
    </button>
  );
}

// Inline editor: upload a file (auto-downscaled) / paste a URL / remove.
function ProductImageEditor({ product, clientId, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [urlInput, setUrlInput] = useState(/^https?:/i.test(product.image || "") ? product.image : "");
  const patch = async (image) => {
    setBusy(true);
    setErr("");
    try {
      await postJson(`/api/social-agency/products/${encodeURIComponent(product.sku)}?clientId=${encodeURIComponent(clientId)}`, { image });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await patch(await fileToProductImage(file));
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <div className="sa-prod-img-editor">
      <label className={`sa-btn primary sm${busy ? " disabled" : ""}`}>
        <Upload size={13} /> {busy ? "กำลังบันทึก…" : "อัปโหลดรูป"}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pickFile} disabled={busy} />
      </label>
      <input
        placeholder="หรือวางลิงก์รูป https://…"
        value={urlInput}
        onChange={(e) => setUrlInput(e.target.value)}
        disabled={busy}
        onKeyDown={(e) => { if (e.key === "Enter" && /^https?:\/\//i.test(urlInput.trim())) patch(urlInput.trim()); }}
      />
      <button className="sa-btn sm" disabled={busy || !/^https?:\/\//i.test(urlInput.trim())} onClick={() => patch(urlInput.trim())}>ใช้ลิงก์นี้</button>
      {product.image ? <button className="sa-btn ghost sm danger" disabled={busy} onClick={() => patch("")}>ลบรูป</button> : null}
      <button className="sa-btn ghost sm" disabled={busy} onClick={onClose}>ปิด</button>
      {err && <p className="sa-form-error">{err}</p>}
      <p className="sa-form-hint">รูปที่อัปโหลดจะถูกย่อเหลือไม่เกิน 640px และเก็บในเครื่อง (app/outputs/sa-products) — ใช้กับเวิร์กโฟลว์อัตโนมัติได้ทันที</p>
    </div>
  );
}

// same rule the server uses: spec-sheet / asset links are not product pages
const JUNK_LINK_RE = /\/(?:product\/)?download\/|file_id[-=]|\.(?:pdf|docx?|pptx?|xlsx?|zip|rar|jpg|jpeg|png|webp)(?:$|\?)/i;
const linkIsProductPage = (u) => {
  const raw = String(u || "").trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  let d = raw;
  try { d = decodeURIComponent(raw); } catch { /* keep raw */ }
  return !JUNK_LINK_RE.test(d);
};

export default function ProductsTab({ activeClient, refreshKey, onChanged }) {
  const clientId = activeClient?.id;
  const products = activeClient?.products || [];
  const [form, setForm] = useState({ name: "", sku: "", category: "", price: "", sourceUrl: "", image: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlFound, setUrlFound] = useState(null);
  const [urlSel, setUrlSel] = useState([]);
  const [sampleBusy, setSampleBusy] = useState(false); // P5w: สุ่มสินค้าจากหน้าแคตตาล็อกสำหรับ 1 โพสต์/วัน
  const [deep, setDeep] = useState(false);
  const [folder, setFolder] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanFound, setScanFound] = useState(null);
  const [scanSel, setScanSel] = useState([]);
  const [delSel, setDelSel] = useState([]);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [fixBusy, setFixBusy] = useState(false);
  const [imgEditSku, setImgEditSku] = useState(null);
  const urlCount = products.filter((p) => /^https?:\/\//i.test(String(p.sourceUrl || ""))).length;
  const badLinkCount = products.filter((p) => !String(p.detail || "").trim() && !linkIsProductPage(p.sourceUrl)).length;

  useEffect(() => {
    setUrl(activeClient?.website || "");
    setUrlFound(null);
    setUrlSel([]);
    setScanFound(null);
    setScanSel([]);
    setNote("");
    setError("");
    setImgEditSku(null);
  }, [clientId]);

  const toggleSel = (setter) => (i) => () =>
    setter((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));

  const addManual = async () => {
    if (!clientId || saving) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      await postJson(`/api/social-agency/products?clientId=${encodeURIComponent(clientId)}`, {
        name: form.name.trim(),
        sku: form.sku.trim() || undefined,
        category: form.category.trim() || undefined,
        price: form.price.trim() || undefined,
        sourceUrl: form.sourceUrl.trim() || undefined,
        image: /^https?:\/\//i.test(form.image.trim()) ? form.image.trim() : undefined,
      });
      setForm({ name: "", sku: "", category: "", price: "", sourceUrl: "", image: "" });
      setNote("เพิ่มสินค้าแล้ว ✓");
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeProduct = async (sku) => {
    if (!window.confirm(`ลบสินค้า ${sku} ?\nโพสต์ที่ใช้ SKU นี้จะยังอยู่ แต่จะอ้างสินค้าเดิมไม่ได้`)) return;
    setError("");
    setNote("");
    try {
      const data = await api(
        `/api/social-agency/products/${encodeURIComponent(sku)}?clientId=${encodeURIComponent(clientId)}`,
        { method: "DELETE" }
      );
      setNote(data.orphanEntries ? `ลบแล้ว (มี ${data.orphanEntries} โพสต์ที่ใช้ SKU นี้)` : "ลบสินค้าแล้ว ✓");
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchUrl = async () => {
    if (!clientId || urlBusy || !url.trim()) return;
    setUrlBusy(true);
    setError("");
    setNote("");
    try {
      const data = await postJson(`/api/social-agency/products/import-url?clientId=${encodeURIComponent(clientId)}`, {
        url: url.trim(),
        maxPages: 5,
        deep,
      });
      setUrlFound(data);
      setUrlSel((data.products || []).map((_, i) => i));
    } catch (err) {
      setError(err.message);
      setUrlFound(null);
    } finally {
      setUrlBusy(false);
    }
  };

  const sampleFromCatalog = async () => {
    if (!clientId || sampleBusy || urlBusy || !url.trim()) return;
    setSampleBusy(true);
    setError("");
    setNote("");
    try {
      const data = await postJson(`/api/social-agency/products/sample-catalog?clientId=${encodeURIComponent(clientId)}`, {
        url: url.trim(),
        days: 31,
        maxPages: 4,
        autoImport: true,
      });
      setUrlFound(null);
      setUrlSel([]);
      const bits = [`สุ่มเข้าคลัง ${data.importedCount} รายการจาก ${data.found} ที่เจอ (${data.pages} หน้า)`];
      if (data.alreadyInCatalog) bits.push(`มีอยู่แล้ว ${data.alreadyInCatalog}`);
      if (data.importSkipped) bits.push(`ข้าม ${data.importSkipped}`);
      if (data.errors) bits.push(`อ่านหน้าไม่สำเร็จ ${data.errors}`);
      bits.push(data.shortBy
        ? `คลังมี ${data.productPool} สินค้า — ยังขาดอีก ${data.shortBy} ตัวถึงจะครบวันละ 1 ชิ้นทั้งเดือน`
        : `คลังมี ${data.productPool} สินค้า เพียงพอสำหรับวันละ 1 ชิ้น ✓`);
      setNote(`${bits.join(" · ")} — กด “วางแผนอัตโนมัติทั้งเดือน” ที่แท็บ ปฏิทิน ต่อได้เลย`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSampleBusy(false);
    }
  };

  const fetchAndImportAll = async () => {
    if (!clientId || urlBusy || !url.trim()) return;
    setUrlBusy(true);
    setError("");
    setNote("");
    try {
      const data = await postJson(`/api/social-agency/products/import-url?clientId=${encodeURIComponent(clientId)}`, {
        url: url.trim(),
        maxPages: 5,
        deep,
      });
      const found = data.products || [];
      if (!found.length) {
        setNote("ไม่เจอสินค้าในเว็บนี้ — ลองวางลิงก์หน้าสินค้าโดยตรง");
        return;
      }
      const res = await postJson(`/api/social-agency/products/import?clientId=${encodeURIComponent(clientId)}`, {
        products: found,
      });
      setUrlFound(null);
      setUrlSel([]);
      setNote(`นำเข้า ${res.count} รายการ ✓${res.skipped ? ` (ข้าม ${res.skipped})` : ""}`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setUrlBusy(false);
    }
  };

  const scan = async () => {
    if (!clientId || scanBusy || !folder.trim()) return;
    setScanBusy(true);
    setError("");
    setNote("");
    try {
      const data = await postJson(`/api/social-agency/products/scan-folder?clientId=${encodeURIComponent(clientId)}`, {
        path: folder.trim(),
      });
      setScanFound(data);
      const n = (data.images || []).length + (data.rows || []).length;
      setScanSel(Array.from({ length: n }, (_, i) => i));
    } catch (err) {
      setError(err.message);
      setScanFound(null);
    } finally {
      setScanBusy(false);
    }
  };

  const scanAndImportAll = async () => {
    if (!clientId || scanBusy || !folder.trim()) return;
    setScanBusy(true);
    setError("");
    setNote("");
    try {
      const data = await postJson(`/api/social-agency/products/scan-folder?clientId=${encodeURIComponent(clientId)}`, {
        path: folder.trim(),
      });
      const found = [...(data.images || []), ...(data.rows || [])];
      if (!found.length) {
        setNote("ไม่เจอรูปหรือตารางสินค้าในโฟลเดอร์นี้");
        return;
      }
      const res = await postJson(`/api/social-agency/products/import?clientId=${encodeURIComponent(clientId)}`, {
        products: found,
      });
      setScanFound(null);
      setScanSel([]);
      setNote(`นำเข้า ${res.count} รายการ ✓${res.skipped ? ` (ข้าม ${res.skipped})` : ""}`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setScanBusy(false);
    }
  };

  const missingCount = products.filter((p) => !String(p.detail || "").trim() && linkIsProductPage(p.sourceUrl)).length;

  const runEnrich = async (overwrite) => {
    const target = overwrite ? urlCount : missingCount;
    if (!clientId || enrichBusy || !target) return;
    setEnrichBusy(true);
    setError("");
    setNote("");
    try {
      let total = 0;
      let failed = 0;
      let remaining = target;
      let rounds = 0;
      let firstReason = "";
      let unchanged = 0;
      let mismatched = [];
      let badLink = 0;
      do {
        rounds += 1;
        const data = await postJson(`/api/social-agency/products/enrich?clientId=${encodeURIComponent(clientId)}`, {
          limit: 10,
          ...(overwrite ? { overwrite: true } : {}),
        });
        total += data.enrichedCount || 0;
        unchanged += data.unchangedCount || 0;
        if (Array.isArray(data.mismatch)) mismatched = mismatched.concat(data.mismatch);
        badLink += data.skippedLinkCount || 0;
        failed += (data.failed || []).length;
        if (!firstReason && data.failed && data.failed[0] && data.failed[0].error) firstReason = data.failed[0].error;
        remaining = typeof data.remaining === "number" ? data.remaining : 0;
        setNote(`กำลังเติมคำอธิบาย… ได้แล้ว ${total} รายการ${remaining ? ` · เหลืออีก ${remaining}` : ""}`);
        onChanged?.();
      } while (remaining > 0 && rounds < 25);
      setNote(`เติมคำอธิบายแล้ว ${total} รายการ ✓${unchanged ? ` · เท่าเดิม ${unchanged}` : ""}${mismatched.length ? ` · ข้อความในเว็บไม่ตรงโค้ดสินค้า ${mismatched.length} แถว (${mismatched.map((m) => `${m.sku}: meta ${m.meta} → ${m.used}`).join("; ")})` : ""}${badLink ? ` · อีก ${badLink} แถวลิงก์ไม่ใช่หน้าสินค้า (กด "แก้ลิงก์สินค้า" ก่อน)` : ""}${failed ? ` · ไม่ได้ ${failed} รายการ${firstReason ? ` (${firstReason})` : ""}` : ""}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnrichBusy(false);
    }
  };

  const enrichMissing = () => runEnrich(false);
  const enrichAllOverwrite = () => runEnrich(true);

  const deleteSelectedProducts = async () => {
    if (!delSel.length || saving) return;
    if (!window.confirm(`ลบสินค้า ${delSel.length} รายการที่เลือก?\nโพสต์ที่อ้าง SKU เหล่านี้จะยังอยู่ (กลายเป็น orphan)`)) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      const data = await postJson(`/api/social-agency/products/delete-batch?clientId=${encodeURIComponent(clientId)}`, { skus: delSel });
      setDelSel([]);
      setNote(`ลบแล้ว ${data.deleted.length} รายการ ✓${data.orphans ? ` (มี ${data.orphans} โพสต์ที่อ้าง SKU เหล่านี้)` : ""}${(data.notFound || []).length ? ` · ไม่พบ ${(data.notFound || []).length}` : ""}`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const fixLinks = async () => {
    if (!clientId || fixBusy || !urlCount) return;
    setFixBusy(true);
    setError("");
    setNote("");
    try {
      const data = await postJson(`/api/social-agency/products/fix-links?clientId=${encodeURIComponent(clientId)}`, {});
      setNote(`แก้ลิงก์แล้ว ${data.fixed} รายการ ✓${data.cleaned ? ` · ล้าง ?limitstart/หน้าเลขที่ทิ้ง ${data.cleaned} ลิงก์` : ""}${data.relinkedByCodeCount ? ` (กู้ตามโค้ดสินค้า ${data.relinkedByCodeCount} แถว แล้วกด "เติมคำอธิบายที่ขาด" ต่อ)` : ""}${data.unfound?.length ? ` · หาไม่เจอ ${data.unfound.length}` : ""}${data.remaining ? ` · เหลืออีก ${data.remaining} หน้า — กดซ้ำได้` : ""}`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setFixBusy(false);
    }
  };

  const importSelected = async (kind) => {
    const pool = kind === "url" ? urlFound?.products || [] : [...(scanFound?.images || []), ...(scanFound?.rows || [])];
    const sel = kind === "url" ? urlSel : scanSel;
    const picked = sel.map((i) => pool[i]).filter(Boolean);
    if (!picked.length) return;
    setSaving(true);
    setError("");
    try {
      const data = await postJson(`/api/social-agency/products/import?clientId=${encodeURIComponent(clientId)}`, {
        products: picked,
      });
      if (kind === "url") {
        setUrlFound(null);
        setUrlSel([]);
      } else {
        setScanFound(null);
        setScanSel([]);
      }
      setNote(`นำเข้า ${data.count} รายการ ✓${data.skipped ? ` (ข้าม ${data.skipped})` : ""}`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!clientId) return <div className="sa-style"><p className="sa-muted">ยังไม่ได้เลือกลูกค้า</p></div>;

  return (
    <div className="sa-style">
      {error && <p className="sa-error-banner">{error}</p>}
      {note && <p className="sa-muted">{note}</p>}

      <section className="sa-style-card">
        <header>
          <Package size={15} />
          <b>สินค้าของ {activeClient.name}</b>
          <span className="sa-muted">
            {products.length} รายการ · วางแผนอัตโนมัติจะวนใช้ทุกตัว
            {badLinkCount > 0 && (
              <> · <b style={{ color: "#c2410c" }}>{badLinkCount} แถวลิงก์ไม่ใช่หน้าสินค้า</b> (ต้องกด "แก้ลิงก์สินค้า" ก่อนถึงเติมคำอธิบายได้)</>
            )}
          </span>
          <label className="sa-check" title="เลือกทั้งหมด / ไม่เลือกเลย">
            <input type="checkbox" checked={products.length > 0 && delSel.length === products.length} onChange={(e) => setDelSel(e.target.checked ? products.map((p) => p.sku) : [])} /> เลือกทั้งหมด
          </label>
          {delSel.length > 0 && (
            <button className="sa-btn ghost sm danger" disabled={saving} onClick={deleteSelectedProducts}>
              <Trash2 size={13} /> ลบที่เลือก ({delSel.length})
            </button>
          )}
          {missingCount > 0 && (
            <button className="sa-btn sm" disabled={enrichBusy || saving} onClick={enrichMissing} title="เปิดหน้าใบสินค้าทีละ 10 แถว แล้วดึงคำอธิบายมาเติม — กดครั้งเดียวระบบทำต่อเองจนครบ (แถวที่ลิงก์เป็นหน้าไฟล์/หน้าหมวดจะถูกข้ามพร้อมเหตุผล)">
              {enrichBusy ? "กำลังเติม…" : `เติมคำอธิบายที่ขาด (${missingCount})`}
            </button>
          )}
          {urlCount > 0 && missingCount < urlCount && (
            <button className="sa-btn ghost sm" disabled={enrichBusy || saving} onClick={enrichAllOverwrite} title="ดึงใหม่ทุกแถวแล้วเขียนทับคำอธิบายเดิม (ใช้ตอนลิงก์เพิ่งถูกแก้ / คำอธิบายเดิมเป็นของคนละสินค้า)">
              {enrichBusy ? "กำลังเติม…" : "เติมทับทุกแถว"}
            </button>
          )}
          {urlCount > 0 && (
            <button className="sa-btn ghost sm" disabled={fixBusy || saving} onClick={fixLinks} title="ถ้าลิงก์แหล่งที่มาชี้ไปหน้าหมวดหรือหน้าดาวน์โหลดไฟล์ จะหาลิงก์ใบสินค้าที่ถูกต้องให้เองจากโค้ดสินค้า (ครั้งละ 10 หน้า + คลานหน้าหมวดไม่เกิน 4 หน้า)">
              {fixBusy ? "กำลังแก้ลิงก์…" : <><Link2 size={13} /> แก้ลิงก์สินค้า ({urlCount})</>}
            </button>
          )}
        </header>
        <ul className="sa-style-shots">
          {products.map((p) => (
            <li key={p.sku} className="sa-style-shot">
              <div className="sa-style-shot-head">
                <input type="checkbox" checked={delSel.includes(p.sku)} onChange={(e) => setDelSel(e.target.checked ? [...delSel.filter((s) => s !== p.sku), p.sku] : delSel.filter((s) => s !== p.sku))} aria-label={`เลือก ${p.name}`} />
                <ProductThumb src={p.image} onPick={() => setImgEditSku(imgEditSku === p.sku ? null : p.sku)} />
                <b>{p.name}</b>
                <span className="sa-muted">{p.sku} · {p.category}{p.price ? ` · ${p.price}` : ""}</span>
                {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="sa-muted">ลิงก์</a>}
                <span style={{ flex: 1 }} />
                <button className="sa-icon-btn sm danger" title="ลบสินค้า" onClick={() => removeProduct(p.sku)}>
                  <Trash2 size={13} />
                </button>
              </div>
              {imgEditSku === p.sku && (
                <ProductImageEditor
                  product={p}
                  clientId={clientId}
                  onClose={() => setImgEditSku(null)}
                  onSaved={() => { setImgEditSku(null); setNote(`บันทึกรูปสินค้า ${p.sku} แล้ว ✓`); onChanged?.(); }}
                />
              )}
              {p.detail && <p>{p.detail}</p>}
            </li>
          ))}
        </ul>
        {products.length === 0 && <p className="sa-muted">ยังไม่มีสินค้า — เพิ่มเองหรือนำเข้าจากเว็บ/โฟลเดอร์ด้านล่าง</p>}
      </section>

      <section className="sa-style-card">
        <header>
          <Plus size={15} />
          <b>เพิ่มสินค้าเอง</b>
        </header>
        <div className="sa-style-form">
          <div className="sa-style-row">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ชื่อสินค้า *"
            />
            <input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="SKU (ว่าง = สร้างให้)"
            />
          </div>
          <div className="sa-style-row">
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="หมวดหมู่"
            />
            <input
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="ราคา (เช่น 1290)"
            />
          </div>
          <input
            value={form.sourceUrl}
            onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            placeholder="ลิงก์อ้างอิง (ถ้ามี)"
          />
          <input
            value={form.image}
            onChange={(e) => setForm({ ...form, image: e.target.value })}
            placeholder="ลิงก์รูปสินค้า https://… (ถ้ามี — เพิ่มภายหลังได้)"
          />
          <div>
            <button className="sa-btn primary sm" disabled={saving || !form.name.trim()} onClick={addManual}>
              <Plus size={13} /> {saving ? "กำลังบันทึก…" : "เพิ่มสินค้า"}
            </button>
          </div>
        </div>
      </section>

      <section className="sa-style-card">
        <header>
          <Globe size={15} />
          <b>นำเข้าจากเว็บไซต์</b>
          <span className="sa-muted">วางลิงก์หน้าสินค้า → ดึงรายละเอียด + หาสินค้าอื่นในเว็บเดียวกัน</span>
        </header>
        <div className="sa-style-form">
          <div className="sa-style-row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              style={{ flex: 1 }}
            />
            <label className="sa-check" title="ตามลิงก์ลงไปอีก 1 ชั้น เหมาะกับหน้าหลัก/หน้าหมวดหมู่">
              <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} disabled={urlBusy} /> เจาะลึก 2 ชั้น
            </label>
            <button className="sa-btn primary sm" disabled={urlBusy || !url.trim()} onClick={fetchUrl}>
              {urlBusy ? "กำลังดึง…" : "ดึงข้อมูล"}
            </button>
            <button className="sa-btn sm" disabled={urlBusy || !url.trim()} onClick={fetchAndImportAll} title="ดึงแล้วนำเข้าทุกรายการทันที ไม่ต้องติ๊กเลือก">
              {urlBusy ? "กำลังนำเข้า…" : "⚡ ดึง+นำเข้าทั้งหมด"}
            </button>
          </div>
          <div className="sa-style-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
            <button className="sa-btn ghost sm" onClick={sampleFromCatalog} title="อ่านหน้าถัดไปของลิงก์ด้านบน แล้วสุ่มสินค้าเข้าคลังไม่เกิน 31 รายการ ไม่ซ้ำกัน (ไม่ต้องติ๊กเลือก)">
              <Wand2 size={14} /> {sampleBusy ? "กำลังสุ่ม…" : "🎲 สุ่ม 1 สินค้า/วัน ไม่ซ้ำทั้งเดือน (≤31)"}
            </button>
            <span className="sa-muted">ใช้หน้าเดียวกับลิงก์ด้านบน · อ่านหน้าถัดไปอัตโนมัติ · เพิ่มเฉพาะรายการที่ยังไม่มีในคลัง</span>
          </div>
        </div>
        {urlFound && (
          <>
            <p className="sa-muted">
              เจอ {urlFound.products.length} รายการ จาก {urlFound.fetched} หน้า
              {urlFound.failed ? ` (ดึงไม่ได้ ${urlFound.failed})` : ""} — ติ๊กเลือกแล้วกดนำเข้า
            </p>
            <ul className="sa-style-shots">
              {urlFound.products.map((p, i) => (
                <li key={i} className="sa-style-shot">
                  <div className="sa-style-shot-head">
                    <input type="checkbox" checked={urlSel.includes(i)} onChange={toggleSel(setUrlSel)(i)} />
                    <ProductThumb small src={p.image} title={p.image ? "รูปจากเว็บต้นทาง" : "หน้านี้ไม่มีรูป"} />
                    <b>{p.name}</b>
                    <span className="sa-muted">{p.price ? `${p.price} ${p.currency || ""} · ` : ""}{p.sourceUrl}</span>
                  </div>
                  {p.description && <p>{p.description.slice(0, 160)}</p>}
                </li>
              ))}
            </ul>
            <div>
              <button className="sa-btn primary sm" disabled={saving || !urlSel.length} onClick={() => importSelected("url")}>
                นำเข้าที่เลือก ({urlSel.length})
              </button>
            </div>
          </>
        )}
      </section>

      <section className="sa-style-card">
        <header>
          <FolderOpen size={15} />
          <b>นำเข้าจากโฟลเดอร์</b>
          <span className="sa-muted">รูป (.jpg/.png/…) + ตาราง (.csv/.xlsx) — สแกนแล้วติ๊กเลือก</span>
        </header>
        <div className="sa-style-form">
          <div className="sa-style-row">
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="/Users/…/Products"
              style={{ flex: 1 }}
            />
            <button className="sa-btn primary sm" disabled={scanBusy || !folder.trim()} onClick={scan}>
              {scanBusy ? "กำลังสแกน…" : "สแกนโฟลเดอร์"}
            </button>
            <button className="sa-btn sm" disabled={scanBusy || !folder.trim()} onClick={scanAndImportAll} title="สแกนแล้วนำเข้าทุกรายการทันที ไม่ต้องติ๊กเลือก">
              {scanBusy ? "กำลังนำเข้า…" : "⚡ สแกน+นำเข้าทั้งหมด"}
            </button>
          </div>
        </div>
        {scanFound && (
          <>
            <p className="sa-muted">
              ไฟล์ {scanFound.files} · รูป {scanFound.images.length} · แถวข้อมูล {scanFound.rows.length}
            </p>
            {(scanFound.errors || []).map((e, i) => (
              <p key={i} className="sa-muted">⚠️ {e}</p>
            ))}
            <ul className="sa-style-shots">
              {[...scanFound.images, ...scanFound.rows].map((p, i) => (
                <li key={i} className="sa-style-shot">
                  <div className="sa-style-shot-head">
                    <input type="checkbox" checked={scanSel.includes(i)} onChange={toggleSel(setScanSel)(i)} />
                    {p.kind === "image" && (
                      <ProductThumb
                        small
                        src={`/api/social-agency/products/preview-image?path=${encodeURIComponent(p.file)}`}
                        title={`พรีวิวจาก ${String(p.file).split("/").pop()}`}
                      />
                    )}
                    <b>{p.name}</b>
                    <span className="sa-muted">
                      {p.kind === "image"
                        ? `🖼️ ${String(p.file).split("/").pop()}${p.price ? ` · ${p.price}` : ""}`
                        : `📄 ${p.price ? `${p.price} · ` : ""}${p.category || ""}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div>
              <button className="sa-btn primary sm" disabled={saving || !scanSel.length} onClick={() => importSelected("folder")}>
                นำเข้าที่เลือก ({scanSel.length})
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
