# cbb-scores ("Hoops Board")

Semi-live men's college basketball scores at https://mattrudy13.github.io/cbb-scores/. A static GitHub Pages
site with no build step and no server: the browser reads ESPN's free scoreboard feed directly (it sends
`Access-Control-Allow-Origin: *`). Personal use. ESPN's feed is unofficial and can change; Rudy is fine
patching it when it breaks.

## Files

- `index.html`: page shell (header, filter bar, UVA slot, game list, footer).
- `lib.js`: pure helpers (normalize ESPN events, merge boards, filter, sort, labels, dates, refresh timing).
  No DOM, so `npm test` (`node --test`) covers it.
- `app.js`: fetching, URL state, rendering, polling, theme toggle.
- `style.css`: the Hardwood look. Light/dark tokens on `:root`.
- `test/lib.test.mjs`: unit tests on trimmed ESPN-shaped fixtures.
- `.phones.html` (not deployed, gitignored): 320/360/375/390 px iframes of the page for width checks.
  Headless Chrome can't fetch ESPN from this machine's sandbox, so check it in real Chrome.

## Rules (Rudy's decisions, 2026-11-02)

- **Shown games:** either team is in the ACC (ESPN `conferenceId` 2), Big Ten (7), Big 12 (8), SEC (23) or
  Big East (4), or is AP-ranked (`curatedRank.current` 1–25; 99 = unranked). Men's only.
- **UVA** (team id 258) is pinned on top in the arched card on days it plays, under any filter. Off days:
  nothing extra.
- **Days:** opens on today in Eastern time; ◀ ▶ step a day. `?d=YYYY-MM-DD&f=<filter>` in the URL
  (today and "all" are left out of the URL).
- **Filters:** one at a time: All, Top 25, ACC, Big Ten, Big 12, SEC, Big East. A game matches if either
  team does. Counts on each button; a filter with no games that day is dimmed and disabled.
- **Order after UVA:** Live (closest margin first), Up next (tip time), Final (tip time).
- **Card:** logo, AP rank, team, record, score, status, TV; DraftKings spread + O/U before tip only.
  Tapping opens ESPN's game page in a new tab (no box scores built in).
- **Records:** overall only until the team has played a conference game, then "13-2 · 4-0 ACC".
  0-0 shows as 0-0 (so the cards keep their shape). Conference short names live in `CONF_SHORT`
  (ESPN's groups endpoint has no ids); a missing id reads "conf".
- **Refresh:** every 30 s while a game on the shown day is live or tips within 15 min, every 10 min while
  games are still to come, never for a finished day, and never in a hidden tab (it catches up on return).
  If every request fails, the last good scores stay up with a note.

## Data notes

- Fetch: `site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=YYYYMMDD&limit=400`
  six times: the default board (games with a ranked team) plus `&groups=` 2, 7, 8, 23, 4. Merge by event id.
  The full D-I board (`groups=50`) is ~1.7 MB on a busy Saturday; this is much smaller.
- When two boards disagree about a game (one fetched a moment staler), the furthest-along copy wins
  (`progress()` in `lib.js`).
- ESPN sends score "0" before tip-off; `normalizeEvent` blanks pre-game scores.
- `odds` disappears once a game goes final and is often missing early in the season.
- `timeValid: false` = tip time not set yet ("TBA").
- Status names used: `STATUS_HALFTIME`, `STATUS_END_PERIOD`, and postponed/canceled/suspended/delayed/forfeit
  (shown with ESPN's `shortDetail`). Periods: 1st, 2nd, OT, 2OT…
- Logos: `team.logo` on a cream "puck" so dark logos read in dark mode; a team-color disc with the
  abbreviation sits underneath and shows if the logo fails.

## Look

Hardwood, adapted from kotc-tracker's unused Hardwood mockup. Rudy picked it from five directions
(mockups: https://claude.ai/artifact/BHNe8oW31sEcX8ToFPMRLa): navy header (#1d3557; near-black in dark
mode) with a center-court circle behind the date only, floorboard stripe, maple ground (#f1e4cc), court-line
borders (#c9a46f), Graduate numerals + DM Sans, orange #a8450c (#ff9a52 on dark). Filters are the
"scorer's table" row: solid cream chips under the stripe, sticky while scrolling, never over court lines
(Rudy found outlined chips on court lines clashed). Phones get a short weekday ("Tue, Nov 3"), the UVA
score on its own row, and the update time in the footer.

## Checks

- `npm test`
- `npm run serve`, then http://localhost:8765/ and http://localhost:8765/.phones.html?d=2026-03-14 (finals
  with conference records) in Chrome. No sideways scroll at 320–390 px.
