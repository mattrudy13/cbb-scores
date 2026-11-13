// Pure helpers: turn ESPN's scoreboard JSON into games, decide which to show, sort and label them.
// No DOM or network here, so `node --test` can check them.

export const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";
export const UVA_ID = "258";
export const TZ = "America/New_York";

// ESPN conference ids (team.conferenceId) for the leagues whose games are always shown.
export const MAJOR_CONFS = { "2": "ACC", "7": "Big Ten", "8": "Big 12", "23": "SEC", "4": "Big East" };

// The full Division I board is ~1.7 MB on a busy Saturday. The default board (every game with a ranked team)
// plus one board per major conference covers the same games at a fraction of that.
export const BOARD_QUERIES = ["", "&groups=2", "&groups=7", "&groups=8", "&groups=23", "&groups=4"];

export const FILTERS = [
  { key: "all", label: "All" },
  { key: "top25", label: "Top 25" },
  { key: "upsets", label: "Upsets" },
  { key: "acc", label: "ACC", conf: "2" },
  { key: "b10", label: "Big Ten", conf: "7" },
  { key: "b12", label: "Big 12", conf: "8" },
  { key: "sec", label: "SEC", conf: "23" },
  { key: "be", label: "Big East", conf: "4" },
];

// Short names for the conference record ("4-0 ACC"). ESPN's groups endpoint has no ids, so this list is
// kept by hand; an id missing here just reads "conf".
export const CONF_SHORT = {
  "1": "AmEast", "2": "ACC", "3": "A-10", "4": "Big East", "5": "Big Sky", "6": "Big South", "7": "Big Ten",
  "8": "Big 12", "9": "Big West", "10": "CAA", "11": "C-USA", "12": "Ivy", "13": "MAAC", "14": "MAC",
  "16": "MEAC", "18": "MVC", "19": "NEC", "20": "OVC", "21": "Pac-12", "22": "Patriot", "23": "SEC",
  "24": "SoCon", "25": "Southland", "26": "SWAC", "27": "Sun Belt", "29": "WCC", "30": "WAC",
  "44": "MWC", "45": "Horizon", "46": "ASUN", "49": "Summit", "62": "American",
};

// "13-2", or "13-2 · 4-0 ACC" once the team has played a conference game (Rudy's choice: no "0-0 ACC"
// line through November and December).
export function recordLine(total, conf, confId) {
  if (!total) return "";
  if (conf && conf !== "0-0") return `${total} · ${conf} ${CONF_SHORT[confId] ?? "conf"}`;
  return total;
}

function team(comp) {
  const t = comp?.team ?? {};
  const recs = comp?.records ?? [];
  const rank = Number(comp?.curatedRank?.current);
  const confId = t.conferenceId != null ? String(t.conferenceId) : "";
  const score = comp?.score;
  return {
    id: String(t.id ?? ""),
    name: t.shortDisplayName || t.location || t.displayName || "TBD",
    abbr: t.abbreviation ?? "",
    logo: t.logo ?? "",
    color: /^[0-9a-f]{6}$/i.test(t.color ?? "") ? `#${t.color}` : "#7a6a58",
    confId,
    rank: rank >= 1 && rank <= 25 ? rank : 0,
    score: score === undefined || score === null || score === "" ? null : Number(score),
    record: recordLine(recs.find((r) => r.type === "total")?.summary ?? "", recs.find((r) => r.type === "vsconf")?.summary ?? "", confId),
    winner: comp?.winner === true,
  };
}

// ESPN's spread reads "UVA -28.5"; a real minus sign reads better. Takes the scoreboard's `odds` or the odds
// feed's line item (both have `details` and `overUnder`).
export function lineText(odds) {
  if (!odds) return "";
  const parts = [];
  if (odds.details) parts.push(String(odds.details).replace(/ -(?=\d)/, " −"));
  if (odds.overUnder) parts.push(`O/U ${odds.overUnder}`);
  return parts.join(" · ");
}

// Seconds left in the current period: ESPN's numeric `clock`, else parsed from "14:30" or "45.2".
function clockSeconds(status) {
  const n = Number(status?.clock);
  if (Number.isFinite(n)) return n;
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(status?.displayClock ?? "");
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : 0;
}

