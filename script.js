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

/* ---------- 4. Prompt + API call ---------- */

// Build the instruction ("prompt") sent to the AI
function buildPrompt(notes, style, difficulty) {
  return `You are a helpful study assistant. Turn the student's notes or topic below into study material.
Answer style: ${style}.
Quiz difficulty: ${difficulty}.

Reply ONLY with valid JSON (no markdown, no code fences, no extra text) in exactly this format:
{
  "summary": "a short summary (about 5-8 sentences) in the requested style",
  "quiz": [
    { "question": "question text", "options": ["A", "B", "C", "D"], "answer": 0, "explanation": "one short sentence" }
  ],
  "flashcards": [
    { "front": "question or term", "back": "answer or definition" }
  ]
}
Rules: "quiz" must contain exactly 5 questions, each with exactly 4 options.
"answer" is the zero-based index (0-3) of the correct option. "flashcards" must contain 6 to 8 cards.

Student's notes / topic:
"""
${notes}
"""`;
}

// Turn an HTTP status code into a clear message
function messageForStatus(status) {
  switch (status) {
    case 400: return "Bad request or invalid API key (HTTP 400). Please check your API key in Settings.";
    case 401: return "Unauthorized (HTTP 401). Your API key is wrong or missing.";
    case 403: return "Access denied (HTTP 403). Your API key is not allowed to use this service.";
    case 404: return "The AI service URL or model was not found (HTTP 404).";
    case 429: return "Rate limit reached (HTTP 429). You sent too many requests. Wait a minute and try again.";
    default:
      return status >= 500
        ? `The AI server has a problem (HTTP ${status}). Please try again later.`
        : `Request failed with HTTP status ${status}.`;
  }
}

// POST request to the Gemini API using async / await
async function callApi(apiKey, prompt) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",                                   // HTTP method
      headers: {                                        // request headers
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({                            // request body
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
      }),
    });
  } catch (err) {
    // fetch itself failed -> no internet / blocked / DNS problem
    throw new Error("Network failure: could not reach the AI service. Check your internet connection.");
  }

  if (!response.ok) {
    throw new Error(messageForStatus(response.status));
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Invalid AI reply: the server did not return readable JSON.");
  }
}


/* ---------- 5. Parsing & validation ---------- */

// Find the AI's answer text inside the API response JSON
function extractText(data) {
  if (data?.promptFeedback?.blockReason) {
    throw new Error("Invalid AI reply: the request was blocked by the AI safety filter. Try different notes.");
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Invalid AI reply: the response contained no text.");
  }
  return text;
}

// Parse the text as JSON (inside try/catch) and check its structure
function parseReply(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    throw new Error("Invalid AI reply: the answer was not valid JSON. Please click Generate again.");
  }
  return validateResult(obj);
}

function validateResult(obj) {
  const bad = (what) => new Error(`Invalid AI reply: ${what}. Please click Generate again.`);

  if (!obj || typeof obj !== "object") throw bad("unexpected format");
  if (typeof obj.summary !== "string" || !obj.summary.trim()) throw bad("the summary is missing");

  if (!Array.isArray(obj.quiz) || obj.quiz.length === 0) throw bad("the quiz is missing");
  const quiz = obj.quiz.map((q, i) => {
    const okOptions = Array.isArray(q?.options) && q.options.length >= 2 && q.options.every((o) => typeof o === "string");
    const ans = Number(q?.answer);
    if (typeof q?.question !== "string" || !q.question.trim() || !okOptions ||
        !Number.isInteger(ans) || ans < 0 || ans >= q.options.length) {
      throw bad(`quiz question ${i + 1} is incomplete`);
    }
    return { question: q.question, options: q.options, answer: ans, explanation: String(q.explanation || "") };
  });

  if (!Array.isArray(obj.flashcards) || obj.flashcards.length === 0) throw bad("the flashcards are missing");
  const flashcards = obj.flashcards.map((c, i) => {
    if (typeof c?.front !== "string" || typeof c?.back !== "string" || !c.front.trim() || !c.back.trim()) {
      throw bad(`flashcard ${i + 1} is incomplete`);
    }
    return { front: c.front, back: c.back };
  });

  return { summary: obj.summary.trim(), quiz: quiz.slice(0, 5), flashcards };
}

