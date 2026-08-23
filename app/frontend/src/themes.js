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
export const DEFAULT_THEME = "midnightGlass";
export const defaultTheme = "midnightGlass";
