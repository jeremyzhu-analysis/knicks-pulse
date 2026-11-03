import { pool } from "./db.ts";
import { syncGames } from "./sync.ts";

const result = await syncGames(console.log);
await pool.end();
console.log(`Done. ${result.added} new games, ${result.completed} completed games in total.`);
