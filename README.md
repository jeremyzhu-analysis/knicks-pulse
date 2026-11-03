# Knicks game to game

A server-rendered report on the New York Knicks, built from the design in
`design/index.html`. Game data comes from ESPN's public site API and is stored
in MySQL; the page is rendered from the database.

## Stack

- Node.js 26 (LTS). Node runs the TypeScript sources directly (type
  stripping), so there is no build step. `.nvmrc` pins the major version.
- TypeScript 7.0.2 for type-checking only (`npm run typecheck`).
  `erasableSyntaxOnly` keeps the code runnable by Node: no enums, namespaces
  or parameter properties.
- MySQL through `mysql2`. The web server is `node:http`.

## Setup

MySQL runs in a Podman container for this project only (`compose.yaml`,
host port 3307, data in the `knicks_mysql-data` volume).

Install Podman with the macOS installer from podman.io (the Homebrew
formula is community-maintained). `podman compose` hands off to a separate
compose provider; this setup uses `podman-compose`. A standalone
`docker-compose` on the PATH takes precedence over it.

```sh
uv tool install podman-compose        # once per machine
podman machine init && podman machine start
podman compose up -d                  # start MySQL; `podman compose down` stops it
nvm use                               # Node 26
npm install
cp .env.example .env                  # already points at the container
npm run migrate                       # creates the tables
npm run sync                          # loads games from ESPN (first run: ~110 requests)
npm start                             # http://localhost:3000
```

`podman compose down -v` also deletes the data volume.

The server listens on `127.0.0.1` only (`HOST` in `.env`). To open it from
other devices on your tailnet, run `tailscale serve --bg 3000` on this machine
and use the `https://<machine>.<tailnet>.ts.net` address it prints;
`tailscale serve reset` stops it.

While running, the server syncs again every `SYNC_INTERVAL_MINUTES`
(default 60, `0` turns it off). Stored games are final and never fetched
again, so a sync only fetches games that finished since the last one. A game
whose ESPN summary answers 404 is skipped and asked for again on every sync.

## Data source

ESPN's site API needs no key, but it is undocumented and could change without
notice. The design's footer names it as its source, and its numbers match.

| Endpoint | Used for |
| --- | --- |
| `site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/ny/schedule?season=YYYY&seasontype=2\|3` | Completed game ids per season (2 regular season, 3 playoffs). Without `season` it returns the current one. |
| `site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=ID` | Score by quarter, team and player box scores, play-by-play with substitutions. |

The sync stores the current and previous season, regular season and playoffs.

Other free sources checked:

- `stats.nba.com` has the richest data (official lineups and on/off) but
  blocks requests that don't look like a browser and often times out from
  servers.
- `cdn.nba.com` live JSON (scoreboard, box score, play-by-play) is public but
  answered 403 from this network.
- balldontlie.io needs an API key (401 without one). It has a free tier and
  lists play-by-play; which plan includes play-by-play wasn't checked.

## How the numbers are made

- Possessions: average of both teams' `FGA + 0.44·FTA − OREB + TOV`.
  Offense and defense are points per 100 possessions; pace is possessions per
  48 minutes.
- Four factors: eFG% `(FGM + 0.5·3PM) / FGA`, turnover rate
  `TOV / (FGA + 0.44·FTA + TOV)`, offensive rebound rate
  `OREB / (OREB + opponent DREB)`, free-throw rate `FTA / FGA`.
- Rest days count calendar days in New York between games.
- On/off and pairings replay the play-by-play to know who was on the floor.
  ESPN doesn't list who starts the 2nd quarter onward, so the replay infers it
  (`src/report/lineups.ts`). A game is used for on-court numbers only when
  every player's replayed plus-minus is within 8 points of the box score.
- The impact label's thresholds are in `IMPACT` in `src/report/compute.ts`.

## Layout

```
db/schema.sql          tables (datetimes in UTC)
src/espn.ts            ESPN client and parsing
src/sync.ts            stores new completed games
src/report/            load from MySQL, lineup replay, metrics, formatting
src/render/            HTML and SVG charts
public/                CSS and the season switch script from the design
design/index.html      the original design
```
