# Hoops Board

Live men's college basketball scores for every Power 4 and Big East game, plus any Top 25 team, with
Virginia pinned on top.

**Site:** https://mattrudy13.github.io/cbb-scores/

- Filter by Top 25, Upsets (5+ point underdogs that won or are leading), ACC, Big Ten, Big 12, SEC or Big East
- Step through days with the arrows (links like `?d=2026-03-14&f=acc` work too)
- Updates every 30 seconds while games are live
- Light and dark mode

Scores come straight from ESPN's public scoreboard feed in the browser. There's no server and no build
step: it's plain HTML, CSS and JavaScript on GitHub Pages.

## Run it locally

```sh
npm run serve   # http://localhost:8765
npm test        # unit tests (Node 20+)
```
