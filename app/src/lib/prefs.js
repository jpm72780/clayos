// Persisted display preferences — accessibility + terminology choices that should
// survive reloads: colour palette (default | colorblind-safe), higher-contrast
// rendering, and "literal" terminology (plain construction terms instead of the
// vascular metaphor). Read once at startup; written on every toggle.
const KEY = "clayos.display.v1";

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

export const DEFAULT_PREFS = { palette: "default", contrast: false, literal: false };

export const loadPrefs = () => {
  const stored = read();
  const p = { ...DEFAULT_PREFS, ...stored };
  // No explicit choice yet → honor the OS-level "prefers more contrast" signal.
  if (!("contrast" in stored) && typeof window !== "undefined" && window.matchMedia?.("(prefers-contrast: more)").matches) {
    p.contrast = true;
  }
  return p;
};

export const savePrefs = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } };
