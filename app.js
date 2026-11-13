import {
  ESPN, BOARD_QUERIES, FILTERS, mergeBoards, isShown, hasUva, matchesFilter, sortGames, sections,
  statusText, tipTime, scoreRole, etDate, isIsoDate, addDays, dayLabel, dayLabelShort, dayTag, nextDelay,
  oddsUrl, parseLine, shownLine, upsetState, upsetTag, UPSET_MIN, scoreChanges, canRollOver, BIG_SPREAD, isTucked, breaksOut,
} from "./lib.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// esc() stops HTML injection but not a javascript: link, so outside URLs must be http(s).
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? "") ? u : "#");

const state = {
  date: etDate(),
  filter: "all",
  games: [], // shown games for state.date (Power 4, Big East, Top 25, UVA)
  loadedFor: "", // the date state.games belongs to
  updated: null,
  error: "",
  timer: null,
  hiddenAt: 0,
  quietNext: false, // the next load shows new scores without animating (back after 1+ min away)
  loadSeq: 0, // counts loads, so only the newest one's answer is used
  onToday: true, // the day was "today" when it was picked; such a page follows the calendar (see rollIfDue)
  rollPending: false, // back in the tab on a new day: move to today once nothing shown is live
  // Games with a 20+ spread start tucked into a row at the end of their section (see isTucked in lib.js).
  // All three reset when another day loads.
  openTucks: new Set(), // sections ("in" | "pre" | "post") whose tucked games are shown
  brokeOut: new Set(), // tucked games that broke out (upset watch, close late): they stay out for the day
  preSpread: new Map(), // event id → the scoreboard's spread size, kept for once it drops the line at tip
};

// A request that never answers (a phone moving from wifi to cell) would otherwise hold up the whole refresh,
// since the next one is only scheduled after this one settles.
const TIMEOUT_MS = 10 * 1000;

// ---- score-change animation ----
// When a check finds a new score, that number glows for FLASH_MS; when a game becomes an upset watch, its tag
// pops in. Each start time is kept so a re-render mid-animation (a filter tap, lines arriving) continues it
// instead of restarting it. Nothing animates on a day's first load or after 1+ minute in the background,
// when every game would light up at once. Reduce Motion turns it off in style.css.
const FLASH_MS = 1200;
const POP_MS = 900;
const flashAt = new Map(); // "<event id>:away" → ms
const popAt = new Map(); // event id → ms

function anim(map, key, ms, cls) {
  const at = map.get(key);
  if (!at) return { cls: "", style: "" };
  const elapsed = Date.now() - at;
  if (elapsed >= ms) { map.delete(key); return { cls: "", style: "" }; }
  return { cls: ` ${cls}`, style: ` style="animation-delay:-${elapsed}ms"` };
}

function scoreSpan(g, side, extra = "") {
  const a = anim(flashAt, `${g.id}:${side}`, FLASH_MS, "is-flash");
  return `<span class="score score-${scoreRole(g, side)}${extra}${a.cls}"${a.style}>${g[side].score ?? ""}</span>`;
}

// ---- URL: ?d=2026-11-10&f=acc, so the back button and bookmarks work ----

function readUrl() {
  const p = new URLSearchParams(location.search);
  const d = p.get("d");
  const f = p.get("f");
  state.date = isIsoDate(d) ? d : etDate();
  state.onToday = state.date === etDate();
  state.rollPending = false;
  state.filter = FILTERS.some((x) => x.key === f) ? f : "all";
}

function writeUrl(push) {
  const p = new URLSearchParams();
  if (state.date !== etDate()) p.set("d", state.date);
  if (state.filter !== "all") p.set("f", state.filter);
  const url = `${location.pathname}${p.toString() ? `?${p}` : ""}`;
  history[push ? "pushState" : "replaceState"](null, "", url);
}

// ---- data ----

