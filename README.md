# Knicks game to game

A day-by-day report on the New York Knicks. It compares last season with this one, then splits offense and defense by quarter, situation, and player.

The page is a black, Arial report in the spirit of a Pew Research chart: a finding up top, the number under it, and a source line. It is not a broadcast graphic.

## What it measures

- **Team:** record, margin, offensive rating, defensive rating, pace, and the four factors on both ends of the floor.
- **Quarters:** points scored and allowed in each period, how often the Knicks win the quarter, and a game-by-game margin grid.
- **Situations:** home, road, back-to-backs, rest, and the game after a win or a loss.
- **Players:** scoring, creation, rebounding, rim protection, and disruption, plus the Knicks' margin and the opponent's scoring rate with that player on the floor and on the bench. Quarter points come from the play-by-play.
- **Pairings:** a heatmap of the Knicks' margin per 48 minutes while two players share the floor.
- **Shots:** every Knicks field-goal attempt on a half court. A filled dot is a make. An open dot is a miss. Free throws are excluded.

Ratings use a box-score possession estimate: field-goal attempts minus offensive rebounds plus turnovers plus 0.44 times free-throw attempts. On-court splits replay substitutions. A game stays in the split when that replay is within 8 points of the official plus-minus. Preseason is not included.

## Daily update

The report stores completed games in `data/knicks.json`. Opening the site checks ESPN for a newly final game. The **Ingest latest game** button does the same thing.

From the project directory:

```bash
npm run ingest
```

That command is safe to rerun. It skips games already stored, refreshes anything played in the last 36 hours, and fills a game from ESPN's core feed if the usual summary is missing.

## Run it locally

```bash
npm install
npm run ingest
npm run dev
```

The dev server listens on port 43127, on both IPv4 and IPv6, so `http://127.0.0.1:43127` and `http://localhost:43127` reach the same process.

## Static HTML

```bash
npm run export:html
```

That writes `export/index.html`, a single file you can open in a browser with no server. The same file is copied to `public/knicks.html` and served at `/knicks.html` while the dev server is running.
