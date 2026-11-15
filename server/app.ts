import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import rateLimit from "@fastify/rate-limit";
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Pool } from "mysql2/promise";

import { documents, type Document } from "./api.ts";
import { TEAM_ID, type Config } from "./config.ts";
import { Espn } from "./espn.ts";
import { DIST } from "./export.ts";
import { loadDataset } from "./report/load.ts";
import {
  GameDetail,
  IdParams,
  Message,
  NoBody,
  NoQuery,
  PlayerDetail,
  Report,
  ShotMaps,
  SyncOutcome,
  SyncStatus,
} from "./schema.ts";
import { checkedAt, syncGames, type SyncResult } from "./sync.ts";

/** What the routes need from the database and ESPN. */
export type Backend = {
  /** Every document of the API by path. */
  documents(): Promise<Map<string, Document>>;
  checkedAt(): Promise<string | null>;
  sync(): Promise<SyncResult>;
};

export type App = {
  server: FastifyInstance;
  /** Runs a sync, after the one in progress if there is one. */
  syncNow(): Promise<SyncResult>;
  /** True while a sync runs. */
  syncing(): boolean;
};

const text = (reply: FastifyReply, status: number, message: string) =>
  reply.code(status).type("text/plain; charset=utf-8").send(message);

const notFound = (reply: FastifyReply) => text(reply, 404, "Not found");

const errors = { 404: Message, 500: Message };

function sameSecret(given: string, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".woff2": "font/woff2",
};

/** Letters, digits, "_", "-" and inner dots: no "..", no hidden file, no separator. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Sends a file of the built page. Every segment of the path must be a plain
 * name, so the path can't leave `root`. Only a successful answer gets
 * `cacheControl`; errors stay uncached.
 */
async function sendFile(request: FastifyRequest, reply: FastifyReply, root: string, cacheControl: string) {
  let path: string;
  try {
    path = decodeURIComponent(request.url.split("?", 1)[0]!);
  } catch {
    return notFound(reply);
  }
  const segments = path.split("/").filter((segment) => segment !== "");
  if (!segments.every((segment) => SAFE_SEGMENT.test(segment))) return notFound(reply);
  let file = join(root, ...segments);
  let found = await stat(file).catch(() => null);
  if (found?.isDirectory()) {
    file = join(file, "index.html");
    found = await stat(file).catch(() => null);
  }
  if (!found?.isFile()) return notFound(reply);

  // HTTP dates have whole seconds.
  const modified = new Date(Math.floor(found.mtimeMs / 1000) * 1000);
  const etag = `"${Math.floor(found.mtimeMs).toString(16)}-${found.size.toString(16)}"`;
  reply.header("cache-control", cacheControl).header("last-modified", modified.toUTCString()).header("etag", etag);
  // If-None-Match, when sent, decides alone.
  const noneMatch = request.headers["if-none-match"];
  const unchanged =
    noneMatch !== undefined
      ? noneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag)
      : modified.getTime() <= Date.parse(request.headers["if-modified-since"] ?? "");
  if (unchanged) return reply.code(304).send();
  reply.type(CONTENT_TYPES[extname(file)] ?? "application/octet-stream").header("content-length", found.size);
  return reply.send(createReadStream(file));
}

/** Requests one address may make per minute: to everything, and to start a sync (wrong secrets count). */
const REQUESTS_PER_MINUTE = 300;
const SYNCS_PER_MINUTE = 5;

/** Sent with every response. The page's scripts and styles are its own files, plus style attributes it writes. */
const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
};

