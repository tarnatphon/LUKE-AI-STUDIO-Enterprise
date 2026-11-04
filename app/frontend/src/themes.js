/**
 * Theme catalog.
 *
 * THEMES is a KEYED catalogue (id -> { id, name, colors }), NOT an array.
 * Settings.jsx and TopStatusBar.jsx used to call `THEMES.map(...)` as if it
 * were an array, which threw "ae.map is not a function" (minified) as soon as
 * the Appearance section or the header theme dropdown opened, and the whole
 * Settings workspace fell into its error boundary. Render from THEME_LIST
 * instead — and never from THEMES directly.
 *
 * THEME_LIST ids are exactly the values App.css styles with
 * `html[data-theme="..."]` (plus "light", which is the :root default), so
 * choosing a swatch actually changes the colours. The three old catalogue ids
 * are kept working through canonicalThemeId() for anyone whose localStorage
 * still has them.
 */

export const THEMES = {
  midnightGlass: {
    id: "midnightGlass",
    name: "Midnight Glass (M3 Pro)",
    colors: {
      background: "radial-gradient(ellipse at top, #1e1e2f 0%, #0d0e15 100%)",
      panelBg: "rgba(22, 24, 38, 0.75)",
      panelBorder: "rgba(255, 255, 255, 0.08)",
      accent: "#6366f1",
      accentHover: "#4f46e5",
      textPrimary: "#f8fafc",
      textSecondary: "#94a3b8",
      cardBg: "rgba(30, 34, 53, 0.6)",
      glow: "0 8px 32px 0 rgba(99, 102, 241, 0.15)"
    }
  },
  cyberStudio: {
    id: "cyberStudio",
    name: "Cyber Neon",
    colors: {
      background: "#090a0f",
      panelBg: "rgba(13, 16, 23, 0.9)",
      panelBorder: "rgba(56, 189, 248, 0.2)",
      accent: "#06b6d4",
      accentHover: "#0891b2",
      textPrimary: "#f0fdfa",
      textSecondary: "#64748b",
      cardBg: "rgba(15, 23, 42, 0.8)",
      glow: "0 0 20px rgba(6, 182, 212, 0.3)"
    }
  },
  studioMinimal: {
    id: "studioMinimal",
    name: "Studio Minimalist",
    colors: {
      background: "#121316",
      panelBg: "#1a1b1f",
      panelBorder: "#27272a",
      accent: "#10b981",
      accentHover: "#059669",
      textPrimary: "#ffffff",
      textSecondary: "#a1a1aa",
      cardBg: "#222328",
      glow: "none"
    }
  }
};

export const themes = THEMES;

/**
 * The renderable list. Every field here is consumed by the theme cards in
 * Settings.jsx and the dropdown in TopStatusBar.jsx; bg/primary/secondary are
 * taken from the matching App.css theme block so the swatch matches the result.
 */
export const THEME_LIST = [
  { id: "dark", name: "Midnight Dark", bg: "#090a0f", primary: "#6366f1", secondary: "#38bdf8", type: "dark" },
  { id: "light", name: "Light (Default)", bg: "#f8fafc", primary: "#4f46e5", secondary: "#0ea5e9", type: "light" },
  { id: "light-nord", name: "Nord Light", bg: "#eceff4", primary: "#5e81ac", secondary: "#88c0d0", type: "light" },
  { id: "light-sakura", name: "Sakura Light", bg: "#fdf6f6", primary: "#d05a74", secondary: "#e597a7", type: "light" },
  { id: "dark-cyberpunk", name: "Cyberpunk", bg: "#0d0714", primary: "#ff007f", secondary: "#00f0ff", type: "dark" },
  { id: "dark-forest", name: "Dark Forest", bg: "#060f0e", primary: "#10b981", secondary: "#34d399", type: "dark" },
  { id: "dark-dracula", name: "Dracula", bg: "#282a36", primary: "#bd93f9", secondary: "#ff79c6", type: "dark" },
  { id: "dark-oled", name: "OLED Black", bg: "#000000", primary: "#3b82f6", secondary: "#60a5fa", type: "dark" },
];

export const THEME_IDS = THEME_LIST.map((entry) => entry.id);
export const DEFAULT_THEME = "dark";
export const defaultTheme = DEFAULT_THEME;

/** Old catalogue ids still saved in localStorage must keep working. */
const LEGACY_THEME_IDS = {
  midnightGlass: "dark",
  cyberStudio: "dark-cyberpunk",
  studioMinimal: "dark-oled",
};

/** Resolve a stored theme id to an id App.css actually styles. */
export function canonicalThemeId(id) {
  if (LEGACY_THEME_IDS[id]) return LEGACY_THEME_IDS[id];
  return THEME_IDS.includes(id) ? id : DEFAULT_THEME;
}
