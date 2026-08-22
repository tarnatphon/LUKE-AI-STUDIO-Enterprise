import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  UploadCloud,
  ImagePlus,
  Search,
  Sparkles,
  Pin,
  PinOff,
  Trash2,
  Eye,
  EyeOff,
  Save,
  Download,
  Upload,
  Wand2,
  SlidersHorizontal,
  CheckSquare,
  Square,
  X,
} from "lucide-react";

const MAX_REFERENCES = 20;
const APPEARANCE_ROLE = "Appearance";
const INFLUENCES = ["Soft", "Normal", "Strong", "Locked"];

function uid() {
  return `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function clampNumber(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeReference(item, index = 0) {
  return {
    id: item.id || uid(),
    name: item.name || `Appearance Reference ${index + 1}`,
    src: item.src || "",
    role: APPEARANCE_ROLE,
    weight: clampNumber(item.weight ?? (index === 0 ? 1.25 : 1), 0, 2, 1),
    startAt: 0,
    endAt: 100,
    influence: item.influence || (index === 0 ? "Locked" : "Strong"),
    enabled: item.enabled !== false,
    pinned: item.pinned === true || index === 0,
    notes: item.notes || "",
    preserveFace: item.preserveFace !== false,
    preserveHair: item.preserveHair !== false,
    preserveClothing: item.preserveClothing !== false,
    preserveBody: item.preserveBody !== false,
    size: item.size || 0,
    type: item.type || "image/*",
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

const ReferenceCard = memo(function ReferenceCard({
  item,
  index,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onUseAsBase,
}) {
  return (
    <div className={`reference-card appearance-reference-card ${selected ? "selected" : ""} ${!item.enabled ? "disabled" : ""}`}>
      <div className="reference-card-media appearance-card-media">
        <img src={item.src} alt={item.name || `Reference ${index + 1}`} loading="lazy" decoding="async" />
        <button className="reference-index" type="button" onClick={() => onSelect(item.id)} title="Select reference">
          {selected ? <CheckSquare size={14} /> : <Square size={14} />}
          <span>{index + 1}</span>
        </button>
        <span className="reference-role-badge appearance-lock-badge">Face / Appearance</span>
      </div>

      <div className="reference-card-body">
        <div className="reference-card-title" title={item.name}>{item.name || `Reference ${index + 1}`}</div>

        <div className="appearance-weight-row">
          <div>
            <label>Face Match Weight</label>
            <span>{Number(item.weight).toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={item.weight}
            onChange={(e) => onUpdate(item.id, { weight: Number(e.target.value), role: APPEARANCE_ROLE })}
          />
        </div>

        <div className="appearance-lock-grid">
          <label><input type="checkbox" checked={item.preserveFace !== false} onChange={(e) => onUpdate(item.id, { preserveFace: e.target.checked })} /> Face</label>
          <label><input type="checkbox" checked={item.preserveHair !== false} onChange={(e) => onUpdate(item.id, { preserveHair: e.target.checked })} /> Hair</label>
          <label><input type="checkbox" checked={item.preserveClothing !== false} onChange={(e) => onUpdate(item.id, { preserveClothing: e.target.checked })} /> Clothing</label>
          <label><input type="checkbox" checked={item.preserveBody !== false} onChange={(e) => onUpdate(item.id, { preserveBody: e.target.checked })} /> Body</label>
        </div>

        <div className="reference-field-row">
          <label>Influence</label>
          <select value={item.influence} onChange={(e) => onUpdate(item.id, { influence: e.target.value, role: APPEARANCE_ROLE })}>
            {INFLUENCES.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </div>

        <textarea
          className="reference-notes"
          value={item.notes || ""}
          onChange={(e) => onUpdate(item.id, { notes: e.target.value })}
          placeholder="Optional details to keep: smile, haircut, shirt color, expression..."
          rows={2}
        />
      </div>

      <div className="reference-card-actions">
        <button type="button" title={item.enabled ? "Disable" : "Enable"} onClick={() => onUpdate(item.id, { enabled: !item.enabled })}>
          {item.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button type="button" title={item.pinned ? "Unpin primary" : "Make primary"} onClick={() => onUpdate(item.id, { pinned: !item.pinned, role: APPEARANCE_ROLE })}>
          {item.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
        <button type="button" title="Use as base image" onClick={() => onUseAsBase(item.src)}>
          <ImagePlus size={15} />
        </button>
        <button type="button" title="Remove" className="danger" onClick={() => onRemove(item.id)}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
});

function ReferenceManager({
  referenceImages,
  setReferenceImages,
  referenceSettings,
  setReferenceSettings,
  onUseAsBase,
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const importInputRef = useRef(null);

  const unifiedReferences = useMemo(
    () => referenceImages.map((item, index) => normalizeReference(item, index)),
    [referenceImages]
  );
  const enabledCount = unifiedReferences.filter((item) => item.enabled).length;
  const filteredReferences = useMemo(() => {
    const q = query.trim().toLowerCase();
    return unifiedReferences
      .slice()
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.weight || 0) - Number(a.weight || 0))
      .filter((item) => !q || [item.name, item.notes, item.influence].join(" ").toLowerCase().includes(q));
  }, [unifiedReferences, query]);

  const addFiles = useCallback(async (files) => {
    if (disabled) return;
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const remaining = MAX_REFERENCES - referenceImages.length;
    const accepted = imageFiles.slice(0, Math.max(0, remaining));
    const items = await Promise.all(accepted.map(async (file, offset) => normalizeReference({
      name: file.name,
      src: await readImageFile(file),
      size: file.size,
      type: file.type,
      pinned: referenceImages.length + offset === 0,
      weight: referenceImages.length + offset === 0 ? 1.35 : 1,
      influence: referenceImages.length + offset === 0 ? "Locked" : "Strong",
    }, referenceImages.length + offset)));
    setReferenceImages((prev) => [...prev.map((item, idx) => normalizeReference(item, idx)), ...items].slice(0, MAX_REFERENCES));
  }, [disabled, referenceImages, setReferenceImages]);

  const updateItem = useCallback((id, patch) => {
    setReferenceImages((prev) => prev.map((item, idx) => item.id === id ? normalizeReference({ ...item, ...patch, role: APPEARANCE_ROLE }, idx) : normalizeReference(item, idx)));
  }, [setReferenceImages]);

  const removeItem = useCallback((id) => {
    setReferenceImages((prev) => prev.filter((item) => item.id !== id).map((item, idx) => normalizeReference(item, idx)));
    setSelectedIds((prev) => prev.filter((itemId) => itemId !== id));
  }, [setReferenceImages]);

  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]);
  }, []);

  const bulkUpdate = useCallback((patch) => {
    if (selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    setReferenceImages((prev) => prev.map((item, idx) => selected.has(item.id) ? normalizeReference({ ...item, ...patch, role: APPEARANCE_ROLE }, idx) : normalizeReference(item, idx)));
  }, [selectedIds, setReferenceImages]);

  const bulkRemove = useCallback(() => {
    if (selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    setReferenceImages((prev) => prev.filter((item) => !selected.has(item.id)).map((item, idx) => normalizeReference(item, idx)));
    setSelectedIds([]);
  }, [selectedIds, setReferenceImages]);

  const savePreset = useCallback(() => {
    const name = window.prompt("Preset name", `Appearance Reference Preset ${new Date().toLocaleDateString()}`);
    if (!name) return;
    const preset = {
      id: uid(),
      name,
      createdAt: new Date().toISOString(),
      settings: { ...referenceSettings, mode: "Appearance Lock" },
      references: unifiedReferences.map(({ src, ...meta }) => meta),
      note: "Image data is not stored in preset metadata. Re-import images when needed.",
    };
    const saved = JSON.parse(localStorage.getItem("reference-manager-presets") || "[]");
    localStorage.setItem("reference-manager-presets", JSON.stringify([preset, ...saved].slice(0, 50)));
  }, [unifiedReferences, referenceSettings]);

  const exportJson = useCallback(() => {
    const payload = {
      version: 2,
      mode: "Appearance Lock",
      exportedAt: new Date().toISOString(),
      settings: { ...referenceSettings, mode: "Appearance Lock" },
      references: unifiedReferences.map(({ src, ...meta }) => ({ ...meta, hasEmbeddedPreview: false })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `appearance-reference-manager-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [unifiedReferences, referenceSettings]);

  const importJson = useCallback(async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (payload.settings) setReferenceSettings((prev) => ({ ...prev, ...payload.settings, mode: "Appearance Lock", lockIdentity: true }));
      if (Array.isArray(payload.references)) {
        const restored = payload.references.slice(0, MAX_REFERENCES).map((item, idx) => normalizeReference(item, idx)).filter((item) => item.src);
        if (restored.length) setReferenceImages(restored);
      }
    } catch (err) {
      console.error("Failed to import reference metadata", err);
      window.alert("Import failed. Please select a valid Reference Manager JSON file.");
    }
  }, [setReferenceImages, setReferenceSettings]);

  const optimizeForFace = useCallback(() => {
    setReferenceImages((prev) => prev.map((item, idx) => normalizeReference({
      ...item,
      pinned: idx === 0 ? true : item.pinned,
      weight: idx === 0 ? 1.55 : Math.max(Number(item.weight || 1), 1.15),
      influence: idx === 0 ? "Locked" : "Strong",
      preserveFace: true,
      preserveHair: true,
      preserveClothing: true,
      preserveBody: true,
    }, idx)));
    setReferenceSettings((prev) => ({
      ...prev,
      mode: "Appearance Lock",
      strength: 1.35,
      similarityBoost: 1,
      lockIdentity: true,
      combineAll: true,
      faceLock: true,
      hairLock: true,
      clothingLock: true,
      bodyLock: true,
    }));
  }, [setReferenceImages, setReferenceSettings]);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(filteredReferences.map((item) => item.id));
  }, [filteredReferences]);

  const updateSetting = useCallback((patch) => {
    setReferenceSettings((prev) => ({ ...prev, ...patch, mode: "Appearance Lock", lockIdentity: true }));
  }, [setReferenceSettings]);

  return (
    <div className="reference-manager appearance-reference-manager">
      <div className="reference-manager-header appearance-manager-header">
        <div>
          <div className="reference-title-row">
            <Sparkles size={17} />
            <h3>Reference Manager — Face / Appearance Lock</h3>
            <span className="reference-count">{enabledCount} / {MAX_REFERENCES}</span>
          </div>
          <p>One unified reference mode. Add photos and the generator will focus on matching the same face, hairstyle, clothing, body shape, color tone and key details.</p>
        </div>
        <div className="reference-actions-main">
          <button type="button" className="m3-btn m3-btn-tonal" onClick={() => fileInputRef.current?.click()} disabled={disabled || referenceImages.length >= MAX_REFERENCES}>
            <ImagePlus size={15} /> Add Images
          </button>
          <button type="button" className="m3-btn m3-btn-filled" onClick={optimizeForFace} disabled={disabled || referenceImages.length === 0}>
            <Wand2 size={15} /> Optimize Face Match
          </button>
          <button type="button" className="m3-btn m3-btn-outlined" onClick={savePreset} disabled={referenceImages.length === 0}>
            <Save size={15} /> Save Preset
          </button>
          <button type="button" className="m3-btn m3-btn-outlined" onClick={exportJson} disabled={referenceImages.length === 0}>
            <Download size={15} /> Export
          </button>
          <button type="button" className="m3-btn m3-btn-outlined" onClick={() => importInputRef.current?.click()}>
            <Upload size={15} /> Import
          </button>
          <button type="button" className="m3-btn m3-btn-error" onClick={() => { setReferenceImages([]); setSelectedIds([]); }} disabled={referenceImages.length === 0}>
            <X size={15} /> Clear All
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
      <input ref={importInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => importJson(e.target.files?.[0])} />

      <div className="appearance-master-controls">
        <label>
          Face Similarity <span>{Number(referenceSettings.similarityBoost ?? 1).toFixed(2)}</span>
          <input type="range" min="0" max="1" step="0.05" value={referenceSettings.similarityBoost ?? 1} onChange={(e) => updateSetting({ similarityBoost: Number(e.target.value) })} />
        </label>
        <label>
          Reference Strength <span>{Number(referenceSettings.strength ?? 1.35).toFixed(2)}</span>
          <input type="range" min="0" max="1.5" step="0.05" value={referenceSettings.strength ?? 1.35} onChange={(e) => updateSetting({ strength: Number(e.target.value) })} />
        </label>
        <label>
          Denoise Guidance <span>{Number(referenceSettings.denoiseGuidance ?? 0.38).toFixed(2)}</span>
          <input type="range" min="0.15" max="0.85" step="0.05" value={referenceSettings.denoiseGuidance ?? 0.38} onChange={(e) => updateSetting({ denoiseGuidance: Number(e.target.value) })} />
        </label>
        <div className="appearance-lock-toggles">
          <label><input type="checkbox" checked={referenceSettings.faceLock !== false} onChange={(e) => updateSetting({ faceLock: e.target.checked })} /> Face</label>
          <label><input type="checkbox" checked={referenceSettings.hairLock !== false} onChange={(e) => updateSetting({ hairLock: e.target.checked })} /> Hair</label>
          <label><input type="checkbox" checked={referenceSettings.clothingLock !== false} onChange={(e) => updateSetting({ clothingLock: e.target.checked })} /> Clothing</label>
          <label><input type="checkbox" checked={referenceSettings.bodyLock !== false} onChange={(e) => updateSetting({ bodyLock: e.target.checked })} /> Body</label>
        </div>
      </div>

      <div className="reference-controls-bar appearance-controls-bar">
        <div className="reference-search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by file name or notes..." />
        </div>
        <div className="appearance-mode-pill">
          Single Mode: Face / Appearance Lock
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="reference-bulk-bar">
          <span><CheckSquare size={15} /> {selectedIds.length} selected</span>
          <button type="button" onClick={() => bulkUpdate({ enabled: true })}>Enable</button>
          <button type="button" onClick={() => bulkUpdate({ enabled: false })}>Disable</button>
          <button type="button" onClick={() => bulkUpdate({ pinned: true })}>Make Primary</button>
          <button type="button" onClick={() => bulkUpdate({ weight: 1.35, influence: "Locked" })}>Strong Match</button>
          <button type="button" onClick={bulkRemove} className="danger">Delete</button>
          <button type="button" onClick={() => setSelectedIds([])}>Cancel</button>
        </div>
      )}

      <div
        className={`reference-dropzone appearance-dropzone ${isDragging ? "dragging" : ""}`}
        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => referenceImages.length === 0 && fileInputRef.current?.click()}
      >
        {filteredReferences.length > 0 ? (
          <div className="reference-grid appearance-reference-grid">
            {filteredReferences.map((item, index) => (
              <ReferenceCard
                key={item.id}
                item={item}
                index={unifiedReferences.findIndex((ref) => ref.id === item.id)}
                selected={selectedIds.includes(item.id)}
                onSelect={toggleSelected}
                onUpdate={updateItem}
                onRemove={removeItem}
                onUseAsBase={onUseAsBase}
              />
            ))}
          </div>
        ) : (
          <div className="reference-empty">
            <UploadCloud size={34} />
            <strong>Drag & Drop face / appearance references here</strong>
            <span>Upload up to {MAX_REFERENCES} JPG, PNG or WebP images. Use clear front/side photos for best likeness.</span>
          </div>
        )}
      </div>

      {filteredReferences.length > 0 && (
        <div className="reference-footer-row">
          <button type="button" className="m3-btn m3-btn-outlined" onClick={selectAllVisible}>Select Visible</button>
          <div className="reference-hint">
            <SlidersHorizontal size={14} />
            Best result: use 3–8 clear photos, pin the best face as Primary, press <strong>Optimize Face Match</strong>, then generate.
          </div>
        </div>
      )}
    </div>
  );
}

export { MAX_REFERENCES };
export default memo(ReferenceManager);