async function getBoard(date, q) {
  const res = await fetch(`${ESPN}?dates=${date.replaceAll("-", "")}&limit=400${q}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

async function load() {
  clearTimeout(state.timer);
  const date = state.date;
  const seq = ++state.loadSeq;
  const results = await Promise.allSettled(BOARD_QUERIES.map((q) => getBoard(date, q)));
  // A newer load has started (another day picked, or back in the tab mid-refresh). Its answer wins, so a
  // slower, older one can't put earlier scores back on the board.
  if (seq !== state.loadSeq) return;
  const boards = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!boards.length) {
    // Keep whatever was showing for this day and say so.
    state.error = state.loadedFor === date ? "Couldn't reach ESPN. Showing the last scores that loaded." : "Couldn't reach ESPN. Try again in a minute.";
  } else {
    const next = mergeBoards(boards).filter(isShown);
    if (state.loadedFor !== date) { state.openTucks.clear(); state.brokeOut.clear(); state.preSpread.clear(); }
    // The scoreboard drops the spread at tip, before the odds feed has been asked; the copy from the last
    // load keeps a just-tipped blowout tucked in the meantime instead of flashing onto the board.
    for (const g of next) {
      if (g.spreadSize != null) state.preSpread.set(g.id, g.spreadSize);
      else if (state.preSpread.has(g.id)) g.spreadSize = state.preSpread.get(g.id);
    }
    if (state.loadedFor === date && !state.quietNext) {
      const now = Date.now();
      const { flashes, pops } = scoreChanges(state.games, next, lines);
      flashes.forEach((k) => flashAt.set(k, now));
      pops.forEach((id) => popAt.set(id, now));
    }
    state.quietNext = false;
    state.games = next;
    state.loadedFor = date;
    state.updated = new Date();
    state.error = boards.length < results.length ? "ESPN didn't answer for every conference, so a few games may be missing." : "";
    // Back on a new day with a game that looked live: these fresh scores settle whether it still is.
    if (state.rollPending) {
      if (rollIfDue()) return;
      state.rollPending = false; // still live: stay on this day until the next return to the tab
    }
  }
  render();
  schedule();
  if (state.loadedFor === date) lookUpLines(state.games);
}

// ---- pre-game betting lines for tipped games (Upsets filter and the card's spread) ----
// One small request per game once it has tipped. The pre-game line never changes after that, so each answer
// (including "no line") is kept on this device and never fetched again.

// v3 saves the spread's display text and pick'em lines; older keys' entries don't fit, so they're dropped and
// looked up again.
const LINES_KEY = "cbb-scores:lines3";
try { ["cbb-scores:lines", "cbb-scores:lines2"].forEach((k) => localStorage.removeItem(k)); } catch { /* blocked: fine */ }
const lines = new Map();
const pending = new Set();
try {
  for (const [id, v] of Object.entries(JSON.parse(localStorage.getItem(LINES_KEY) ?? "{}"))) lines.set(id, v);
} catch { /* storage blocked or bad JSON: look lines up again */ }

function saveLines() {
  try { localStorage.setItem(LINES_KEY, JSON.stringify(Object.fromEntries([...lines].slice(-1500)))); } catch { /* full or blocked: fine */ }
}

async function lookUpLines(games) {
  const queue = games.filter((g) => g.state !== "pre" && !lines.has(g.id) && !pending.has(g.id));
  if (!queue.length) return;
  queue.forEach((g) => pending.add(g.id));
  render();
  const worker = async () => {
    while (queue.length) {
      const g = queue.shift();
      try {
        const res = await fetch(oddsUrl(g.id), { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) lines.set(g.id, parseLine(await res.json()));
        else if (res.status === 404) lines.set(g.id, null);
        // Other failures aren't saved, so the next refresh tries again.
      } catch { /* network hiccup: retried next refresh */ }
      pending.delete(g.id);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker)); // four at a time
  saveLines();
  render();
}

function schedule() {
  clearTimeout(state.timer);
  if (document.hidden) return; // caught up on visibilitychange
  const delay = state.loadedFor === state.date ? nextDelay(state.games) : 60 * 1000;
  if (delay) state.timer = setTimeout(load, delay);
}

// ---- rendering ----

function logo(t, size) {
  const disc = `<span class="disc" style="--team:${esc(t.color)}" aria-hidden="true">${esc(t.abbr)}</span>`;
  if (!t.logo) return `<span class="puck puck-${size}">${disc}</span>`;
  return `<span class="puck puck-${size}"><img class="logo" src="${esc(safeUrl(t.logo))}" alt="" loading="lazy" decoding="async">${disc}</span>`;
}

const rankTag = (t) => (t.rank ? `<span class="rank">${t.rank}</span>` : "");

function teamRow(g, side) {
  const t = g[side];
  const role = scoreRole(g, side);
  return `<div class="team ${role === "lost" ? "is-lost" : ""}">
    ${logo(t, "sm")}
    <div class="team-text">
      <span class="team-name ${role === "won" || role === "lead" ? "is-ahead" : ""}">${rankTag(t)}${esc(t.name)}</span>
      ${t.record ? `<span class="record">${esc(t.record)}</span>` : ""}
    </div>
    ${scoreSpan(g, side)}
  </div>`;
}

function upsetBadge(g) {
  const info = lines.get(g.id);
  const tag = upsetTag(g, info);
  if (!tag) return "";
  const a = anim(popAt, g.id, POP_MS, "is-pop");
  return `<span class="upset-tag upset-${upsetState(g, info)}${a.cls}"${a.style}>${esc(tag)}</span>`;
}

function gameCard(g) {
  const tag = upsetTag(g, lines.get(g.id));
  const label = `${g.away.name} at ${g.home.name}, ${statusText(g)}${tag ? `, ${tag}` : ""}`;
  const meta = [g.tv, shownLine(g, lines.get(g.id))].filter(Boolean).join(" · ");
  return `<a class="game" href="${esc(safeUrl(g.link))}" target="_blank" rel="noopener" aria-label="${esc(label)} (ESPN, new tab)">
    ${upsetBadge(g)}
    ${teamRow(g, "away")}
    ${teamRow(g, "home")}
    <div class="game-foot">
      <span class="status status-${esc(g.state)}">${esc(statusText(g))}</span>
      <span class="meta">${esc(meta)}</span>
    </div>
  </a>`;
}

function heroSide(g, side) {
  const t = g[side];
  return `<div class="hero-team ${scoreRole(g, side) === "lost" ? "is-lost" : ""}">
    ${logo(t, "lg")}
    <span class="hero-name">${rankTag(t)}${esc(t.name)}</span>
    ${t.record ? `<span class="record">${esc(t.record)}</span>` : ""}
  </div>`;
}

function uvaHero(g) {
  const today = etDate();
  const when = g.state === "in" ? "Live" : g.state === "post" ? "Final"
    : state.date === today ? "Today" : dayTag(state.date, today) === "Tomorrow" ? "Tomorrow" : dayLabel(state.date).split(",")[0];
  const middle = g.state === "pre"
    ? `<span class="hero-tip">${esc(tipTime(g))}</span>`
    : `${scoreSpan(g, "away")}<span class="hero-dash">–</span>${scoreSpan(g, "home")}`;
  const foot = [g.state === "pre" ? "" : statusText(g), g.tv, shownLine(g, lines.get(g.id))].filter(Boolean);
  return `<a class="hero" href="${esc(safeUrl(g.link))}" target="_blank" rel="noopener" aria-label="Virginia: ${esc(`${g.away.name} at ${g.home.name}, ${statusText(g)}`)} (ESPN, new tab)">
    <span class="hero-label ${g.state === "in" ? "is-live" : ""}">Virginia · ${esc(when)}</span>
    ${upsetBadge(g)}
    <div class="hero-grid">${heroSide(g, "away")}<div class="hero-score">${middle}</div>${heroSide(g, "home")}</div>
    ${foot.length ? `<div class="hero-foot">${foot.map((x, i) => (i === 0 && g.state !== "pre" ? `<strong>${esc(x)}</strong>` : esc(x))).join(" · ")}</div>` : ""}
  </a>`;
}

function render() {
  const today = etDate();
  const ready = state.loadedFor === state.date;
  const games = ready ? state.games : [];

  // Header
  $("#day").innerHTML = `<span class="day-long">${esc(dayLabel(state.date))}</span><span class="day-short">${esc(dayLabelShort(state.date))}</span>`;
  const live = games.filter((g) => g.state === "in").length;
  const counts = ready ? `${games.length} ${games.length === 1 ? "game" : "games"}${live ? ` · ${live} live` : ""}` : "Loading";
  $("#day-tag").textContent = `${dayTag(state.date, today)} · ${counts}`;
  $("#today-link").hidden = state.date === today;
  const updated = state.updated ? `Updated ${state.updated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "";
  $("#updated").textContent = updated;
  $("#updated-foot").textContent = updated ? `${updated} ·` : "";
  document.title = state.date === today ? "Hoops Board" : `${dayLabel(state.date)} · Hoops Board`;

  // Filters, with how many games each would show
  // Upset counts are still coming in while any of this day's lines are being looked up.
  const checking = games.some((g) => pending.has(g.id));
  $("#filters").innerHTML = FILTERS.map((f) => {
    const n = games.filter((g) => matchesFilter(g, f.key, lines)).length;
    const on = f.key === state.filter;
    const waiting = f.key === "upsets" && checking;
    const count = !ready ? "" : waiting && !n ? "…" : n;
    return `<button type="button" class="chip${on ? " is-on" : ""}" data-filter="${f.key}" aria-pressed="${on}"${ready && !n && !on && !waiting ? " disabled" : ""}>${esc(f.label)}<span class="chip-n">${count}</span></button>`;
  }).join("");

  // UVA first on days they play (under any filter), then everything else
  const uva = games.find(hasUva);
  $("#uva").innerHTML = uva ? uvaHero(uva) : "";
  const rest = sortGames(games.filter((g) => g !== uva && matchesFilter(g, state.filter, lines)));
  const label = FILTERS.find((f) => f.key === state.filter)?.label ?? "";
  const titles = state.filter === "upsets" ? { in: "Upset watch", post: "Upsets" } : {};
  for (const g of games) if (breaksOut(g, lines.get(g.id))) state.brokeOut.add(g.id);
  // The Upsets view only has games worth seeing, so nothing is tucked there.
  const canTuck = state.filter !== "upsets";
  let body = sections(rest).map((s) => {
    const tucked = canTuck ? s.games.filter((g) => isTucked(g, lines.get(g.id), state.brokeOut)) : [];
    const open = state.openTucks.has(s.state);
    // Opened, the tucked games follow the rest so the row that closes them sits right under them.
    const cards = [...s.games.filter((g) => !tucked.includes(g)), ...(open ? tucked : [])];
    const n = `${tucked.length} ${tucked.length === 1 ? "game" : "games"} with a ${BIG_SPREAD}+ spread`;
    const row = tucked.length
      ? `<button type="button" class="tuck" data-tuck="${s.state}" aria-expanded="${open}">${open ? `Hide the ${n}` : `+${n}`}<span class="tuck-act">${open ? "Hide ▴" : "Show ▾"}</span></button>`
      : "";
    return `<section class="section">
      <div class="section-head"><h2>${titles[s.state] ?? s.title}</h2>${cards.length ? `<span class="section-n">${cards.length}</span>` : ""}<span class="court-line"></span></div>
      ${cards.length ? `<div class="grid">${cards.map(gameCard).join("")}</div>` : ""}
      ${row}
    </section>`;
  }).join("");
  if (!ready && !state.error) body = `<p class="empty">Loading games…</p>`;
  else if (ready && !games.length) body = `<p class="empty">No Power 4, Big East or Top 25 games on this day.</p>`;
  else if (ready && !rest.length && state.filter === "upsets") {
    body = checking ? `<p class="empty">Checking betting lines…</p>`
      : `<p class="empty">No upsets on this day: no ${UPSET_MIN}+ point underdog or lower-ranked team has won${games.some((g) => g.state === "in") ? " or is leading" : ""}.</p>`;
  } else if (ready && !rest.length && !uva) body = `<p class="empty">No ${esc(label)} games on this day.</p>`;
  else if (ready && !rest.length) body = state.filter === "all" ? "" : `<p class="empty">No other ${esc(label)} games on this day.</p>`;
  $("#games").innerHTML = body;

  $("#error").hidden = !state.error;
  $("#error").textContent = state.error;
}

// ---- events ----

function goTo(date) {
  state.date = date;
  state.onToday = date === etDate();
  state.rollPending = false;
  writeUrl(true);
  render();
  load();
}

// Moves a page that was left on "today" to the new today (Rudy's rule, 2026-11-11): only when coming back
// to the tab, and only once no game on the shown day is live. True if it moved (and started the load).
function rollIfDue() {
  const today = etDate();
  if (!state.rollPending || !canRollOver(state.date, today, state.loadedFor === state.date ? state.games : [])) return false;
  state.date = today;
  state.onToday = true;
  state.rollPending = false;
  writeUrl(false);
  render();
  load();
  return true;
}

$("#prev").addEventListener("click", () => goTo(addDays(state.date, -1)));
$("#next").addEventListener("click", () => goTo(addDays(state.date, 1)));
$("#today-link").addEventListener("click", (e) => { e.preventDefault(); goTo(etDate()); });

$("#filters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]");
  if (!b || b.disabled) return;
  state.filter = b.dataset.filter;
  writeUrl(false);
  render();
});

