# Enhancements

Ideas for later, not promised. The first section is tweaks to judge after real use; the rest are new
features, roughly in the order they'd be worth doing.

## Revisit after using it (added 2026-11-02)

- **Rank-upset volume.** A ranked team losing to a lower-ranked one counts as an upset, so ranked-vs-ranked
  league games trigger it often: last season's Jan 17 slate would show 10 upsets in 36 games, including
  #15 Texas Tech over #11 BYU (close to a coin flip). If the list feels padded, require a 5+ spot rank gap
  between two ranked teams, and keep every ranked loss to an unranked team. One condition in
  `upsetInfo()` (`lib.js`) plus a test. Natural time to judge: after a busy mid-January Saturday.
- **Close-game cutoff.** Live games within 10 points (`CLOSE_MARGIN`) sort above blowouts. Could be 8 or 12;
  or tighten it late in games (e.g. within 6 in the last 5 minutes counts as "close").
- **Upset threshold.** 5+ points (`UPSET_MIN`); the hub's Upsets tile uses 7+.

## Features

- **Home Screen icon**: a web app manifest and Apple touch icon so it opens full-screen from the phone's
  Home Screen. Recommended first (2026-11-11 review): cheapest feature for daily phone use, and it pairs
  with v0.8's day-rollover fix, since a Home Screen app is the one most often reopened the next day.
- **Close-game highlight**: a small "Close" marker or warmer card border on live games within 5 points in
  the last 5 minutes, so crunch time stands out without opening each game.
- **Swipe between days** on phones, in addition to the arrows.
- **UVA off-day card**: on days UVA doesn't play, a small "next game" card in the pinned slot (Rudy chose
  nothing for v0.1).
- **Tournament mode** (March): seeds and region on cards, a "Tournament" filter, and conference-tournament
  labels during Championship Week.
- **Women's toggle**: a Men / Women switch; ESPN's `womens-college-basketball` feed has the same shape
  (quarters instead of halves, so `secondsLeft()` and `periodName` would need a women's branch).
- **Favorites besides UVA**: a short list of other teams to pin (stored on the device).

## Done

- v0.2 Upsets filter; v0.3 score flash and rank upsets; v0.4 time-left live sort (all 2026-11-02).
- v0.5 pre-game line stays on live and final cards; v0.6 trims it to the spread after tip (2026-11-03).
- v0.7 navy dark mode ("Deep header") replaces the dark-brown one (2026-11-10).
- v0.8 fixes from the 2026-11-11 code review: 10 s fetch timeouts (a hung request used to stop the refresh);
  a tab left on "today" overnight moves to the new today on return, once nothing shown is live; only the
  newest load's answer is used; `package.json` version, one unescaped ESPN string, and the tests now cover
  ESPN's numeric clock and `secondsLeft()`.
- Hub link: hub Daily's basketball tile links here and Rudy's Board has a Hoops Board tile (2026-11-07,
  in the hub repo).
