import { ingest } from "../src/lib/ingest";

async function main() {
  const result = await ingest();
console.log(
  JSON.stringify(
    {
      added: result.added.length,
      updated: result.updated.length,
      skipped: result.skipped,
      errors: result.errors,
      games: result.games,
      checkedAt: result.checkedAt,
      labels: result.added.concat(result.updated).map((row) => row.label),
    },
    null,
    2,
  ),
);
  if (result.errors.length) process.exitCode = 1;
}

main();
