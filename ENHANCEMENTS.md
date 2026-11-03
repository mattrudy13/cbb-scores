# Enhancements

Ideas for later, not promised. The first section is tweaks to judge after real use; the rest are new
features, roughly in the order they'd be worth doing.

## Revisit after using it (added 2026-11-02)

- **Rank-upset volume.** A ranked team losing to a lower-ranked one counts as an upset, so ranked-vs-ranked
  league games trigger it often: last season's Jan 17 slate would show 10 upsets in 36 games, including
  #15 Texas Tech over #11 BYU (close to a coin flip). If the list feels padded, require a 5+ spot rank gap
  between two ranked teams, and keep every ranked loss to an unranked team. One condition in
  `upsetInfo()` (`lib.js`) plus a test. Natural time to judge: after a busy mid-January Saturday.
- **Early "Upset watch" noise.** A ranked team or 5+ favorite trailing two minutes in already shows
  "Upset watch". If that's noisy, only show it in the second half (or under 10 minutes left), using
  `secondsLeft()`.
- **Close-game cutoff.** Live games within 10 points (`CLOSE_MARGIN`) sort above blowouts. Could be 8 or 12;
  or tighten it late in games (e.g. within 6 in the last 5 minutes counts as "close").
- **Upset threshold.** 5+ points (`UPSET_MIN`); the hub's Upsets tile uses 7+.

## Features

- **Hub link**: link Hoops Board from hub Daily's basketball tile (one line in `hub/daily.js`), and later
  maybe an 8th app tile on Rudy's Board (live game count, UVA's next game).
- **Close-game highlight**: a small "Close" marker or warmer card border on live games within 5 points in
  the last 5 minutes, so crunch time stands out without opening each game.
- **Swipe between days** on phones, in addition to the arrows.
- **UVA off-day card**: on days UVA doesn't play, a small "next game" card in the pinned slot (Rudy chose
  nothing for v0.1).
- **Tournament mode** (March): seeds and region on cards, a "Tournament" filter, and conference-tournament
  labels during Championship Week.
- **Women's toggle**: a Men / Women switch; ESPN's `womens-college-basketball` feed has the same shape
  (quarters instead of halves, so `secondsLeft()` and `periodName` would need a women's branch).
- **Home Screen icon**: a web app manifest and Apple touch icon so it opens full-screen from the phone's
  Home Screen.
- **Favorites besides UVA**: a short list of other teams to pin (stored on the device).

## Done

- v0.2 Upsets filter; v0.3 score flash and rank upsets; v0.4 time-left live sort (all 2026-11-02).
- v0.5 pre-game spread + O/U stay on live and final cards (2026-11-03).
