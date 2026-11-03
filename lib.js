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

// ESPN's spread reads "UVA -28.5"; a real minus sign reads better.
function lineText(odds) {
  if (!odds) return "";
  const parts = [];
  if (odds.details) parts.push(String(odds.details).replace(/ -(?=\d)/, " −"));
  if (odds.overUnder) parts.push(`O/U ${odds.overUnder}`);
  return parts.join(" · ");
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
    period: Number(c.status?.period ?? 0),
    tv: c.broadcasts?.[0]?.names?.[0] ?? c.broadcast ?? "",
    line: lineText(c.odds?.[0]),
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

export function matchesFilter(g, key) {
  const f = FILTERS.find((x) => x.key === key);
  if (!f || f.key === "all") return true;
  if (f.key === "top25") return teams(g).some((t) => t.rank);
  return teams(g).some((t) => t.confId === f.conf);
}

const margin = (g) => Math.abs((g.away.score ?? 0) - (g.home.score ?? 0));
const startMs = (g) => Date.parse(g.start) || 0;

// Live first (closest game first), then upcoming by tip time, then finals by tip time.
export function sortGames(games) {
  const rank = { in: 0, pre: 1, post: 2 };
  return [...games].sort((a, b) =>
    (rank[a.state] ?? 1) - (rank[b.state] ?? 1) ||
    (a.state === "in" ? margin(a) - margin(b) : 0) ||
    startMs(a) - startMs(b) ||
    a.home.name.localeCompare(b.home.name));
}

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

// How long until the next refresh, or null for none: every 30 s while a game is live or about to tip,
// every 10 min on a day with games still to come, never for a finished day.
export function nextDelay(games, now = Date.now()) {
  const soon = 15 * 60 * 1000;
  if (games.some((g) => g.state === "in" || (g.state === "pre" && g.timeValid && startMs(g) - now < soon))) return 30 * 1000;
  if (games.some((g) => g.state === "pre")) return 10 * 60 * 1000;
  return null;
}
