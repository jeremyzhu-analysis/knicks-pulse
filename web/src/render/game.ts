import type { Game } from "../api/Game.ts";

export const margin = (game: Game) => game.pts - game.oppPts;
export const won = (game: Game) => game.pts > game.oppPts;
/** Where the game was played, from the Knicks' side. */
export const site = (game: Game) => (game.neutral ? "Neutral" : game.home ? "Home" : "Road");
/** Whether the opponent hosted: a neutral site reads like a home game. */
export const hosted = (game: Game) => game.home || game.neutral;
