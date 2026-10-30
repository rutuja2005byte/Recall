/* ---------- 1. Constants & state ---------- */
const API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const KEYS = {
  apiKey: "recall_apiKey",
  theme: "recall_theme",
  history: "recall_history",
  scores: "recall_scores",
};
const MAX_CHARS = 12000;      // limit for the notes box
const WARN_AT = 0.8;          // show a warning at 80% of the limit
const MAX_HISTORY = 30;

const state = {
  isLoading: false,
  current: null,      // { id, notes, style, difficulty, result, known }
  quizDone: false,
};

// Short DOM helper
const $ = (id) => document.getElementById(id);

/* ---------- 2. Small helpers ---------- */

// Safe localStorage wrappers (never crash if storage is blocked / corrupted)
function storeGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function showMessage(text, type = "error") {
  const box = $("message");
  box.textContent = type === "error" ? `Error: ${text}` : text;
  box.className = `message ${type}`;
  box.hidden = false;
}
function clearMessage() { $("message").hidden = true; }

// While a request runs the button shows "Generating..." and is disabled (no double clicks)
function setLoading(isLoading) {
  state.isLoading = isLoading;
  $("generateBtn").disabled = isLoading;
  $("generateBtn").textContent = isLoading ? "Generating..." : "Generate";
}

function getApiKey() { return storeGet(KEYS.apiKey, ""); }

/* ---------- 3. Navigation (Ask / History / Settings) & theme ---------- */
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll(".dock-btn[data-view]").forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (name === "history") { renderHistory(); renderProgress(); }
  window.scrollTo({ top: 0 });
}

// Simple line icons for the theme button in the dock
const ICON_MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const ICON_SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = $("themeToggle");
  // in dark mode show the sun (switch to light), in light mode show the moon (switch to dark)
  btn.innerHTML = theme === "dark" ? ICON_SUN : ICON_MOON;
  btn.dataset.label = theme === "dark" ? "Light mode" : "Dark mode";
}
function initTheme() {
  const saved = storeGet(KEYS.theme);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}
function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  storeSet(KEYS.theme, next);
}