/* ---------- 6. Rendering ---------- */
function renderAll() {
  if (!state.current) return;
  $("results").hidden = false;
  renderSummary();
  renderQuiz();
  renderCards();
}

function renderSummary() {
  $("summaryText").textContent = state.current.result.summary;
}

/* Quiz */
function renderQuiz() {
  const box = $("quizContainer");
  box.innerHTML = "";
  state.quizDone = false;
  $("quizScore").textContent = "";
  $("submitQuiz").hidden = false;
  $("retryQuiz").hidden = true;

  state.current.result.quiz.forEach((q, qi) => {
    const wrap = document.createElement("div");
    wrap.className = "q";
    const h = document.createElement("h3");
    h.textContent = `${qi + 1}. ${q.question}`;
    wrap.appendChild(h);

    q.options.forEach((opt, oi) => {
      const label = document.createElement("label");
      label.className = "opt";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q${qi}`;
      input.value = oi;
      const span = document.createElement("span");
      span.textContent = opt;
      label.append(input, span);
      wrap.appendChild(label);
    });

    const fb = document.createElement("div");
    fb.className = "feedback";
    fb.id = `fb${qi}`;
    wrap.appendChild(fb);
    box.appendChild(wrap);
  });
}

function checkQuiz() {
  if (state.quizDone) return;
  const quiz = state.current.result.quiz;

  // Make sure at least one answer was chosen before marking
  const answeredAny = quiz.some((q, qi) => $("quizContainer").children[qi].querySelector(`input[name="q${qi}"]:checked`));
  if (!answeredAny) {
    $("quizScore").textContent = "Please choose at least one answer first.";
    return;
  }

  let score = 0;
  quiz.forEach((q, qi) => {
    const wrap = $("quizContainer").children[qi];
    const chosen = wrap.querySelector(`input[name="q${qi}"]:checked`);

    wrap.querySelectorAll(".opt").forEach((label, oi) => {
      label.querySelector("input").disabled = true;
      if (oi === q.answer) label.classList.add("correct");               // show the correct answer
      else if (chosen && Number(chosen.value) === oi) label.classList.add("wrong");
    });

    const isRight = chosen && Number(chosen.value) === q.answer;
    if (isRight) score++;
    $(`fb${qi}`).textContent =
      (isRight ? "Correct. " : `Correct answer: ${q.options[q.answer]}. `) + q.explanation;
  });

  state.quizDone = true;
  $("quizScore").textContent = `Your score: ${score} / ${quiz.length}`;
  $("submitQuiz").hidden = true;
  $("retryQuiz").hidden = false;
  saveScore(score, quiz.length);
}

/* Flashcards */
function renderCards() {
  const box = $("cardsContainer");
  box.innerHTML = "";
  const cards = state.current.result.flashcards;
  if (!state.current.known) state.current.known = {};

  cards.forEach((c, i) => {
    const wrap = document.createElement("div");
    wrap.className = "card-wrap";

    const flip = document.createElement("button");
    flip.type = "button";
    flip.className = "card-flip";
    flip.setAttribute("aria-label", "Flashcard. Click to flip.");
    flip.innerHTML = '<div class="card-inner"><div class="face front"></div><div class="face back"></div></div>';
    flip.querySelector(".front").textContent = c.front;
    flip.querySelector(".back").textContent = c.back;
    flip.addEventListener("click", () => flip.classList.toggle("flipped"));

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const knownBtn = document.createElement("button");
    knownBtn.type = "button"; knownBtn.className = "btn"; knownBtn.textContent = "Known";
    const unknownBtn = document.createElement("button");
    unknownBtn.type = "button"; unknownBtn.className = "btn"; unknownBtn.textContent = "Not known";

    const paint = () => {
      knownBtn.classList.toggle("active-known", state.current.known[i] === true);
      unknownBtn.classList.toggle("active-unknown", state.current.known[i] === false);
    };
    knownBtn.addEventListener("click", () => { state.current.known[i] = true; paint(); updateKnownCount(); });
    unknownBtn.addEventListener("click", () => { state.current.known[i] = false; paint(); updateKnownCount(); });
    paint();

    actions.append(knownBtn, unknownBtn);
    wrap.append(flip, actions);
    box.appendChild(wrap);
  });
  updateKnownCount();
}

function updateKnownCount() {
  const total = state.current.result.flashcards.length;
  const known = Object.values(state.current.known || {}).filter((v) => v === true).length;
  $("knownCount").textContent = `You know ${known} of ${total} cards`;
}

/* Summary tools: copy, download */
async function copySummary() {
  const text = state.current?.result.summary || "";
  try {
    await navigator.clipboard.writeText(text);
    showMessage("Summary copied to clipboard.", "success");
  } catch {
    // fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    showMessage(ok ? "Summary copied to clipboard." : "Could not copy. Please select the text and copy manually.", ok ? "success" : "error");
  }
}

function downloadSummary() {
  const blob = new Blob([state.current.result.summary], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "summary.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Tabs inside the results (Summary / Quiz / Flashcards) */
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active);
  });
  ["summary", "quiz", "cards"].forEach((p) => ($(`panel-${p}`).hidden = p !== name));
}

/* ---------- 7. History & progress ---------- */
function getHistory() { return storeGet(KEYS.history, []); }

function saveToHistory(entry) {
  const list = getHistory();
  list.unshift({ id: entry.id, time: Date.now(), notes: entry.notes, style: entry.style,
                 difficulty: entry.difficulty, result: entry.result });
  storeSet(KEYS.history, list.slice(0, MAX_HISTORY));
  renderHistory();
}

function renderHistory() {
  const term = $("historySearch").value.trim().toLowerCase();
  const list = getHistory().filter((h) =>
    !term || h.notes.toLowerCase().includes(term) || h.result.summary.toLowerCase().includes(term));
  const ul = $("historyList");
  ul.innerHTML = "";

  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = term ? "No history matches your search." : "No history yet. Generate something first.";
    ul.appendChild(li);
    return;
  }

  list.forEach((h) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = h.notes.slice(0, 80) || "(untitled)";
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${new Date(h.time).toLocaleString()} | ${h.style} | ${h.difficulty}`;
    btn.append(title, meta);
    btn.addEventListener("click", () => showFromHistory(h));
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// Open a saved generation again on the Ask page
function showFromHistory(h) {
  state.current = { id: h.id, notes: h.notes, style: h.style, difficulty: h.difficulty, result: h.result, known: {} };
  $("notes").value = h.notes;
  $("style").value = h.style;
  $("difficulty").value = h.difficulty;
  updateCounter();
  clearMessage();
  switchView("ask");
  renderAll();
  switchTab("summary");
  $("results").scrollIntoView({ behavior: "smooth" });
}

function clearHistory() {
  if (getHistory().length === 0) return;
  if (confirm("Delete all saved history? This cannot be undone.")) {
    try { localStorage.removeItem(KEYS.history); } catch { /* ignore */ }
    renderHistory();
  }
}

/* Quiz score tracking */
function saveScore(score, total) {
  const scores = storeGet(KEYS.scores, []);
  scores.push({ score, total, time: Date.now(), difficulty: state.current.difficulty });
  storeSet(KEYS.scores, scores.slice(-30));
  renderProgress();
}

function renderProgress() {
  const scores = storeGet(KEYS.scores, []);
  const box = $("progress");
  box.innerHTML = "";
  if (scores.length === 0) { box.textContent = "No quiz taken yet."; return; }

  const pct = scores.map((s) => Math.round((s.score / s.total) * 100));
  const avg = Math.round(pct.reduce((a, b) => a + b, 0) / pct.length);
  const best = Math.max(...pct);

  const p = document.createElement("p");
  p.textContent = `Quizzes taken: ${scores.length} | Average: ${avg}% | Best: ${best}%`;
  box.appendChild(p);

  const bars = document.createElement("div");
  bars.className = "bars";
  pct.slice(-10).forEach((v) => {
    const b = document.createElement("div");
    b.className = "bar";
    b.style.height = `${Math.max(v, 4)}%`;
    b.title = `${v}%`;
    bars.appendChild(b);
  });
  box.appendChild(bars);
}