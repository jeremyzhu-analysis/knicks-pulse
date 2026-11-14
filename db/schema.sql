-- All DATETIME columns hold UTC.

CREATE TABLE IF NOT EXISTS teams (
  id INT UNSIGNED PRIMARY KEY,
  abbreviation VARCHAR(8) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  short_name VARCHAR(32) NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id INT UNSIGNED PRIMARY KEY,
  full_name VARCHAR(96) NOT NULL,
  position VARCHAR(8) NULL
);

-- season_year is ESPN's: the year the season ends (2027 = 2026-27).
-- season_type is ESPN's: 2 regular season, 3 playoffs.
-- store_format is the STORE_FORMAT of the sync that wrote the game; a sync
-- fetches again every game below its own.
CREATE TABLE IF NOT EXISTS games (
  id BIGINT UNSIGNED PRIMARY KEY,
  season_year SMALLINT UNSIGNED NOT NULL,
  season_type TINYINT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  home_team_id INT UNSIGNED NOT NULL,
  away_team_id INT UNSIGNED NOT NULL,
  home_score SMALLINT UNSIGNED NOT NULL,
  away_score SMALLINT UNSIGNED NOT NULL,
  periods TINYINT UNSIGNED NOT NULL,
  venue VARCHAR(128) NULL,
  note VARCHAR(128) NULL,
  synced_at DATETIME NOT NULL,
  neutral BOOLEAN NOT NULL DEFAULT FALSE,
  attendance INT UNSIGNED NULL,
  store_format TINYINT UNSIGNED NOT NULL DEFAULT 1,
  INDEX games_season (season_year, season_type),
  FOREIGN KEY (home_team_id) REFERENCES teams (id),
  FOREIGN KEY (away_team_id) REFERENCES teams (id)
);

CREATE TABLE IF NOT EXISTS game_team_stats (
  game_id BIGINT UNSIGNED NOT NULL,
  team_id INT UNSIGNED NOT NULL,
  pts SMALLINT UNSIGNED NOT NULL,
  fgm SMALLINT UNSIGNED NOT NULL,
  fga SMALLINT UNSIGNED NOT NULL,
  fg3m SMALLINT UNSIGNED NOT NULL,
  fg3a SMALLINT UNSIGNED NOT NULL,
  ftm SMALLINT UNSIGNED NOT NULL,
  fta SMALLINT UNSIGNED NOT NULL,
  oreb SMALLINT UNSIGNED NOT NULL,
  dreb SMALLINT UNSIGNED NOT NULL,
  ast SMALLINT UNSIGNED NOT NULL,
  stl SMALLINT UNSIGNED NOT NULL,
  blk SMALLINT UNSIGNED NOT NULL,
  tov SMALLINT UNSIGNED NOT NULL,
  paint_pts SMALLINT UNSIGNED NOT NULL,
  fast_break_pts SMALLINT UNSIGNED NOT NULL,
  pts_off_tov SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (game_id, team_id),
  FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams (id)
);

CREATE TABLE IF NOT EXISTS game_periods (
  game_id BIGINT UNSIGNED NOT NULL,
  team_id INT UNSIGNED NOT NULL,
  period TINYINT UNSIGNED NOT NULL,
  pts SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (game_id, team_id, period),
  FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
);

-- One row per player who got on the floor.
CREATE TABLE IF NOT EXISTS game_players (
  game_id BIGINT UNSIGNED NOT NULL,
  player_id INT UNSIGNED NOT NULL,
  team_id INT UNSIGNED NOT NULL,
  starter BOOLEAN NOT NULL,
  minutes SMALLINT UNSIGNED NOT NULL,
  pts SMALLINT UNSIGNED NOT NULL,
  fgm SMALLINT UNSIGNED NOT NULL,
  fga SMALLINT UNSIGNED NOT NULL,
  fg3m SMALLINT UNSIGNED NOT NULL,
  fg3a SMALLINT UNSIGNED NOT NULL,
  ftm SMALLINT UNSIGNED NOT NULL,
  fta SMALLINT UNSIGNED NOT NULL,
  oreb SMALLINT UNSIGNED NOT NULL,
  dreb SMALLINT UNSIGNED NOT NULL,
  ast SMALLINT UNSIGNED NOT NULL,
  stl SMALLINT UNSIGNED NOT NULL,
  blk SMALLINT UNSIGNED NOT NULL,
  tov SMALLINT UNSIGNED NOT NULL,
  pf SMALLINT UNSIGNED NOT NULL,
  plus_minus SMALLINT NOT NULL,
  PRIMARY KEY (game_id, player_id),
  INDEX game_players_team (team_id, game_id),
  FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players (id)
);

-- Play-by-play in ESPN's order (ord). clock_s is seconds left in the period.
-- For substitutions player1 enters and player2 leaves.
-- shooting marks shots, free throws included; points_attempted is 2 or 3 on a
-- field-goal attempt and score_value is the points the play scored. x and y
-- are ESPN's court position, NULL where ESPN gives none.
CREATE TABLE IF NOT EXISTS plays (
  game_id BIGINT UNSIGNED NOT NULL,
  ord SMALLINT UNSIGNED NOT NULL,
  period TINYINT UNSIGNED NOT NULL,
  clock_s DECIMAL(5, 1) NOT NULL,
  type_text VARCHAR(64) NOT NULL,
  team_id INT UNSIGNED NULL,
  home_score SMALLINT UNSIGNED NOT NULL,
  away_score SMALLINT UNSIGNED NOT NULL,
  text VARCHAR(255) NOT NULL,
  player1_id INT UNSIGNED NULL,
  player2_id INT UNSIGNED NULL,
  player3_id INT UNSIGNED NULL,
  shooting BOOLEAN NOT NULL DEFAULT FALSE,
  score_value TINYINT UNSIGNED NOT NULL DEFAULT 0,
  points_attempted TINYINT UNSIGNED NOT NULL DEFAULT 0,
  x SMALLINT NULL,
  y SMALLINT NULL,
  PRIMARY KEY (game_id, ord),
  FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
);
