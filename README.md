# Knicks Pulse

A report on the New York Knicks. It started from the design in
`design/index.html`, a single long page; the report now shows its sections as
tabs. Game data comes from ESPN's public site API and is stored
in MySQL. A Node.js server computes the report and serves it as JSON; the page
renders it in the browser.

## Stack

- Node.js 26.13.1 (`.nvmrc`) runs the server in `server/` straight from its
  TypeScript files; there is no build step for it. `server/main.ts` has four
  commands, each an npm script: `serve`, `migrate`, `sync` and `export`.
  Fastify serves `/api/report`, `/api/games/{id}`, `/api/players/{id}`,
  `/api/shots`, `/api/sync` and the built page, mysql2 talks to MySQL, and
  Node's `fetch` gets the games from ESPN.
- `server/schema.ts` is the API's contract: a JSON Schema, written with
  TypeBox, for every route's parameters, query, body and responses. The
  server validates requests and writes responses with them, and the page
  imports its types from the same file.
- The page is plain TypeScript built with Vite (`web/`). It fetches
  `/api/report` and writes the HTML one tab at a time, in two layers: Team
  (`#team/season`, `games`, `quarters`, `factors`, `situations`) and Players
  (`#players/impact`, `pairs`, `shots`; `#players/shots/{id}` opens the
  shot map on one player). `#game/{id}` shows one game from
  `/api/games/{id}` and `#player/{id}` one player from `/api/players/{id}`. The routes are in `web/src/route.ts`.
- TypeScript 7 checks both the page and the server (`npm run typecheck`);
  `npm test` runs the server's tests with `node:test`.
- oxlint checks the code (`npm run lint`) and oxfmt formats it
  (`npm run format`; `npm run format:check` only reports).
- MySQL 9 in a Podman container.

## Quickstart (macOS)

MySQL runs in a Podman container for this project only (`compose.yaml`,
host port 3307, data in the `knicks_mysql-data` volume). Node is
installed on the Mac itself.

### 1. Install the tools (once per machine)