export function normalizeEvent(ev) {
  const c = ev?.competitions?.[0];
  if (!c || !Array.isArray(c.competitors)) return null;
  const st = c.status?.type ?? {};
  const links = ev.links ?? [];
  const away = team(c.competitors.find((x) => x.homeAway === "away") ?? c.competitors[0]);
  const home = team(c.competitors.find((x) => x.homeAway === "home") ?? c.competitors[1]);
  // ESPN sends "0" before tip-off; a game that hasn't started has no score yet.
  if ((st.state ?? "pre") === "pre") away.score = home.score = null;
  return {
    id: String(ev.id),
    start: ev.date ?? c.date ?? "",
    timeValid: c.timeValid !== false,
    state: st.state ?? "pre", // pre | in | post
    statusName: st.name ?? "",
    shortDetail: st.shortDetail ?? "",
    clock: c.status?.displayClock ?? "",
    clockSec: clockSeconds(c.status),
    period: Number(c.status?.period ?? 0),
    tv: c.broadcasts?.[0]?.names?.[0] ?? c.broadcast ?? "",
    line: lineText(c.odds?.[0]),
    // The spread's size as a number (28.5), for hiding lopsided games; null without a line.
    spreadSize: c.odds?.[0]?.spread != null && Number.isFinite(Number(c.odds[0].spread)) ? Math.abs(Number(c.odds[0].spread)) : null,
    link: (links.find((l) => (l.rel ?? []).includes("summary")) ?? links[0])?.href ?? "",
    away,
    home,
  };
}

// How far along a game is. Each board is its own request, so one can be a few seconds staler than
// another; the furthest-along copy wins.
const progress = (g) => ({ pre: 0, in: 1, post: 2 }[g.state] ?? 0) * 1e6 + g.period * 1e4 + (g.away.score ?? 0) + (g.home.score ?? 0);

// Merge several boards; a game in two conferences' boards (or the ranked board) appears once.
export function mergeBoards(boards) {
  const byId = new Map();
  for (const b of boards) {
    for (const ev of b?.events ?? []) {
      const g = normalizeEvent(ev);
      if (g && (!byId.has(g.id) || progress(g) >= progress(byId.get(g.id)))) byId.set(g.id, g);
    }
  }
  return [...byId.values()];
}

const teams = (g) => [g.away, g.home];
export const hasUva = (g) => teams(g).some((t) => t.id === UVA_ID);
export const isShown = (g) => teams(g).some((t) => t.rank || MAJOR_CONFS[t.confId] || t.id === UVA_ID);

// `lines` (event id → parsed line, see parseLine) is only needed for the Upsets filter.
export function matchesFilter(g, key, lines) {
  const f = FILTERS.find((x) => x.key === key);
  if (!f || f.key === "all") return true;
  if (f.key === "top25") return teams(g).some((t) => t.rank);
  if (f.key === "upsets") return !!upsetState(g, lines?.get(g.id));
  return teams(g).some((t) => t.confId === f.conf);
}

// ---- upsets ----
// The scoreboard drops the spread once a game tips, so lines come from ESPN's per-game odds feed (~7 KB),
// which keeps the pre-game DraftKings line next to a separate "Live Odds" entry.

