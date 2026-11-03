import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordLine, normalizeEvent, mergeBoards, isShown, hasUva, matchesFilter, sortGames, sections,
  statusText, scoreRole, addDays, dayLabel, dayTag, isIsoDate, nextDelay, parseLine, upsetState, upsetTag,
  scoreChanges,
} from "../lib.js";

// A trimmed ESPN scoreboard event (only the fields lib.js reads).
function ev({ id, state = "pre", name = "STATUS_SCHEDULED", period = 0, clock = "0:00", date = "2026-11-04T00:30Z",
  away, home, odds, timeValid = true }) {
  const side = (homeAway, t) => ({
    homeAway,
    score: t.score ?? "0",
    winner: t.winner,
    curatedRank: { current: t.rank ?? 99 },
    records: [{ type: "total", summary: t.total ?? "0-0" }, { type: "vsconf", summary: t.conf ?? "0-0" }],
    team: { id: t.id, shortDisplayName: t.name, abbreviation: t.abbr ?? t.name.slice(0, 4).toUpperCase(), color: "232d4b", conferenceId: t.confId, logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png` },
  });
  return {
    id, date,
    links: [{ rel: ["summary", "desktop", "event"], href: `https://www.espn.com/mens-college-basketball/game/_/gameId/${id}` }],
    competitions: [{
      timeValid,
      status: { displayClock: clock, period, type: { state, name, shortDetail: "" } },
      broadcasts: [{ names: ["ACC Network"] }],
      odds: odds ? [odds] : undefined,
      competitors: [side("home", home), side("away", away)],
    }],
  };
}

const UVA = { id: "258", name: "Virginia", confId: "2", rank: 9 };
const DREXEL = { id: "2182", name: "Drexel", confId: "10" };
const VT = { id: "259", name: "Virginia Tech", confId: "2" };
const GONZAGA = { id: "2250", name: "Gonzaga", confId: "29", rank: 5 };
const SMALL1 = { id: "1", name: "Small A", confId: "26" };
const SMALL2 = { id: "2", name: "Small B", confId: "24" };
const UCONN = { id: "41", name: "UConn", confId: "4" };

test("record line: overall only until a conference game is played", () => {
  assert.equal(recordLine("3-1", "0-0", "2"), "3-1");
  assert.equal(recordLine("13-2", "4-0", "2"), "13-2 · 4-0 ACC");
  assert.equal(recordLine("13-2", "4-0", "999"), "13-2 · 4-0 conf");
  assert.equal(recordLine("", "", "2"), "");
});

test("normalizeEvent reads teams, rank, line and link", () => {
  const g = normalizeEvent(ev({ id: "9", away: DREXEL, home: UVA, odds: { details: "UVA -28.5", overUnder: 142.5 } }));
  assert.equal(g.away.name, "Drexel");
  assert.equal(g.home.rank, 9);
  assert.equal(g.away.rank, 0); // 99 = unranked
  assert.equal(g.line, "UVA −28.5 · O/U 142.5");
  assert.equal(g.tv, "ACC Network");
  assert.match(g.link, /gameId\/9$/);
  assert.equal(g.home.score, null); // ESPN's "0" before tip-off is not a score
});

test("mergeBoards keeps one copy of a game that is on two boards", () => {
  const a = ev({ id: "1", away: DREXEL, home: UVA });
  const games = mergeBoards([{ events: [a] }, { events: [a, ev({ id: "2", away: SMALL1, home: VT })] }]);
  assert.deepEqual(games.map((g) => g.id).sort(), ["1", "2"]);
});

test("mergeBoards keeps the furthest-along copy when boards disagree", () => {
  const live = (a, h) => ev({ id: "7", state: "in", name: "STATUS_IN_PROGRESS", period: 2, clock: "5:00", away: { ...DREXEL, score: a }, home: { ...UVA, score: h } });
  const fresh = live("40", "50");
  const stale = live("38", "48");
  for (const order of [[fresh, stale], [stale, fresh]]) {
    const [g] = mergeBoards(order.map((e) => ({ events: [e] })));
    assert.equal(g.home.score, 50);
  }
});

test("shown games: a major conference, a ranked team or UVA", () => {
  const shown = (away, home) => isShown(normalizeEvent(ev({ id: "x", away, home })));
  assert.equal(shown(SMALL1, VT), true);
  assert.equal(shown(SMALL1, UCONN), true); // Big East counts
  assert.equal(shown(SMALL1, GONZAGA), true); // ranked, outside the majors
  assert.equal(shown(SMALL1, SMALL2), false);
});

test("filters: either team counts", () => {
  const g = normalizeEvent(ev({ id: "x", away: GONZAGA, home: VT }));
  assert.equal(matchesFilter(g, "all"), true);
  assert.equal(matchesFilter(g, "top25"), true);
  assert.equal(matchesFilter(g, "acc"), true);
  assert.equal(matchesFilter(g, "sec"), false);
  assert.equal(hasUva(g), false);
});

test("sort: live (closest first), then upcoming by tip, then final", () => {
  const live = (id, a, h) => normalizeEvent(ev({ id, state: "in", name: "STATUS_IN_PROGRESS", period: 2, clock: "10:00", away: { ...SMALL1, score: a }, home: { ...VT, score: h } }));
  const pre = (id, date) => normalizeEvent(ev({ id, date, away: SMALL1, home: VT }));
  const fin = normalizeEvent(ev({ id: "f", state: "post", name: "STATUS_FINAL", period: 2, away: SMALL1, home: VT }));
  const out = sortGames([fin, pre("late", "2026-11-04T02:00Z"), live("blowout", "40", "70"), pre("early", "2026-11-04T00:00Z"), live("close", "50", "51")]);
  assert.deepEqual(out.map((g) => g.id), ["close", "blowout", "early", "late", "f"]);
  assert.deepEqual(sections(out).map((s) => s.title), ["Live", "Up next", "Final"]);
});

test("live sort: close games by least time left, then blowouts by least time left", () => {
  const live = (id, period, clock, a, h, name = "STATUS_IN_PROGRESS") => normalizeEvent(ev({ id, state: "in", name, period, clock,
    away: { ...SMALL1, score: a }, home: { ...VT, score: h } }));
  const out = sortGames([
    live("early-tie", 1, "15:00", "10", "10"), // 35:00 left
    live("half", 1, "0:00", "30", "33", "STATUS_HALFTIME"), // 20:00 left
    live("blowout-late", 2, "0:58", "50", "75"), // 0:58 left, 25 points
    live("ot", 3, "2:10", "70", "72"), // overtime, 2:10 left
    live("late-close", 2, "3:05", "60", "57"), // 3:05 left, 3 points
    live("blowout-early", 1, "12:00", "5", "25"),
  ]);
  assert.deepEqual(out.map((g) => g.id), ["ot", "late-close", "half", "early-tie", "blowout-late", "blowout-early"]);
});

test("status text", () => {
  const base = { away: SMALL1, home: VT };
  assert.equal(statusText(normalizeEvent(ev({ id: "a", state: "in", name: "STATUS_IN_PROGRESS", period: 2, clock: "14:30", ...base }))), "2nd · 14:30");
  assert.equal(statusText(normalizeEvent(ev({ id: "b", state: "in", name: "STATUS_HALFTIME", period: 1, ...base }))), "Halftime");
  assert.equal(statusText(normalizeEvent(ev({ id: "c", state: "in", name: "STATUS_IN_PROGRESS", period: 4, clock: "1:02", ...base }))), "2OT · 1:02");
  assert.equal(statusText(normalizeEvent(ev({ id: "d", state: "post", name: "STATUS_FINAL", period: 3, ...base }))), "Final · OT");
  assert.equal(statusText(normalizeEvent(ev({ id: "e", date: "2026-11-04T00:30Z", ...base }))), "7:30 PM");
  assert.equal(statusText(normalizeEvent(ev({ id: "f", timeValid: false, ...base }))), "TBA");
});

test("score roles", () => {
  const g = normalizeEvent(ev({ id: "a", state: "post", name: "STATUS_FINAL", period: 2, away: { ...SMALL1, score: "61" }, home: { ...VT, score: "88", winner: true } }));
  assert.equal(scoreRole(g, "home"), "won");
  assert.equal(scoreRole(g, "away"), "lost");
  const p = normalizeEvent(ev({ id: "b", away: SMALL1, home: VT }));
  assert.equal(scoreRole(p, "home"), "none");
});

test("dates", () => {
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(dayLabel("2026-11-03"), "Tuesday, Nov 3");
  assert.equal(dayTag("2026-11-02", "2026-11-03"), "Yesterday");
  assert.equal(isIsoDate("2026-11-03"), true);
  assert.equal(isIsoDate("nope"), false);
});

test("parseLine takes the pre-game DraftKings line, not the live one", () => {
  // Shape of ESPN's core odds feed for a live game (UConn favored at home).
  const live = { items: [
    { provider: { name: "DraftKings - Live Odds" }, details: "CONN -39.5", spread: -39.5, homeTeamOdds: { favorite: true } },
    { provider: { name: "DraftKings" }, details: "CONN -41.5", spread: -41.5, homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } },
  ] };
  assert.deepEqual(parseLine(live), { fav: "home", line: 41.5, details: "CONN -41.5" });
  // Away favorite, told only by the sign of the home-side spread.
  assert.deepEqual(parseLine({ items: [{ provider: { name: "DraftKings" }, details: "NIU -8.5", spread: 8.5 }] }), { fav: "away", line: 8.5, details: "NIU -8.5" });
  assert.equal(parseLine({ items: [{ provider: { name: "DraftKings" }, details: "EVEN", spread: 0 }] }), null);
  assert.equal(parseLine({ items: [] }), null);
});

test("upsets: a 5+ underdog that won, or is leading live", () => {
  const NIU = { id: "2459", name: "N Illinois", abbr: "NIU", confId: "14" };
  const GRAM = { id: "2755", name: "Grambling", abbr: "GRAM", confId: "26" };
  const game = (state, name, a, h, winner) => normalizeEvent(ev({ id: "u", state, name, period: 2, clock: "3:00",
    away: { ...GRAM, score: a, winner: winner === "away" }, home: { ...NIU, score: h, winner: winner === "home" } }));
  const niuBy = (line) => ({ fav: "home", line, details: `NIU -${line}` });
  const final = game("post", "STATUS_FINAL", "89", "87", "away");
  assert.equal(upsetState(final, niuBy(8.5)), "upset");
  assert.equal(upsetTag(final, niuBy(8.5)), "Upset · GRAM +8.5");
  assert.equal(upsetState(final, niuBy(4.5)), null); // under the 5-point rule
  assert.equal(upsetState(game("post", "STATUS_FINAL", "70", "80", "home"), niuBy(8.5)), null); // favorite won
  const live = game("in", "STATUS_IN_PROGRESS", "50", "44");
  assert.equal(upsetState(live, niuBy(7.5)), "watch");
  assert.equal(upsetTag(live, niuBy(7.5)), "Upset watch · GRAM +7.5");
  assert.equal(upsetState(game("in", "STATUS_IN_PROGRESS", "40", "44"), niuBy(7.5)), null); // favorite leads
  assert.equal(upsetState(final, null), null); // no line, nobody ranked
  assert.equal(matchesFilter(final, "upsets", new Map([["u", niuBy(8.5)]])), true);
  assert.equal(matchesFilter(final, "upsets", new Map()), false);
});

test("upsets by rank: a ranked team loses to an unranked or lower-ranked team, whatever the spread", () => {
  const ARIZ = { id: "12", name: "Arizona", abbr: "ARIZ", confId: "8", rank: 5 };
  const UCLA = { id: "26", name: "UCLA", abbr: "UCLA", confId: "7", rank: 22 };
  const KU = { id: "2305", name: "Kansas", abbr: "KU", confId: "8" }; // unranked
  const game = (state, name, away, home, a, h, winner) => normalizeEvent(ev({ id: "r", state, name, period: 2, clock: "1:00",
    away: { ...away, score: a, winner: winner === "away" }, home: { ...home, score: h, winner: winner === "home" } }));
  // #22 beats #5 with UCLA favored by 2 (spread rule can't apply): still an upset, by rank.
  const g1 = game("post", "STATUS_FINAL", ARIZ, UCLA, "70", "75", "home");
  const uclaBy2 = { fav: "home", line: 2, details: "UCLA -2" };
  assert.equal(upsetState(g1, uclaBy2), "upset");
  assert.equal(upsetTag(g1, uclaBy2), "Upset · UCLA over #5");
  // Unranked Kansas, a 6-point favorite, beats #5: an upset by rank even though the favorite won.
  const g2 = game("post", "STATUS_FINAL", ARIZ, KU, "60", "66", "home");
  assert.equal(upsetTag(g2, { fav: "home", line: 6, details: "KU -6" }), "Upset · KU over #5");
  // The higher-ranked team winning is not an upset.
  assert.equal(upsetState(game("post", "STATUS_FINAL", ARIZ, UCLA, "80", "70", "away"), null), null);
  // Live: #5 trails #22 → upset watch, no line needed.
  assert.equal(upsetTag(game("in", "STATUS_IN_PROGRESS", ARIZ, UCLA, "27", "37"), undefined), "Upset watch · UCLA over #5");
  // When both rules fit, the tag shows the line.
  assert.equal(upsetTag(g1, { fav: "away", line: 5.5, details: "ARIZ -5.5" }), "Upset · UCLA +5.5");
});

test("scoreChanges: which numbers flash and which upset-watch tags pop in", () => {
  const HAMP = { id: "2261", name: "Hampton", abbr: "HAMP", confId: "10" };
  const GT = { id: "59", name: "Georgia Tech", abbr: "GT", confId: "2" };
  const live = (id, a, h) => normalizeEvent(ev({ id, state: "in", name: "STATUS_IN_PROGRESS", period: 2, clock: "9:00", away: { ...HAMP, score: a }, home: { ...GT, score: h } }));
  const gtBy = new Map([["g", { fav: "home", line: 15.5, details: "GT -15.5" }]]);
  // Hampton scores and takes the lead: their number flashes and the tag pops in.
  let c = scoreChanges([live("g", "41", "42")], [live("g", "43", "42")], gtBy);
  assert.deepEqual(c, { flashes: ["g:away"], pops: ["g"] });
  // Both teams scored since the last check: both flash; still leading, so no second pop.
  c = scoreChanges([live("g", "43", "42")], [live("g", "45", "44")], gtBy);
  assert.deepEqual(c, { flashes: ["g:away", "g:home"], pops: [] });
  // A game that wasn't on the board before (or a pre-game blank score) doesn't flash.
  assert.deepEqual(scoreChanges([], [live("g", "2", "0")], gtBy), { flashes: [], pops: [] });
  const pre = normalizeEvent(ev({ id: "g", away: HAMP, home: GT }));
  assert.deepEqual(scoreChanges([pre], [live("g", "2", "0")], gtBy).flashes, []);
});

test("refresh timing", () => {
  const now = Date.parse("2026-11-04T00:00Z");
  const pre = (date) => normalizeEvent(ev({ id: "p", date, away: SMALL1, home: VT }));
  assert.equal(nextDelay([pre("2026-11-04T00:10Z")], now), 30000); // tips within 15 min
  assert.equal(nextDelay([pre("2026-11-04T02:00Z")], now), 600000);
  assert.equal(nextDelay([normalizeEvent(ev({ id: "f", state: "post", name: "STATUS_FINAL", away: SMALL1, home: VT }))], now), null);
});