| Tool           | Install                                                                                                | Used for                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| nvm            | the install script in the [nvm README](https://github.com/nvm-sh/nvm#installing-and-updating)          | the Node version in `.nvmrc`; then `npm install -g npm@12` (Node 26 ships npm 11) |
| Podman         | the macOS installer from [podman.io](https://podman.io) (the Homebrew formula is community-maintained) | the MySQL container                                                               |
| podman-compose | `uv tool install podman-compose` (uv: `brew install uv`)                                               | `podman compose` hands off to it                                                  |

A standalone `docker-compose` on the PATH takes precedence over
`podman-compose`.

### 2. Start MySQL

```sh
podman machine init                   # once per machine
podman machine start                  # again after every restart of the Mac
podman compose up -d                  # `podman compose down` stops it and keeps the data
```

`podman compose down -v` also deletes the data volume.

### 3. Build and run

Run everything from the repo root: the server reads `.env` and serves
`web/dist` relative to the current directory.

```sh
nvm install                           # the version in .nvmrc
npm install
cp .env.example .env                  # already points at the container
npm run migrate                       # creates the tables
npm run sync                          # loads two seasons of games from ESPN (first run: about 120 requests)
npm run build                         # builds the page into web/dist
npm run serve                         # http://localhost:3000
```

### Updating

After pulling a new version:

```sh
npm install
npm run migrate                       # adds new tables and columns; keeps the data
npm run build
npm run serve                         # the sync at startup fetches games stored in an older format again
```

### When something fails

- `migrate`, `sync` or `serve` says "Connection refused": MySQL isn't up.
  Run `podman machine start` and `podman compose up -d`; the container needs
  a moment after starting before it accepts connections.
- The page answers "Not found": `web/dist` is missing, run `npm run build`.
- Port 3000 is taken: set `PORT` in `.env`.
- A value in `.env` is cut short: an unquoted value ends at `#`, so put
  quotes around one that contains it.

### Other commands

`npm run export -- knicks.html` writes the whole site (the report, every
game, every player and the shot maps) as one HTML file that opens from disk
without a server. It inlines the page built by `npm run build` and the data
as stored at that moment, so build and sync first. The file shows when its
data was last checked and has no "Check for new games" button.

While working on the page, run `npm run serve` for the API on port 3000
and `npm run dev` for the page on Vite's port (5173); Vite forwards `/api` to
port 3000. To change what the API sends, change its schema in
`server/schema.ts` first: the type-check then points at the server code and
the page code that no longer fit. Restart `npm run serve` after changing
server code.

The server listens on `127.0.0.1` only (`HOST` in `.env`). To share it with
someone outside your network, see [Sharing through a Cloudflare tunnel](#sharing-through-a-cloudflare-tunnel). To open it from
other devices on your tailnet, run `tailscale serve --bg 3000` on this machine
and use the `https://<machine>.<tailnet>.ts.net` address it prints;
`tailscale serve reset` stops it.

The server syncs once at startup and then every `SYNC_INTERVAL_MINUTES`
(default 60, `0` means only at startup). The header's "Check for new games"
button asks for one too (`POST /api/sync`; `GET /api/sync` tells when the
last one finished). That request must carry `SYNC_SECRET` from `.env` as
`Authorization: Bearer <secret>`; the page asks for the secret on the first
click and keeps it in the browser's local storage. With `SYNC_SECRET` empty
the route refuses every request. The
header then says what the check did: how many new games it stored, or how
many recent ones it fetched again. Syncs
never overlap: a request made while one runs starts none. A sync fetches the games that
aren't stored yet, and the stored ones written in an older format: each game
records the `STORE_FORMAT` (`server/sync.ts`) it was stored with, so after an
update that stores more per game, run `npm run migrate` and the next sync
fetches every game once more.
ESPN corrects a game for a while after it ends, so a game is also fetched
again on every sync until 36 hours after its start. A game whose ESPN summary
answers 404 is read from ESPN's core API instead (about 65 small requests);
when that has nothing either, the game is skipped and asked for again on
every sync. The time a sync last ran to the end is kept in `sync_status`. The
report and game JSON are computed once and kept until a sync stores a game.

## Sharing through a Cloudflare tunnel

A quick tunnel gives the locally running site a public
`https://<random words>.trycloudflare.com` address for free, without a
Cloudflare account or a domain. `cloudflared` is a separate program:

```sh
brew install cloudflared              # once per machine
```

Then, with `SYNC_SECRET` set in `.env`:

```sh
npm run build
npm run serve                         # in one terminal
npm run tunnel                        # in another; prints the address
```

`npm run tunnel` runs `cloudflared tunnel --url` with `HOST` and `PORT`
from `.env`, and refuses to start when `HOST` isn't a loopback address.
Ctrl-C closes the tunnel, and the address stops working. What to know:

- Anyone who has the address can read the site; there is no login. To ask
  visitors for a one-time code sent to an email address you name, run
  `npm run tunnel -- --allowed-mail mate@example.com`.
- The address changes every time the tunnel starts. Cloudflare gives quick
  tunnels no uptime guarantee and at most 200 requests in flight; they are
  meant for testing.
- Cloudflare ends the HTTPS connection, so it sees what passes through,
  the sync secret included.

What the server does for visitors from outside:

- Starting a sync needs `SYNC_SECRET`; an address gets 5 tries a minute,
  right or wrong, and 300 requests a minute overall, then `429`.
- The visitor's address is taken from `X-Forwarded-For` only when the
  connection comes from this machine, as the tunnel's does.
- A request body over 1 KiB is refused, and every response carries a
  content security policy and the usual hardening headers.
- Everything else the tunnel reaches is read-only: the page, the report,
  games, players and shots JSON, and `GET /api/sync` (when the last sync
  finished). MySQL and the Vite dev server aren't behind the tunnel.

A named tunnel would add an address that stays the same, on your own
domain, and Cloudflare Access in front of it (a login for chosen people).
It needs a Cloudflare account and a domain whose DNS is on Cloudflare.

## Data source

ESPN's site API needs no key, but it is undocumented and could change without
notice. The design's footer names it as its source, and its numbers match.

| Endpoint                                                                                                                                                                                                             | Used for                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/ny/schedule?season=YYYY&seasontype=2\|3`                                                                                                                 | Completed game ids per season (2 regular season, 3 playoffs), with the playoff series note. Without `season` it returns the current one. |
| `site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=ID`                                                                                                                                              | Score by quarter, team and player box scores, play-by-play with substitutions and shot positions, attendance, neutral site.              |
| `sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/ID/competitions/ID` and the documents it links (`plays`, and per team `roster`, `statistics`, `linescores`, `score`, each player's `statistics/0`) | The same game data, for games whose summary answers 404.                                                                                 |

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
- The margin chart's running average covers the last 5 or 10 games of the
  season (fewer early on) and starts at the third game. It opens on the
  10-game average once the current season has 12 games, on the 5-game one
  before that.
- The headline is whichever moved most since last regular season: offense or
  defense per 100 possessions, or a quarter's average margin (from the second
  game on). When nothing moved by a full point it compares net ratings.
- A season counts as a title when the team won at least four of its
  "NBA Finals" games; the hero then shows that series, otherwise the last
  playoff series.
- Rest days count calendar days in New York between games.
- Home and Road leave out games at a neutral site.
- On/off and pairings replay the play-by-play to know who was on the floor.
  ESPN doesn't list who starts the 2nd quarter onward, so the replay infers it
  (`server/report/lineups.ts`). A game is used for on-court numbers only when
  every player's replayed plus-minus is within 8 points of the box score.
- A game's stints come from the same replay, and are left out when that game
  fails the check above. Each one's net points can differ from the box score
  by up to that same 8.
- On a game's page, each player's points by period add up the points of the
  plays ESPN credits to them; a player whose plays don't add up to their
  box-score points shows no split. Largest lead comes from the same
  play-by-play.
- Usage is a player's share of the team's possessions while on the floor:
  `100 · (FGA + 0.44·FTA + TOV) · (team minutes / 5) / (minutes · team (FGA +
  0.44·FTA + TOV))` per game, averaged over the season by minutes played.
- A player's quarter splits use the same replay: net points per game and the
  opponent's points per 48 minutes while the player was on the floor in that
  quarter.
- The shot map draws the Knicks' field-goal attempts that ESPN places inside
  half court (x from −2 to 52 feet, y from −8 to 45 feet out from the basket).
  A heave from the backcourt is left off the map and out of its counts, so a
  player's attempts there can be a few short of the box score.
- Game score is `PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA − FTM) + 0.7·OREB +
  0.3·DREB + STL + 0.7·AST + 0.7·BLK − 0.4·PF − TOV`.
- The impact label's thresholds are `IMPACT` in
  `server/report/compute.ts`; the label text and tooltip are in
  `web/src/render/impact.ts`.

## Layout

```
db/schema.sql          tables (datetimes in UTC)
server/main.ts         the commands: serve, migrate, sync, export
server/schema.ts       the API's contract: JSON Schemas and the types derived from them
server/app.ts          HTTP routes, built page, JSON cache, sync timer
server/api.ts          builds the JSON the page reads
server/export.ts       the site as one HTML file
server/espn.ts         ESPN client and parsing
server/espnCore.ts     a game from ESPN's core API, when the summary is missing
server/sync.ts         stores completed games
server/db.ts           connection pool, migrate
server/report/         load from MySQL, lineup replay, metrics
web/src/               the page: routes, HTML, SVG charts, CSS, number formatting
design/index.html      the original design
```