export const UPSET_MIN = 5; // Rudy's rule: an underdog of 5+ points
// A live game is an "Upset watch" from halftime on; in the first half only if the underdog leads by this much
// (Rudy's rule, v0.9): a heavy favorite down 4-2 two minutes in isn't a watch yet, but down 14 late in the half is.
export const WATCH_EARLY_LEAD = 10;
export const oddsUrl = (id) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/${id}/competitions/${id}/odds`;

// The pre-game line from that feed: { fav: "home" | "away" | null, line: 8.5, spread: "NIU −8.5" }, or null
// for no line. A pick'em has line 0 and fav null, so it never counts toward an upset but still shows ("EVEN").
export function parseLine(json) {
  const items = json?.items ?? [];
  const pre = items.filter((x) => !/live/i.test(x?.provider?.name ?? "") && x?.spread != null);
  const o = pre.find((x) => /draftkings/i.test(x.provider?.name ?? "")) ?? pre[0];
  if (!o) return null;
  const line = Math.abs(Number(o.spread));
  // `spread` is from the home team's side (-7.5 = home favored); the favorite flags say it directly.
  const homeFav = o.homeTeamOdds?.favorite ?? (o.awayTeamOdds?.favorite != null ? !o.awayTeamOdds.favorite : Number(o.spread) < 0);
  return { fav: line ? (homeFav ? "home" : "away") : null, line, spread: lineText({ details: o.details }) };
}

// The line shown on a card: the scoreboard's spread + O/U before tip; after (live and final), just the saved
// pre-game spread (Rudy's pick: the O/U isn't worth the room once there's a score).
export const shownLine = (g, info) => (g.state === "pre" ? g.line : info?.spread ?? "");

// Why a game is (or is becoming) an upset, or null. Two rules (Rudy's):
// - spread: the winner (or the live leader) was an underdog of UPSET_MIN+ points;
// - rank: a ranked team lost to (or trails) an unranked or lower-ranked team, whatever the spread said.
// A live game only counts from halftime on, or earlier with a WATCH_EARLY_LEAD+ point lead.
// Returns { state: "upset" | "watch", why: "spread" | "rank", side, line?, beatenRank? }.
export function upsetInfo(g, info) {
  const { away, home } = g;
  if (away.score === null || home.score === null || away.score === home.score) return null;
  let state;
  if (g.state === "post" && !/POSTPONED|CANCELED|CANCELLED|FORFEIT/.test(g.statusName)) state = "upset";
  else if (g.state === "in") {
    // secondsLeft() is 20:00 at halftime and the end of the 1st half, so both count as the 2nd half.
    if (secondsLeft(g) > 20 * 60 && Math.abs(away.score - home.score) < WATCH_EARLY_LEAD) return null;
    state = "watch";
  } else return null;
  const side = (g.state === "post" && (away.winner || home.winner)) ? (away.winner ? "away" : "home") : away.score > home.score ? "away" : "home";
  const ahead = g[side];
  const behind = g[side === "away" ? "home" : "away"];
  if (info && info.line >= UPSET_MIN && info.fav !== side) return { state, why: "spread", side, line: info.line };
  if (behind.rank && (!ahead.rank || ahead.rank > behind.rank)) return { state, why: "rank", side, beatenRank: behind.rank };
  return null;
}

// "upset", "watch" or null.
export const upsetState = (g, info) => upsetInfo(g, info)?.state ?? null;

// The card tag: "Upset · GRAM +8.5", "Upset watch · ND +7.5", or by rank "Upset · UCLA over #5".
export function upsetTag(g, info) {
  const u = upsetInfo(g, info);
  if (!u) return "";
  const t = g[u.side];
  const why = u.why === "spread" ? `+${u.line}` : `over #${u.beatenRank}`;
  return `${u.state === "upset" ? "Upset" : "Upset watch"} · ${t.abbr || t.name} ${why}`;
}

const margin = (g) => Math.abs((g.away.score ?? 0) - (g.home.score ?? 0));
const startMs = (g) => Date.parse(g.start) || 0;

// Men's games are two 20-minute halves, then 5-minute overtimes.
export function secondsLeft(g) {
  if (g.statusName === "STATUS_HALFTIME") return 20 * 60;
  if (g.statusName === "STATUS_END_PERIOD") return g.period <= 1 ? 20 * 60 : 0;
  if (g.period <= 0) return 40 * 60;
  return g.period === 1 ? 20 * 60 + g.clockSec : g.clockSec;
}

// A live game within this many points sorts above the blowouts (Rudy's pick).
export const CLOSE_MARGIN = 10;

// Live first: close games (within 10) by least time left, then blowouts by least time left. Then
// upcoming by tip time, then finals by tip time.
export function sortGames(games) {
  const rank = { in: 0, pre: 1, post: 2 };
  const live = (a, b) =>
    (margin(a) > CLOSE_MARGIN) - (margin(b) > CLOSE_MARGIN) ||
    secondsLeft(a) - secondsLeft(b) ||
    margin(a) - margin(b);
  return [...games].sort((a, b) =>
    (rank[a.state] ?? 1) - (rank[b.state] ?? 1) ||
    (a.state === "in" && b.state === "in" ? live(a, b) : 0) ||
    startMs(a) - startMs(b) ||
    a.home.name.localeCompare(b.home.name));
}

// ---- lopsided games ----
// A game with a 20+ point spread starts tucked into a collapsed row at the end of its section (Rudy's rule,
// 2026-11-13: a ranked team favored by 35 isn't worth a card). It comes out once it gets interesting: an
// upset watch (or upset), or within CLOSE_MARGIN in the 2nd half or OT. app.js keeps it out for the rest
// of the day after that, so a card never vanishes while it's being watched.
export const BIG_SPREAD = 20;

