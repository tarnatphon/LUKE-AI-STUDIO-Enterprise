import React, { memo, useState, useRef, useEffect } from "react";
import { Square, RefreshCw, Sun, Moon, Palette, Check, PanelLeftClose, PanelLeft } from "lucide-react";
import { THEMES } from "../themes";

const truncateModelName = (name) => {
  if (!name || typeof name !== "string") return "";
  let cleanName = name;
  if (name.includes("--")) {
    const parts = name.split("--");
    cleanName = parts[parts.length - 1];
  }
  if (cleanName.length > 25) {
    return cleanName.substring(0, 22) + "...";
  }
  return cleanName;
};

function TopStatusBar({ 
  telemetry, 
  serverRunning, 
  activeModel, 
  isLlmLoaded = false, 
  onStopServer, 
  isStoppingServer = false, 
  theme, 
  setTheme,
  sidebarVisible,
  onToggleSidebar
}) {
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowThemeMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatGb = (value, { allowZero = false } = {}) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return "--";
    if (number === 0 && !allowZero) return "--";
    return number.toFixed(number >= 10 ? 0 : 1);
  };

  // The RAM chip is machine-wide — the same figure Activity Monitor prints as
  // "Memory Used" — so with a browser open it is never small, and none of that
  // is this app's fault or this app's number. Show the share LUKE is actually
  // responsible for next to it: this server process plus the model processes it
  // spawned. The interface itself runs in a browser tab, so that memory belongs
  // to the browser and is deliberately not counted here.
  const serverRssGb = Number.isFinite(Number(telemetry.server_rss_gb)) ? Number(telemetry.server_rss_gb) : null;
  const modelsGb = Number.isFinite(Number(telemetry.vram_used_gb)) ? Number(telemetry.vram_used_gb) : 0;
  const hasServerRss = serverRssGb !== null;
  const lukeGb = (serverRssGb || 0) + modelsGb;
  const machineUsedGb = Number.isFinite(Number(telemetry.ram_used_gb)) ? Number(telemetry.ram_used_gb) : null;
  const machineTotalGb = Number.isFinite(Number(telemetry.ram_total_gb)) ? Number(telemetry.ram_total_gb) : null;
  const ramTitle = hasServerRss
    ? `LUKE's own footprint: ${serverRssGb.toFixed(2)} GB for the server process + ` +
      `${modelsGb.toFixed(1)} GB of loaded models in their own processes = ${lukeGb.toFixed(2)} GB. ` +
      "The interface you are looking at runs in a browser tab, so its memory belongs to the browser. " +
      (machineUsedGb !== null
        ? `The dimmed tail is the whole machine: ${machineUsedGb.toFixed(1)} of ` +
          `${String(machineTotalGb?.toFixed(0))} GB in use — comparable to what Activity Monitor shows ` +
          `as "Memory Used", so other apps and macOS itself are in it before any model is loaded.`
        : "The machine-wide reading has not arrived yet.")
    : "Memory in use across the whole machine — comparable to what Activity Monitor shows " +
      `as "Memory Used". The server has not reported its own footprint yet.`;

  // Several runtimes can be loaded at the same time, so the status bar shows
  // how many models are resident instead of only the first one.
  const loadedCount = (activeModel ? 1 : 0) + (typeof isLlmLoaded === "string" && isLlmLoaded ? 1 : 0);

  const getStatusText = () => {
    if (loadedCount > 1) return `${loadedCount} Models Loaded`;
    if (isLlmLoaded) return "Model Loaded (Text)";
    if (activeModel) return "Model Loaded (Image)";
    if (serverRunning) return "Server Active";
    return "Local Mode";
  };

  const getStatusClass = () => {
    if (activeModel || isLlmLoaded) return "status-indicator";
    if (serverRunning) return "status-indicator busy";
    return "status-indicator offline";
  };

  const isDark = (theme || "dark").startsWith("dark");

  return (
    <div className="top-status-bar">
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button
          onClick={onToggleSidebar}
          className="sidebar-toggle-btn"
          title={sidebarVisible ? "Collapse Sidebar" : "Expand Sidebar"}
        >
          {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>

        <div className="current-model-info">
          <div className={getStatusClass()}></div>
          <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
            {getStatusText()}
          </span>
          {(activeModel || (typeof isLlmLoaded === "string" && isLlmLoaded)) && (
            <>
              <span style={{ color: "var(--md-sys-color-outline-variant)" }}>|</span>
              <span 
                style={{ color: "var(--md-sys-color-primary)", fontWeight: 700 }}
                title={activeModel || isLlmLoaded}
              >
                {truncateModelName(activeModel || isLlmLoaded)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="telemetry-group" style={{ position: "relative" }}>
        <button
          className="theme-toggle-btn"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={`Switch to ${isDark ? "light" : "dark"} theme`}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
          <button
            className={`theme-toggle-btn ${showThemeMenu ? "active" : ""}`}
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            title="Choose a custom color theme"
            style={{ marginRight: "12px" }}
          >
            <Palette size={18} />
          </button>
          
          {showThemeMenu && (
            <div className="theme-dropdown-menu">
              <div className="theme-dropdown-header">Select Theme</div>
              <div className="theme-dropdown-divider"></div>
              {THEMES.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    className={`theme-dropdown-item ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setTheme(t.id);
                      setShowThemeMenu(false);
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                      <div style={{ display: "flex", gap: "2px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.primary }} />
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.secondary }} />
                      </div>
                      <span className="theme-name-text">{t.name}</span>
                      {isActive && <Check size={12} style={{ marginLeft: "auto", color: "var(--md-sys-color-primary)" }} />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {serverRunning && (
          <button
            className="m3-btn m3-btn-error"
            style={{ height: "34px", padding: "0 14px" }}
            onClick={onStopServer}
            disabled={isStoppingServer}
            title="Stop local model server"
          >
            {isStoppingServer ? <RefreshCw className="progress-spinner" size={14} /> : <Square size={14} />}
            <span>{isStoppingServer ? "Stopping" : "Stop Server"}</span>
          </button>
        )}

        {/* CPU Telemetry Chip */}
        <div className="telemetry-chip" title="CPU Utilization">
          <span>CPU: {Number.isFinite(Number(telemetry.cpu_usage)) ? telemetry.cpu_usage : "--"}%</span>
        </div>

        {/* RAM Telemetry Chip.
            The number the eye lands on is the one this app is responsible for:
            the server process plus the model processes it spawned. The
            machine-wide reading stays as a dimmed tail — still one glance away,
            because it is the context the governor works in, but no longer the
            headline a reader blames the app for. */}
        <div className="telemetry-chip" title={ramTitle}>
          {hasServerRss ? (
            <span>
              LUKE: {formatGb(lukeGb, { allowZero: true })} GB
              <span style={{ opacity: 0.65 }}>
                {" "}· machine {formatGb(telemetry.ram_used_gb)} / {formatGb(telemetry.ram_total_gb)} GB
              </span>
            </span>
          ) : (
            <span>RAM: {formatGb(telemetry.ram_used_gb)} / {formatGb(telemetry.ram_total_gb)} GB</span>
          )}
        </div>

        {/* GPU VRAM Telemetry Chip */}
        {telemetry.vram_total_gb > 0 && (
          <div className="telemetry-chip" title={`${telemetry.gpu_name} VRAM`}>
            <span>VRAM: {formatGb(telemetry.vram_used_gb, { allowZero: true })} / {formatGb(telemetry.vram_total_gb)} GB</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(TopStatusBar);
