# Knicks game to game

A report on the New York Knicks, built from the design in
`design/index.html`. Game data comes from ESPN's public site API and is stored
in MySQL. A Rust server computes the report and serves it as JSON; the page
renders it in the browser.

## Stack

- Rust, version pinned in `rust-toolchain.toml`. One binary, `knicks`, with
  three commands: `serve`, `migrate` and `sync`. Axum serves `/api/report`,
  `/api/games/{id}`, `/api/sync` and the built page, sqlx talks to MySQL, and
  reqwest fetches ESPN.
  The ESPN client trusts Mozilla's root certificates compiled into the
  binary (`webpki-root-certs`), not the macOS keychain.
- The page is plain TypeScript built with Vite (`web/`). It fetches
  `/api/report` and writes the HTML; `#game/{id}` shows one game from
  `/api/games/{id}`. The API's TypeScript types in
  `web/src/api/` are generated from the Rust structs by ts-rs whenever
  `cargo test` runs; don't edit them by hand.
- Node.js 26.13.1 (`.nvmrc`) runs Vite and TypeScript 7 (`npm run typecheck`).
- MySQL 9 in a Podman container.

## Setup

MySQL runs in a Podman container for this project only (`compose.yaml`,
host port 3307, data in the `knicks_mysql-data` volume).

Install Podman with the macOS installer from podman.io (the Homebrew
formula is community-maintained). `podman compose` hands off to a separate
compose provider; this setup uses `podman-compose`. A standalone
`docker-compose` on the PATH takes precedence over it.

Run everything from the repo root: the binary reads `.env` and serves
`web/dist` relative to the current directory.

```sh
uv tool install podman-compose        # once per machine
podman machine init && podman machine start
podman compose up -d                  # start MySQL; `podman compose down` stops it
rustup toolchain install              # the version in rust-toolchain.toml
nvm use                               # Node 26.13.1, for Vite
npm install
cp .env.example .env                  # already points at the container
cargo run -- migrate                  # creates the tables; adds new columns to existing ones
cargo run -- sync                     # loads games from ESPN (first run: ~110 requests)
npm run build                         # builds the page into web/dist
cargo run --release -- serve          # http://localhost:3000
```

`podman compose down -v` also deletes the data volume.

While working on the page, run `cargo run -- serve` for the API on port 3000
and `npm run dev` for the page on Vite's port (5173); Vite forwards `/api` to
port 3000. After changing a type the API sends (`src/api.rs`,
`src/report/compute.rs`), run `cargo test` to regenerate `web/src/api/`.

The server listens on `127.0.0.1` only (`HOST` in `.env`). To open it from
other devices on your tailnet, run `tailscale serve --bg 3000` on this machine
and use the `https://<machine>.<tailnet>.ts.net` address it prints;
`tailscale serve reset` stops it.

The server syncs once at startup and then every `SYNC_INTERVAL_MINUTES`
(default 60, `0` means only at startup). The page also asks for a sync each
time it loads and from the header's "Check for new games" button
(`POST /api/sync`; `GET /api/sync` tells when the last one finished). Syncs
never overlap: a request made while one runs starts none. A sync fetches the games that
aren't stored yet, and the stored ones written in an older format: each game
records the `STORE_FORMAT` (`src/sync.rs`) it was stored with, so after an
update that stores more per game, run `cargo run -- migrate` and the next sync
fetches every game once more.
ESPN corrects a game for a while after it ends, so a game is also fetched
again on every sync until 36 hours after its start. A game whose ESPN summary
answers 404 is read from ESPN's core API instead (about 65 small requests);
when that has nothing either, the game is skipped and asked for again on
every sync. The time a sync last ran to the end is kept in `sync_status`. The
report and game JSON are computed once and kept until a sync stores a game.

## Data source

ESPN's site API needs no key, but it is undocumented and could change without
notice. The design's footer names it as its source, and its numbers match.

| Endpoint | Used for |
| --- | --- |
| `site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/ny/schedule?season=YYYY&seasontype=2\|3` | Completed game ids per season (2 regular season, 3 playoffs), with the playoff series note. Without `season` it returns the current one. |
| `site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=ID` | Score by quarter, team and player box scores, play-by-play with substitutions and shot positions, attendance, neutral site. |
| `sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/ID/competitions/ID` and the documents it links (`plays`, and per team `roster`, `statistics`, `linescores`, `score`, each player's `statistics/0`) | The same game data, for games whose summary answers 404. |

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
- Home and Road leave out games at a neutral site.
- On/off and pairings replay the play-by-play to know who was on the floor.
  ESPN doesn't list who starts the 2nd quarter onward, so the replay infers it
  (`src/report/lineups.rs`). A game is used for on-court numbers only when
  every player's replayed plus-minus is within 8 points of the box score.
- A game's stints come from the same replay, and are left out when that game
  fails the check above. Each one's net points can differ from the box score
  by up to that same 8.
- The impact label's thresholds are in the `impact` module of
  `src/report/compute.rs`; the label text and tooltip are in
  `web/src/render/impact.ts`.

## Layout

```
db/schema.sql          tables (datetimes in UTC)
src/main.rs            the knicks commands: serve, migrate, sync
src/server.rs          HTTP server, JSON cache, sync timer
src/espn.rs            ESPN client and parsing
src/espn_core.rs       a game from ESPN's core API, when the summary is missing
src/sync.rs            stores completed games
src/report/            load from MySQL, lineup replay, metrics
src/api.rs             the JSON the page reads
web/src/               the page: HTML, SVG charts, CSS, number formatting
web/src/api/           API types generated by ts-rs
design/index.html      the original design
```
