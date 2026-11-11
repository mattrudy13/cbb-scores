# cbb-scores ("Hoops Board")

Semi-live men's college basketball scores at https://mattrudy13.github.io/cbb-scores/. A static GitHub Pages
site with no build step and no server: the browser reads ESPN's free scoreboard feed directly (it sends
`Access-Control-Allow-Origin: *`). Personal use. ESPN's feed is unofficial and can change; Rudy is fine
patching it when it breaks.

## Files

- `index.html`: page shell (header, filter bar, UVA slot, game list, footer).
- `lib.js`: pure helpers (normalize ESPN events, merge boards, filter, sort, labels, dates, refresh timing,
  betting-line parsing and upset rules, score-change diffing). No DOM, so `npm test` (`node --test`) covers it.
- `app.js`: fetching, URL state, rendering, polling, betting-line lookups (+ localStorage cache), the
  score flash, theme toggle.
- `style.css`: the Hardwood look. Light/dark tokens on `:root`.
- `test/lib.test.mjs`: unit tests on trimmed ESPN-shaped fixtures.
- `.phones.html` (not deployed, gitignored): 320/360/375/390 px iframes of the page for width checks.
  Headless Chrome can't fetch ESPN from this machine's sandbox, so check it in real Chrome.

## Versions

Tagged in git. v0.1–v0.4 all shipped on 2026-11-02 (opening night):
- **v0.1**: scoreboard (P4 + Big East + Top 25, UVA pinned, filters, day arrows, 30 s refresh), Hardwood look.
- **v0.2**: Upsets filter (5+ point underdogs that won, live "upset watch").
- **v0.3**: score flash on change; ranked team losing to unranked/lower-ranked counts as an upset.
- **v0.4**: live games sort close-first by time left.
- **v0.5** (2026-11-03): live and final cards keep the pre-game spread + O/U.
- **v0.6** (2026-11-03): after tip, just the spread; the O/U shows before tip only.
- **v0.7** (2026-11-10): navy dark mode ("Deep header") replaces the dark-brown one.
- **v0.8** (2026-11-11): fixes from a code review: 10 s fetch timeouts, only the newest load's answer is used,
  and a tab left on "today" overnight moves to the new today.

Open questions to revisit after Rudy has used it (also in ENHANCEMENTS.md and NEXT-STEPS.md): whether the
rank upset rule fires too often on league Saturdays, and whether "Upset watch" is noisy early in games.

## Rules (Rudy's decisions, 2026-11-02)

- **Shown games:** either team is in the ACC (ESPN `conferenceId` 2), Big Ten (7), Big 12 (8), SEC (23) or
  Big East (4), or is AP-ranked (`curatedRank.current` 1–25; 99 = unranked). Men's only.
- **UVA** (team id 258) is pinned on top in the arched card on days it plays, under any filter. Off days:
  nothing extra.
- **Days:** opens on today in Eastern time; ◀ ▶ step a day. `?d=YYYY-MM-DD&f=<filter>` in the URL
  (today and "all" are left out of the URL).
