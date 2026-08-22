import React, { useEffect, useMemo, useState } from "react";
import { Film, Upload, Play, CheckCircle2, AlertTriangle, Cpu, HardDrive, Plus, Trash2, Sparkles, ShieldCheck, Download, Wrench } from "lucide-react";
import { getImageToVideoCompatibility, generateImageToVideo, getImageToVideoCapabilityStatus, installImageToVideoCapability } from "../services/api";

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("Please select a valid image."));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export default function ImageToVideo({ specs, showAlert }) {
  const [catalog, setCatalog] = useState([]);
  const [source, setSource] = useState(null);
  const [references, setReferences] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [capability, setCapability] = useState({ state: "checking", installed: false });
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    getImageToVideoCompatibility()
      .then((data) => setCatalog(data.models || []))
      .catch((e) => showAlert?.({ title: "Compatibility Check Failed", message: e.message, danger: true }));
  }, [showAlert]);

  const refreshCapability = async () => {
    try {
      const data = await getImageToVideoCapabilityStatus();
      setCapability(data);
      setInstalling(data.state === "installing");
      return data;
    } catch (error) {
      setCapability({ state: "error", installed: false, message: error.message });
      return null;
    }
  };

  useEffect(() => {
    let timer;
    refreshCapability().then((data) => {
      if (data?.state === "installing") timer = setInterval(refreshCapability, 1500);
    });
    return () => timer && clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!installing) return undefined;
    const timer = setInterval(async () => {
      const data = await refreshCapability();
      if (data && data.state !== "installing") {
        clearInterval(timer);
        if (data.state === "ready") showAlert?.({ title: "Image-to-Video Ready", message: "Runtime installed successfully." });
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [installing, showAlert]);

  const installCapability = async (repair = false) => {
    setInstalling(true);
    setCapability((prev) => ({ ...prev, state: "installing", message: repair ? "Repairing Image-to-Video…" : "Installing Image-to-Video…" }));
    try {
      await installImageToVideoCapability(repair);
    } catch (error) {
      setInstalling(false);
      setCapability({ state: "error", installed: false, message: error.message });
      showAlert?.({ title: "Installation Failed", message: error.message, danger: true });
    }
  };

  const automaticModel = useMemo(
    () => catalog.find((m) => m.workerReady && m.compatibility.status === "recommended")
      || catalog.find((m) => m.workerReady && m.compatibility.status === "limited")
      || catalog.find((m) => m.workerReady)
      || null,
    [catalog]
  );

  const addReferences = async (files) => {
    try {
      const available = Math.max(0, 8 - references.length);
      const accepted = Array.from(files || []).filter((file) => file.type.startsWith("image/")).slice(0, available);
      const items = await Promise.all(accepted.map(readImage));
      setReferences((prev) => [...prev, ...items].slice(0, 8));
    } catch (error) {
      showAlert?.({ title: "Reference Image", message: error.message, danger: true });
    }
  };

  const chooseSource = async (file) => {
    try { setSource(await readImage(file)); }
    catch (error) { showAlert?.({ title: "Source Image", message: error.message, danger: true }); }
  };

  const run = async () => {
    if (!source || !automaticModel || automaticModel.compatibility.status === "blocked") return;
    setBusy(true);
    setStatus("Automatic Match is analysing the computer and locking the reference appearance…");
    try {
      const result = await generateImageToVideo({
        modelId: "auto",
        imageDataUrl: source.dataUrl,
        references: references.map((item) => ({ ...item, type: "auto", weight: 1 })),
        referenceLock: true,
        automaticMatch: true,
        prompt: "",
        seconds: 5,
      });
      setStatus(result.message || "Automatic Reference Match completed.");
    } catch (error) {
      setStatus(error.message);
      showAlert?.({ title: "Automatic Image-to-Video", message: error.message, danger: true });
    } finally { setBusy(false); }
  };

  const runtimeReady = capability.installed === true || capability.state === "ready";
  const blocked = !runtimeReady || !automaticModel || automaticModel.compatibility.status === "blocked";

  return <div style={{ padding: 24, overflow: "auto", height: "100%" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
      <Film size={28}/><div><h2 style={{ margin: 0 }}>Automatic Image to Video</h2><div style={{ opacity: .72 }}>Upload images only. LUKE AI selects and applies every setting automatically.</div></div>
    </div>

    <div className="settings-card" style={{ padding: 18, marginBottom: 18, border: "1px solid var(--border-color)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, fontWeight:700 }}><Sparkles size={20}/> Automatic Reference Match</div>
      <p style={{ marginBottom:0, opacity:.78 }}>The system automatically locks identity, hairstyle, clothing, object shape, colors, materials, artwork, logos and background appearance. No model, strength, prompt or motion adjustment is required.</p>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.25fr) minmax(300px, .8fr)", gap: 18 }}>
      <section className="settings-card" style={{ padding: 18 }}>
        <h3>1. Upload the image to animate</h3>
        <label style={{ minHeight: 280, border: "2px dashed var(--border-color)", borderRadius: 14, display: "grid", placeItems: "center", cursor: "pointer", overflow: "hidden" }}>
          {source ? <img src={source.dataUrl} alt="source" style={{ width: "100%", height: 310, objectFit: "contain" }}/> : <div style={{ textAlign: "center" }}><Upload size={34}/><div style={{marginTop:8}}>Choose the main image</div></div>}
          <input type="file" accept="image/*" hidden onChange={(e)=>chooseSource(e.target.files?.[0])}/>
        </label>

        <h3 style={{ marginTop: 20 }}>2. Add Reference images <span style={{ opacity:.6, fontWeight:400 }}>({references.length}/8)</span></h3>
        <p style={{ opacity:.72, marginTop:-6 }}>Upload the clearest photos available. Front, side and detail views are accepted; the system decides how each image should be used.</p>
        <label style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:12, border:"1px dashed var(--border-color)", borderRadius:12, cursor:"pointer" }}><Plus size={18}/> Add Reference images<input type="file" accept="image/*" multiple hidden onChange={(e)=>addReferences(e.target.files)}/></label>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10, marginTop:12 }}>
          {references.map((item,index)=><div key={`${item.name}-${index}`} style={{ border:"1px solid var(--border-color)", borderRadius:12, padding:8 }}>
            <img src={item.dataUrl} alt={`reference ${index + 1}`} style={{ width:"100%", height:120, objectFit:"contain", borderRadius:8 }}/>
            <div style={{fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", margin:"7px 0"}}>{item.name}</div>
            <button type="button" onClick={()=>setReferences((prev)=>prev.filter((_,i)=>i!==index))} style={{ width:"100%", display:"flex", justifyContent:"center", gap:6 }}><Trash2 size={15}/> Remove</button>
          </div>)}
        </div>
      </section>

      <section className="settings-card" style={{ padding: 18 }}>
        <h3>Automatic computer check</h3>
        <div style={{ display:"flex", gap:10, marginBottom:12 }}><Cpu size={18}/>{specs?.gpu_name || "GPU detecting…"}</div>
        <div style={{ display:"flex", gap:10, marginBottom:16 }}><HardDrive size={18}/>{specs?.ram_total_gb || 0} GB RAM</div>
        {automaticModel ? <div style={{ padding:14, borderRadius:12, background:"var(--md-sys-color-surface-container)" }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", fontWeight:700 }}>{blocked ? <AlertTriangle size={18}/> : <CheckCircle2 size={18}/>} {automaticModel.compatibility.label}</div>
          <p>{automaticModel.compatibility.reason}</p>
          <div><strong>Selected automatically:</strong> {automaticModel.name}</div>
          <div style={{marginTop:8, display:"flex", gap:7, alignItems:"center"}}><ShieldCheck size={17}/> Maximum Reference Lock enabled</div>
          <p style={{marginBottom:0, opacity:.72}}>Duration, frame count, memory offload and conservative camera motion are selected automatically for this computer.</p>
        </div> : <p>Checking compatible local video models…</p>}
        {!runtimeReady && <div style={{ marginTop:16, padding:14, border:"1px solid var(--border-color)", borderRadius:12 }}>
          <div style={{display:"flex", alignItems:"center", gap:8, fontWeight:700}}><Download size={18}/> Image-to-Video is not installed</div>
          <p style={{opacity:.76}}>{capability.message || "Install the isolated runtime and required AI components. The video model downloads automatically on first generation."}</p>
          <button type="button" onClick={()=>installCapability(capability.state === "error")} disabled={installing} style={{width:"100%", padding:12, display:"flex", justifyContent:"center", gap:8}}>
            {capability.state === "error" ? <Wrench size={18}/> : <Download size={18}/>}
            {installing ? (capability.message || "Installing…") : capability.state === "error" ? "Repair Image-to-Video" : "Install Image-to-Video"}
          </button>
          {installing && <p style={{fontSize:12, opacity:.7}}>Keep LUKE AI open. Installation progress is checked automatically.</p>}
        </div>}
        {runtimeReady && <div style={{marginTop:16, display:"flex", gap:8, alignItems:"center"}}><CheckCircle2 size={18}/> Image-to-Video runtime ready</div>}
        <button onClick={run} disabled={busy || !source || blocked} style={{ width:"100%", marginTop:18, padding:13, display:"flex", justifyContent:"center", gap:8 }}><Play size={18}/>{busy ? "Creating automatically…" : "Create Video Automatically"}</button>
        {!source && <p style={{opacity:.66}}>Upload the main image to enable automatic generation.</p>}
        {status && <p style={{ marginTop:12 }}>{status}</p>}
      </section>
    </div>
  </div>;
}