// The pre-game spread's size: the odds feed's saved line once the game has tipped, else the scoreboard's.
// A game with no line at all is never tucked.
export function spreadSize(g, info) {
  if (g.state !== "pre" && info) return info.line;
  return g.spreadSize ?? null;
}

// Interesting enough to show even with a 20+ spread.
export function breaksOut(g, info) {
  if (upsetState(g, info)) return true;
  return g.state === "in" && g.period >= 2 && margin(g) <= CLOSE_MARGIN;
}

// Tucked away by default: a 20+ spread that hasn't broken out (`brokeOut` = ids that already did today).
export const isTucked = (g, info, brokeOut) => (spreadSize(g, info) ?? 0) >= BIG_SPREAD && !breaksOut(g, info) && !brokeOut?.has(g.id);

export const SECTION_TITLES = { in: "Live", pre: "Up next", post: "Final" };

export function sections(games) {
  return ["in", "pre", "post"]
    .map((state) => ({ state, title: SECTION_TITLES[state], games: games.filter((g) => g.state === state) }))
    .filter((s) => s.games.length);
}

const periodName = (p) => (p <= 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "OT" : `${p - 2}OT`);

export function tipTime(g) {
  if (!g.timeValid) return "TBA";
  const d = new Date(g.start);
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

// The one-line status: "2nd · 14:30", "Halftime", "8:00 PM", "Final", "Final · OT", "Postponed".
export function statusText(g) {
  const odd = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED|FORFEIT/.test(g.statusName);
  if (odd) return g.shortDetail || "Postponed";
  if (g.state === "pre") return tipTime(g);
  if (g.state === "in") {
    if (g.statusName === "STATUS_HALFTIME") return "Halftime";
    if (g.statusName === "STATUS_END_PERIOD") return `End ${periodName(g.period)}`;
    return `${periodName(g.period)} · ${g.clock}`;
  }
  return g.period > 2 ? `Final · ${periodName(g.period)}` : "Final";
}

// Leader / trailer / loser for each side, used for the score styling.
export function scoreRole(g, side) {
  const me = g[side];
  const other = g[side === "away" ? "home" : "away"];
  if (g.state === "pre" || me.score === null || other.score === null) return "none";
  if (g.state === "post") return me.winner || me.score > other.score ? "won" : "lost";
  return me.score > other.score ? "lead" : "trail";
}

// ---- score-change animation ----
// What changed between two loads of the same day: the scores to flash ("<id>:away" / "<id>:home") and the
// games that just became an upset watch (their tag pops in). The caller decides when not to animate at all
// (first load of a day, or catching up after a minute or more in the background).
export function scoreChanges(before, after, lines) {
  const old = new Map(before.map((g) => [g.id, g]));
  const flashes = [];
  const pops = [];
  for (const g of after) {
    const o = old.get(g.id);
    if (!o) continue;
    for (const side of ["away", "home"]) {
      if (g[side].score !== null && o[side].score !== null && g[side].score !== o[side].score) flashes.push(`${g.id}:${side}`);
    }
    const info = lines?.get(g.id);
    if (upsetState(g, info) === "watch" && upsetState(o, info) !== "watch") pops.push(g.id);
  }
  return { flashes, pops };
}

// ---- dates (all in Eastern time, which is how ESPN groups a day's games) ----

export function etDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
}

// "Tue, Nov 3": the phone header, where "Wednesday, Nov 11" would wrap onto two lines.
export function dayLabelShort(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

export function dayTag(iso, today) {
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  if (iso === addDays(today, 1)) return "Tomorrow";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric" });
}

// A tab left open overnight still shows yesterday. Coming back to it, the board moves on to today once the
// Eastern date has changed and nothing on the shown day is still live (so a late West Coast game stays up
// past midnight). The caller only asks when the page was on "today" before it was hidden.
export const canRollOver = (shown, today, games) => shown !== today && !games.some((g) => g.state === "in");

// How long until the next refresh, or null for none: every 30 s while a game is live or about to tip,
// every 10 min on a day with games still to come, never for a finished day.
export function nextDelay(games, now = Date.now()) {
  const soon = 15 * 60 * 1000;
  if (games.some((g) => g.state === "in" || (g.state === "pre" && g.timeValid && startMs(g) - now < soon))) return 30 * 1000;
  if (games.some((g) => g.state === "pre")) return 10 * 60 * 1000;
  return null;
}