export async function buildApp(backend: Backend, syncSecret: string | null, dist = DIST): Promise<App> {
  const server = fastify({
    // A tunnel or reverse proxy on this machine connects from loopback and
    // names the visitor in X-Forwarded-For; only then is that header believed,
    // so request.ip is the visitor's address and not the proxy's.
    trustProxy: "loopback",
    // No route reads more than an empty body.
    bodyLimit: 1024,
  });
  await server.register(rateLimit, { global: true, max: REQUESTS_PER_MINUTE, timeWindow: "1 minute" });
  server.addHook("onSend", async (_request, reply) => {
    reply.headers(SECURITY_HEADERS);
  });

  // The documents only change when a sync stores games, so they're built once
  // and kept until then. Keeping the promise makes concurrent first requests
  // wait for one build instead of starting their own.
  let built: Promise<Map<string, Document>> | null = null;
  const builtDocuments = () => {
    built ??= backend.documents().catch((error: unknown) => {
      built = null;
      throw error;
    });
    return built;
  };

  // Set for the length of a sync, so two never run at once.
  let running: Promise<SyncResult> | null = null;
  const startSync = (): Promise<SyncResult> => {
    const sync = backend.sync().then((result) => {
      if (result.added + result.updated > 0) built = null;
      return result;
    });
    running = sync;
    const done = () => {
      if (running === sync) running = null;
    };
    sync.then(done, done);
    return sync;
  };

  server.setNotFoundHandler({ preHandler: server.rateLimit() }, (_request, reply) => notFound(reply));
  server.setErrorHandler((error: { validation?: unknown; validationContext?: string; statusCode?: number }, _request, reply) => {
    // An id that isn't a number names no document.
    if (error.validation && error.validationContext === "params") return notFound(reply);
    if (error.statusCode === 429) return text(reply, 429, "Too many requests");
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return text(reply, error.statusCode, "Bad request");
    }
    console.error(error);
    return text(reply, 500, "Something went wrong.");
  });

  // Sent as bytes: Fastify would add a charset to the content type of a
  // payload it serializes itself.
  const json = (reply: FastifyReply, bytes: Buffer) =>
    reply.header("cache-control", "no-cache").type("application/json").send(bytes);
  /** `value` as the route's response schema for 200 writes it. */
  const serialized = (reply: FastifyReply, value: unknown): Buffer => {
    const written = reply.serialize(value);
    return typeof written === "string" ? Buffer.from(written) : Buffer.from(new Uint8Array(written));
  };

  // Each built document's JSON, written on its first request.
  const bytesOf = new WeakMap<Document, Buffer>();
  /** One of the built documents, by the request's path. */
  const document = async (kind: Document["kind"], path: string, reply: FastifyReply) => {
    const found = (await builtDocuments()).get(path);
    if (found?.kind !== kind) return notFound(reply);
    let bytes = bytesOf.get(found);
    if (!bytes) {
      bytes = serialized(reply, found.value);
      bytesOf.set(found, bytes);
    }
    return json(reply, bytes);
  };

  server.get("/api/report", { schema: { querystring: NoQuery, response: { 200: Report, ...errors } } }, (_request, reply) =>
    document("report", "/api/report", reply),
  );
  server.get("/api/shots", { schema: { querystring: NoQuery, response: { 200: ShotMaps, ...errors } } }, (_request, reply) =>
    document("shots", "/api/shots", reply),
  );
  server.get<{ Params: IdParams }>(
    "/api/games/:id",
    { schema: { params: IdParams, querystring: NoQuery, response: { 200: GameDetail, ...errors } } },
    (request, reply) => document("game", `/api/games/${request.params.id}`, reply),
  );
  server.get<{ Params: IdParams }>(
    "/api/players/:id",
    { schema: { params: IdParams, querystring: NoQuery, response: { 200: PlayerDetail, ...errors } } },
    (request, reply) => document("player", `/api/players/${request.params.id}`, reply),
  );
  server.get(
    "/api/sync",
    { schema: { querystring: NoQuery, response: { 200: SyncStatus, ...errors } } },
    async (_request, reply) => json(reply, serialized(reply, { checkedAt: await backend.checkedAt() })),
  );

  // Starts a sync unless one is running.
  server.post(
    "/api/sync",
    {
      schema: {
        querystring: NoQuery,
        body: NoBody,
        response: { 200: SyncOutcome, 401: Message, 403: Message, 429: Message, ...errors },
      },
      config: { rateLimit: { max: SYNCS_PER_MINUTE, timeWindow: "1 minute" } },
      // After onRequest, where the rate limiter counts the attempt.
      preParsing: async (request, reply) => {
        // Browsers say where a request comes from; one sent by another site's page is refused.
        const site = request.headers["sec-fetch-site"];
        if (site !== undefined && site !== "same-origin") return text(reply, 403, "Forbidden");
        if (syncSecret === null) return text(reply, 403, "Forbidden");
        const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
        if (given === undefined || !sameSecret(given, syncSecret)) {
          return text(reply.header("www-authenticate", "Bearer"), 401, "Unauthorized");
        }
      },
    },
    async (_request, reply) => {
      const result = running ? null : await startSync();
      const outcome = {
        busy: result === null,
        added: result?.added ?? 0,
        updated: result?.updated ?? 0,
        checkedAt: await backend.checkedAt(),
      };
      return json(reply, serialized(reply, outcome));
    },
  );

  // Vite puts a content hash in every file name under assets/.
  server.get("/assets/*", (request, reply) => sendFile(request, reply, dist, "public, max-age=31536000, immutable"));
  server.get("/*", (request, reply) => sendFile(request, reply, dist, "no-cache"));

  return {
    server,
    syncing: () => running !== null,
    async syncNow() {
      while (running) await running.catch(() => {});
      return startSync();
    },
  };
}

/**
 * Syncs once at startup, then every `minutes` (0 = only once). A tick missed
 * during a long sync is skipped.
 */
async function syncLoop(app: App, minutes: number, stop: AbortSignal): Promise<void> {
  const interval = minutes * 60_000;
  const started = Date.now();
  for (;;) {
    try {
      await app.syncNow();
    } catch (error) {
      console.error("[sync] failed:", error);
    }
    if (minutes === 0) return;
    const elapsed = Date.now() - started;
    const next = (Math.floor(elapsed / interval) + 1) * interval;
    try {
      await sleep(next - elapsed, undefined, { signal: stop });
    } catch {
      return;
    }
  }
}

export async function serve(config: Config, pool: Pool): Promise<void> {
  const espn = new Espn();
  const app = await buildApp(
    {
      documents: async () => documents(await loadDataset(pool, TEAM_ID)),
      checkedAt: () => checkedAt(pool),
      sync: () => syncGames(pool, espn, (line) => console.log(`[sync] ${line}`)),
    },
    config.syncSecret,
  );
  try {
    await app.server.listen({ host: config.host, port: config.port });
  } catch (error) {
    throw new Error(`listening on ${config.host}:${config.port}`, { cause: error });
  }
  console.log(`Listening on http://${config.host}:${config.port}`);

  const stop = new AbortController();
  void syncLoop(app, config.syncIntervalMinutes, stop.signal);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  stop.abort();
  await app.server.close();
  // Leaving while a sync runs drops its connection, and MySQL rolls back the
  // open transaction.
  if (app.syncing()) process.exit(0);
  await pool.end();
}