$("#games").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tuck]");
  if (!b) return;
  const key = b.dataset.tuck;
  if (!state.openTucks.delete(key)) state.openTucks.add(key);
  render();
  $(`[data-tuck="${key}"]`)?.focus(); // the re-render replaced the button; keep keyboard users in place
});

window.addEventListener("popstate", () => { readUrl(); render(); load(); });

// A logo that fails to load falls back to the team-color disc underneath it.
document.addEventListener("error", (e) => {
  if (e.target instanceof HTMLImageElement && e.target.classList.contains("logo")) e.target.remove();
}, true);

// Don't poll ESPN from a background tab; catch up as soon as it's visible again.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(state.timer);
    state.hiddenAt = Date.now();
  } else {
    // Back after a minute or more: show where things stand without lighting up the whole board.
    if (state.hiddenAt && Date.now() - state.hiddenAt > 60 * 1000) state.quietNext = true;
    state.rollPending = state.onToday && state.date !== etDate();
    if (!rollIfDue()) load();
  }
});

// Light/dark: follows the device until the moon button is used, then remembers the pick on this device.
const THEME_KEY = "cbb-scores:theme";
function applyTheme(t) {
  if (t !== "light" && t !== "dark") return;
  document.documentElement.dataset.theme = t;
  // The browser bar matches the header; a picked theme overrides the device-based theme-color metas.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = t === "dark" ? "#0a1322" : "#1d3557";
}
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { /* storage blocked: follow the device */ }
$("#theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* fine: lasts for this visit */ }
});

readUrl();
writeUrl(false);
render();
load();
