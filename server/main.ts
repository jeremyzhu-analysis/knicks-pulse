import { serve } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPool, migrate } from "./db.ts";
import { Espn } from "./espn.ts";
import { exportSite } from "./export.ts";
import { syncGames } from "./sync.ts";

const USAGE = "usage: node server/main.ts serve | migrate | sync | export <file.html>";

async function main(): Promise<void> {
  const config = loadConfig();
  const [command, argument] = process.argv.slice(2);
  switch (command) {
    case "serve":
      await serve(config, createPool(config.databaseUrl));
      break;
    case "migrate":
      await migrate(config.databaseUrl);
      console.log("Schema is up to date.");
      break;
    case "sync": {
      const pool = createPool(config.databaseUrl);
      try {
        const result = await syncGames(pool, new Espn(), (line) => console.log(line));
        console.log(
          `Done. ${result.added} new games, ${result.updated} updated, ${result.completed} completed games in total.`,
        );
      } finally {
        await pool.end();
      }
      break;
    }
    case "export": {
      if (!argument) throw new Error(USAGE);
      const pool = createPool(config.databaseUrl);
      try {
        await exportSite(pool, argument);
      } finally {
        await pool.end();
      }
      console.log(`Wrote ${argument}.`);
      break;
    }
    default:
      throw new Error(USAGE);
  }
}

/** "writing x.html: EACCES: permission denied" for an error and what caused it. */
function chain(error: unknown): string {
  const parts: string[] = [];
  for (let e = error; e !== undefined && e !== null; e = e instanceof Error ? e.cause : undefined) {
    parts.push(e instanceof Error ? e.message : String(e));
  }
  return parts.join(": ");
}

try {
  await main();
} catch (error) {
  console.error(`Error: ${chain(error)}`);
  process.exitCode = 1;
}
