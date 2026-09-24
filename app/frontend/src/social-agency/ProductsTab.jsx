import { useEffect, useState } from "react";
import { Package, Plus, Trash2, Globe, FolderOpen } from "lucide-react";
import { api, postJson } from "./lib.js";

export default function ProductsTab({ activeClient, refreshKey, onChanged }) {
  const clientId = activeClient?.id;
  const products = activeClient?.products || [];
  const [form, setForm] = useState({ name: "", sku: "", category: "", price: "", sourceUrl: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlFound, setUrlFound] = useState(null);
  const [urlSel, setUrlSel] = useState([]);
  const [folder, setFolder] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanFound, setScanFound] = useState(null);
  const [scanSel, setScanSel] = useState([]);

  useEffect(() => {
    setUrl(activeClient?.website || "");
    setUrlFound(null);
    setUrlSel([]);
    setScanFound(null);
    setScanSel([]);
    setNote("");
    setError("");
  }, [clientId]);

  const toggleSel = (setter) => (i) =>
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
      });
      setForm({ name: "", sku: "", category: "", price: "", sourceUrl: "" });
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

  const fetchAndImportAll = async () => {
    if (!clientId || urlBusy || !url.trim()) return;
    setUrlBusy(true);
    setError("");
    setNote("");
    try {
      const data = await postJson(`/api/social-agency/products/import-url?clientId=${encodeURIComponent(clientId)}`, {
        url: url.trim(),
        maxPages: 5,
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
          <span className="sa-muted">{products.length} รายการ · วางแผนอัตโนมัติจะวนใช้ทุกตัว</span>
        </header>
        <ul className="sa-style-shots">
          {products.map((p) => (
            <li key={p.sku} className="sa-style-shot">
              <div className="sa-style-shot-head">
                {p.image && <img src={p.image} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />}
                <b>{p.name}</b>
                <span className="sa-muted">{p.sku} · {p.category}{p.price ? ` · ${p.price}` : ""}</span>
                {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="sa-muted">ลิงก์</a>}
                <span style={{ flex: 1 }} />
                <button className="sa-icon-btn sm danger" title="ลบสินค้า" onClick={() => removeProduct(p.sku)}>
                  <Trash2 size={13} />
                </button>
              </div>
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
            <button className="sa-btn primary sm" disabled={urlBusy || !url.trim()} onClick={fetchUrl}>
              {urlBusy ? "กำลังดึง…" : "ดึงข้อมูล"}
            </button>
            <button className="sa-btn sm" disabled={urlBusy || !url.trim()} onClick={fetchAndImportAll} title="ดึงแล้วนำเข้าทุกรายการทันที ไม่ต้องติ๊กเลือก">
              {urlBusy ? "กำลังนำเข้า…" : "⚡ ดึง+นำเข้าทั้งหมด"}
            </button>
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
