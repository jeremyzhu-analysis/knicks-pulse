import type { Game } from "../api/Game.ts";

export const margin = (game: Game) => game.pts - game.oppPts;
export const won = (game: Game) => game.pts > game.oppPts;
