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
