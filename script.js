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
