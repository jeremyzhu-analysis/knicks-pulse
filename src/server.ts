import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { syncGames } from "./sync.ts";
import { loadDataset } from "./report/load.ts";
import { buildReport } from "./report/compute.ts";
import { renderPage } from "./render/page.ts";

const assets: Record<string, string> = {
  "/styles.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
};

// The page only changes when a sync stores new games, so it is rendered once per sync.
let page: Promise<string> | null = null;
function currentPage(): Promise<string> {
  page ??= loadDataset(config.team.id).then((data) => renderPage(buildReport(data)));
  page.catch(() => {
    page = null;
  });
  return page;
}

async function sync(): Promise<void> {
  try {
    const result = await syncGames((line) => console.log(`[sync] ${line}`));
    if (result.added > 0) page = null;
  } catch (error) {
    console.error("[sync] failed:", error);
  }
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
    } else if (path === "/") {
      const html = await currentPage();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" }).end(req.method === "HEAD" ? undefined : html);
    } else if (assets[path]) {
      const body = await readFile(new URL(`../public${path}`, import.meta.url));
      res.writeHead(200, { "content-type": assets[path], "cache-control": "max-age=300" }).end(req.method === "HEAD" ? undefined : body);
    } else {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Something went wrong.");
  }
});

server.listen(config.port, config.host, () => console.log(`Listening on http://${config.host}:${config.port}`));

void sync();
const timer =
  config.syncIntervalMinutes > 0 ? setInterval(() => void sync(), config.syncIntervalMinutes * 60_000) : null;

function shutdown() {
  if (timer) clearInterval(timer);
  server.close(() => void pool.end());
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
