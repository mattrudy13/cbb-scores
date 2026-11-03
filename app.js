import {
  ESPN, BOARD_QUERIES, FILTERS, mergeBoards, isShown, hasUva, matchesFilter, sortGames, sections,
  statusText, tipTime, scoreRole, etDate, isIsoDate, addDays, dayLabel, dayLabelShort, dayTag, nextDelay,
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
};

// ---- URL: ?d=2026-11-10&f=acc, so the back button and bookmarks work ----

function readUrl() {
  const p = new URLSearchParams(location.search);
  const d = p.get("d");
  const f = p.get("f");
  state.date = isIsoDate(d) ? d : etDate();
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
  const res = await fetch(`${ESPN}?dates=${date.replaceAll("-", "")}&limit=400${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

async function load() {
  clearTimeout(state.timer);
  const date = state.date;
  const results = await Promise.allSettled(BOARD_QUERIES.map((q) => getBoard(date, q)));
  if (date !== state.date) return; // the user moved to another day while this was loading
  const boards = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!boards.length) {
    // Keep whatever was showing for this day and say so.
    state.error = state.loadedFor === date ? "Couldn't reach ESPN. Showing the last scores that loaded." : "Couldn't reach ESPN. Try again in a minute.";
  } else {
    state.games = mergeBoards(boards).filter(isShown);
    state.loadedFor = date;
    state.updated = new Date();
    state.error = boards.length < results.length ? "ESPN didn't answer for every conference, so a few games may be missing." : "";
  }
  render();
  schedule();
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
    <span class="score score-${role}">${t.score ?? ""}</span>
  </div>`;
}

function gameCard(g) {
  const label = `${g.away.name} at ${g.home.name}, ${statusText(g)}`;
  const meta = [g.tv, g.state === "pre" ? g.line : ""].filter(Boolean).join(" · ");
  return `<a class="game" href="${esc(safeUrl(g.link))}" target="_blank" rel="noopener" aria-label="${esc(label)} (ESPN, new tab)">
    ${teamRow(g, "away")}
    ${teamRow(g, "home")}
    <div class="game-foot">
      <span class="status status-${g.state}">${esc(statusText(g))}</span>
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
    : `<span class="score score-${scoreRole(g, "away")}">${g.away.score ?? ""}</span><span class="hero-dash">–</span><span class="score score-${scoreRole(g, "home")}">${g.home.score ?? ""}</span>`;
  const foot = [g.state === "pre" ? "" : statusText(g), g.tv, g.state === "pre" ? g.line : ""].filter(Boolean);
  return `<a class="hero" href="${esc(safeUrl(g.link))}" target="_blank" rel="noopener" aria-label="Virginia: ${esc(`${g.away.name} at ${g.home.name}, ${statusText(g)}`)} (ESPN, new tab)">
    <span class="hero-label ${g.state === "in" ? "is-live" : ""}">Virginia · ${esc(when)}</span>
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
  $("#filters").innerHTML = FILTERS.map((f) => {
    const n = games.filter((g) => matchesFilter(g, f.key)).length;
    const on = f.key === state.filter;
    return `<button type="button" class="chip${on ? " is-on" : ""}" data-filter="${f.key}" aria-pressed="${on}"${ready && !n && !on ? " disabled" : ""}>${esc(f.label)}<span class="chip-n">${ready ? n : ""}</span></button>`;
  }).join("");

  // UVA first on days they play (under any filter), then everything else
  const uva = games.find(hasUva);
  $("#uva").innerHTML = uva ? uvaHero(uva) : "";
  const rest = sortGames(games.filter((g) => g !== uva && matchesFilter(g, state.filter)));
  const label = FILTERS.find((f) => f.key === state.filter)?.label ?? "";
  let body = sections(rest).map((s) => `<section class="section">
      <div class="section-head"><h2>${s.title}</h2><span class="section-n">${s.games.length}</span><span class="court-line"></span></div>
      <div class="grid">${s.games.map(gameCard).join("")}</div>
    </section>`).join("");
  if (!ready && !state.error) body = `<p class="empty">Loading games…</p>`;
  else if (ready && !games.length) body = `<p class="empty">No Power 4, Big East or Top 25 games on this day.</p>`;
  else if (ready && !rest.length && !uva) body = `<p class="empty">No ${esc(label)} games on this day.</p>`;
  else if (ready && !rest.length) body = state.filter === "all" ? "" : `<p class="empty">No other ${esc(label)} games on this day.</p>`;
  $("#games").innerHTML = body;

  $("#error").hidden = !state.error;
  $("#error").textContent = state.error;
}

// ---- events ----

function goTo(date) {
  state.date = date;
  writeUrl(true);
  render();
  load();
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

window.addEventListener("popstate", () => { readUrl(); render(); load(); });

// A logo that fails to load falls back to the team-color disc underneath it.
document.addEventListener("error", (e) => {
  if (e.target instanceof HTMLImageElement && e.target.classList.contains("logo")) e.target.remove();
}, true);

// Don't poll ESPN from a background tab; catch up as soon as it's visible again.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(state.timer);
  else load();
});

// Light/dark: follows the device until the moon button is used, then remembers the pick on this device.
const THEME_KEY = "cbb-scores:theme";
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
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