- **Day rollover** (v0.8, Rudy's rule 2026-11-11): a page that was on "today" when it was hidden moves to the
  new today when Rudy comes back to the tab, once the Eastern date has changed and no game on the shown day
  is live (a late West Coast game stays up past midnight). If the last scores it had showed a live game, it
  reloads that day first and moves only if nothing is live any more. Only on returning to the tab: a board
  being watched never jumps when its last game ends. A day picked with the arrows or `?d=` never moves.
  `canRollOver()` in `lib.js`; `onToday`, `rollPending` and `rollIfDue()` in `app.js`.
- **Upsets** (added 2026-11-02, v0.2): a filter after Top 25. An upset is either (1) an underdog of 5+ points
  (`UPSET_MIN`, Rudy's pick over the hub's 7) that won, or (2, v0.3) a ranked team losing to an unranked or
  lower-ranked team, whatever the spread said (even if that team was favored). A live game where either would
  happen if it ended now is an "Upset watch". Cards get a tag under every filter: the line when the spread
  rule fits ("Upset · GRAM +8.5"), else the rank that fell ("Upset · UCLA over #5"); solid for a final,
  outlined for a watch. `upsetInfo()` in `lib.js`. In the Upsets view the sections read "Upset watch" and "Upsets".
- **Filters:** one at a time: All, Top 25, Upsets, ACC, Big Ten, Big 12, SEC, Big East. A game matches if either
  team does. Counts on each button; a filter with no games that day is dimmed and disabled.
- **Order after UVA:** Live, then Up next (tip time), then Final (tip time). Live (v0.4, Rudy's pick): games
  within 10 points (`CLOSE_MARGIN`) first, by least time left; then blowouts, by least time left; ties by
  margin. `secondsLeft()`: 1st half = 20:00 + clock, halftime = 20:00, 2nd half and OT = clock (ESPN's
  numeric `status.clock`, in seconds).
- **Card:** logo, AP rank, team, record, score, status, TV; DraftKings spread + O/U before tip (the scoreboard's line); once a game tips (live
  and final), just the pre-game spread from the odds feed, no O/U (v0.5–v0.6, Rudy's pick; never live odds).
  Tapping opens ESPN's game page in a new tab (no box scores built in).
- **Records:** overall only until the team has played a conference game, then "13-2 · 4-0 ACC".
  0-0 shows as 0-0 (so the cards keep their shape). Conference short names live in `CONF_SHORT`
  (ESPN's groups endpoint has no ids); a missing id reads "conf".
- **Score animation** (v0.3, Rudy's pick from 3 in the demo board): a changed score glows orange and fades
  (~1.2 s); a game that just became an upset watch has its tag pop in. `scoreChanges()` in `lib.js` diffs two
  loads of the same day. Nothing animates on a day's first load or when coming back after 1+ minute in the
  background (`quietNext`), since then every live game would glow at once. Start times are kept so a
  re-render mid-glow continues it (negative `animation-delay`) instead of restarting. Off under
  `prefers-reduced-motion`. Both numbers glow when both changed: a play-by-play replay of 13 games put that
  at ~9% of changes, but ESPN's feed seemed to bunch updates more than that on opening night.
- **Refresh:** every 30 s while a game on the shown day is live or tips within 15 min, every 10 min while
  games are still to come, never for a finished day, and never in a hidden tab (it catches up on return).
  If every request fails, the last good scores stay up with a note. Every fetch (boards and lines) gives up
  after 10 s (`TIMEOUT_MS`, v0.8): the next refresh is only scheduled once a load settles, so one hung request
  used to stop the refresh. Loads are numbered (`loadSeq`) and only the newest one's answer is used, so a
  slower, older response can't put earlier scores back (and re-flash them).

## Data notes

- Fetch: `site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=YYYYMMDD&limit=400`
  six times: the default board (games with a ranked team) plus `&groups=` 2, 7, 8, 23, 4. Merge by event id.
  The full D-I board (`groups=50`) is ~1.7 MB on a busy Saturday; this is much smaller.
- When two boards disagree about a game (one fetched a moment staler), the furthest-along copy wins
  (`progress()` in `lib.js`).
- ESPN sends score "0" before tip-off; `normalizeEvent` blanks pre-game scores.
- The scoreboard's `odds` disappears once a game tips (live and final), and is often missing early in the
  season. For upsets and the card's line after tip, each tipped game's line comes from ESPN's core odds feed
  (`sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/<id>/competitions/<id>/odds`,
  ~7 KB, CORS `*`). Its items include "DraftKings" (the pre-game line, kept) and "DraftKings - Live Odds"
  (ignored). `spread` is from the home side; `homeTeamOdds.favorite` says who's favored. The game summary's
  `pickcenter` has the same line but is ~435 KB. `parseLine()` keeps the spread, favorite and spread text ("FLA −6.5"); a pick'em
  has `line: 0`, `fav: null`. Lines are fetched four at a time, once per game, and kept
  in localStorage (`cbb-scores:lines3`, last 1,500 games; a null = "checked, no line"). v0.6 drops the older
  `cbb-scores:lines` and `lines2` keys, whose entries had a different shape. Failed requests
  aren't saved, so the next refresh retries. Opening night (58 games) was 58 requests.
- `timeValid: false` = tip time not set yet ("TBA").
- Status names used: `STATUS_HALFTIME`, `STATUS_END_PERIOD`, and postponed/canceled/suspended/delayed/forfeit
  (shown with ESPN's `shortDetail`). Periods: 1st, 2nd, OT, 2OT…
- Logos: `team.logo` on a cream "puck" so dark logos read in dark mode; a team-color disc with the
  abbreviation sits underneath and shows if the logo fails.

## Look

Hardwood, adapted from kotc-tracker's unused Hardwood mockup. Rudy picked it from five directions
(mockups: https://claude.ai/artifact/BHNe8oW31sEcX8ToFPMRLa): navy header (#1d3557) with a center-court circle behind the date only, floorboard stripe, maple ground (#f1e4cc), court-line
borders (#c9a46f), Graduate numerals + DM Sans, orange #a8450c (#ff9a52 on dark). Filters are the
"scorer's table" row: solid cream chips under the stripe, sticky while scrolling, never over court lines
(Rudy found outlined chips on court lines clashed). Phones get a short weekday ("Tue, Nov 3"), the UVA score on its own row, and the update time in the footer. The same canvas has the filter-placement board and
the score-animation demo (3 live phone frames: flash, flip, pulse; Rudy picked the flash).

**Dark mode** (v0.7, Rudy's pick 2026-11-10 from three navy options; mockups:
https://claude.ai/artifact/L5s9QLtN2aAF9xR7BgQPnL) is "Deep header": the old dark-brown version read muddy and
lost the navy. Now a navy floor (#16263f), navy cards (#1f3352), maple court lines (#a7834f), cream text and
pucks, and a deeper navy header (#0a1322) so the header stays the darkest band, as in light mode. The
`theme-color` metas and `applyTheme()` keep the browser bar matching the header.

## Used by Rudy's Board (hub)

Since 2026-11-07 the Board's Hoops Board tile (`hub/tiles.js`) imports this site's `lib.js` from the live URL
(`ESPN`, `BOARD_QUERIES`, `UVA_ID`, `mergeBoards`, `isShown`, `hasUva`, `statusText`, `oddsUrl`, `parseLine`,
`upsetState`, `etDate`) and reads/writes the same `cbb-scores:lines3` cache (same origin). Renaming one of those
exports or bumping the cache key means updating the hub too; otherwise its tile falls back to a plain link.

## Checks

- `npm test`
- `npm run serve`, then http://localhost:8765/ and http://localhost:8765/.phones.html?d=2026-03-14 (finals
  with conference records) in Chrome. No sideways scroll at 320–390 px.
