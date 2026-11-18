import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Document } from "./api.ts";
import { buildApp, type Backend } from "./app.ts";
import type { SyncResult } from "./sync.ts";

/** A built page with one asset, next to a file the server must never send. */
function site(): string {
  const root = mkdtempSync(join(tmpdir(), "knicks-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(root, "secret.txt"), "secret");
  writeFileSync(join(dist, "index.html"), "<!doctype html>");
  writeFileSync(join(dist, "assets", "app-1.js"), "1");
  writeFileSync(join(dist, ".hidden"), "hidden");
  return dist;
}

function backend(overrides: Partial<Backend> = {}): Backend & { syncs: number } {
  const self = {
    syncs: 0,
    documents: async () => new Map<string, Document>(),
    checkedAt: async () => "2026-11-14T00:00:00Z",
    sync: async (): Promise<SyncResult> => {
      self.syncs++;
      return { completed: 3, added: 1, updated: 2 };
    },
    ...overrides,
  };
  return self;
}

test("POST /api/sync needs the secret", async () => {
  const fake = backend();
  const { server } = await buildApp(fake, "s3cret", site());
  const post = (headers: Record<string, string>) => server.inject({ method: "POST", url: "/api/sync", headers });

  assert.equal((await post({})).statusCode, 401);
  assert.equal((await post({ authorization: "Bearer wrong" })).statusCode, 401);
  assert.equal((await post({ authorization: "s3cret" })).statusCode, 401);
  assert.equal((await post({ authorization: "Bearer s3cret", "sec-fetch-site": "cross-site" })).statusCode, 403);
  assert.equal(fake.syncs, 0);

  const ok = await post({ authorization: "Bearer s3cret", "sec-fetch-site": "same-origin" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["content-type"], "application/json");
  assert.deepEqual(ok.json(), { busy: false, added: 1, updated: 2, checkedAt: "2026-11-14T00:00:00Z" });
  assert.equal(fake.syncs, 1);
});

test("POST /api/sync is off without a configured secret", async () => {
  const fake = backend();
  const { server } = await buildApp(fake, null, site());
  const res = await server.inject({ method: "POST", url: "/api/sync", headers: { authorization: "Bearer " } });
  assert.equal(res.statusCode, 403);
  assert.equal(fake.syncs, 0);
});

test("a second sync request during a sync starts none", async () => {
  let finish: (result: SyncResult) => void = () => {};
  const fake = backend({ sync: () => new Promise<SyncResult>((resolve) => (finish = resolve)) });
  const { server } = await buildApp(fake, "s3cret", site());
  const post = () => server.inject({ method: "POST", url: "/api/sync", headers: { authorization: "Bearer s3cret" } });
  const first = post();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual((await post()).json(), { busy: true, added: 0, updated: 0, checkedAt: "2026-11-14T00:00:00Z" });
  finish({ completed: 1, added: 0, updated: 0 });
  assert.equal((await first).json().busy, false);
});

test("documents are built once and again after a sync that stored games", async () => {
  let builds = 0;
  const report = { kind: "shots", value: [] } satisfies Document;
  const fake = backend({
    documents: async () => {
      builds++;
      return new Map<string, Document>([["/api/shots", report]]);
    },
  });
  const app = await buildApp(fake, null, site());
  const get = () => app.server.inject({ url: "/api/shots" });
  const res = await get();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/json");
  assert.equal(res.headers["cache-control"], "no-cache");
  assert.equal(res.body, "[]");
  await get();
  assert.equal(builds, 1);
  await app.syncNow();
  await get();
  assert.equal(builds, 2);
});

test("unknown and malformed ids answer a plain 404", async () => {
  const { server } = await buildApp(backend(), null, site());
  for (const url of ["/api/games/1", "/api/games/abc", "/api/players/-1", "/api/nope"]) {
    const res = await server.inject({ url });
    assert.equal(res.statusCode, 404, url);
    assert.equal(res.body, "Not found", url);
  }
});

test("serves the built page with its cache headers and nothing outside it", async () => {
  const { server } = await buildApp(backend(), null, site());
  const page = await server.inject({ url: "/" });
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers["content-type"], "text/html");
  assert.equal(page.headers["cache-control"], "no-cache");
  assert.equal(page.body, "<!doctype html>");

  const asset = await server.inject({ url: "/assets/app-1.js" });
  assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(asset.body, "1");

  const again = await server.inject({ url: "/", headers: { "if-none-match": String(page.headers.etag) } });
  assert.equal(again.statusCode, 304);

  const missing = await server.inject({ url: "/assets/nope.js" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.headers["cache-control"], undefined);

  for (const url of [
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/.hidden",
    "/assets%00",
  ]) {
    const res = await server.inject({ url });
    assert.equal(res.statusCode, 404, url);
    assert.notEqual(res.body, "secret", url);
    assert.notEqual(res.body, "hidden", url);
  }
});

test("a method the path doesn't take answers 405 with the ones it does", async () => {
  const { server } = await buildApp(backend(), "s3cret", site());
  for (const [method, url, allow] of [
    ["POST", "/api/report", "GET,HEAD"],
    ["DELETE", "/api/sync", "GET,HEAD,POST"],
    ["PUT", "/", "GET,HEAD"],
    ["POST", "/nope", "GET,HEAD"],
  ] as const) {
    const res = await server.inject({ method, url });
    assert.equal(res.statusCode, 405, `${method} ${url}`);
    assert.equal(res.headers.allow, allow, `${method} ${url}`);
    assert.equal(res.body, "", `${method} ${url}`);
  }
});

test("sends the part of a file a Range header asks for", async () => {
  const { server } = await buildApp(backend(), null, site());
  const get = (range: string) => server.inject({ url: "/", headers: { range } });
  const whole = await server.inject({ url: "/" });
  assert.equal(whole.headers["accept-ranges"], "bytes");

  // The page is "<!doctype html>", 15 bytes.
  for (const [range, body, contentRange] of [
    ["bytes=2-8", "doctype", "bytes 2-8/15"],
    ["bytes=10-", "html>", "bytes 10-14/15"],
    ["bytes=-5", "html>", "bytes 10-14/15"],
    ["bytes=10-999", "html>", "bytes 10-14/15"],
  ] as const) {
    const res = await get(range);
    assert.equal(res.statusCode, 206, range);
    assert.equal(res.body, body, range);
    assert.equal(res.headers["content-range"], contentRange, range);
    assert.equal(res.headers["content-length"], String(body.length), range);
    assert.equal(res.headers["content-type"], "text/html", range);
  }

  for (const range of ["bytes=15-", "bytes=9-2", "bytes=-0", "bytes=0-1,4-5", "lines=1-2"]) {
    const res = await get(range);
    assert.equal(res.statusCode, 416, range);
    assert.equal(res.headers["content-range"], "bytes */15", range);
    assert.equal(res.headers["cache-control"], undefined, range);
  }
});

test("every response carries the security headers", async () => {
  const { server } = await buildApp(backend(), null, site());
  for (const url of ["/", "/api/sync", "/nope"]) {
    const res = await server.inject({ url });
    assert.match(String(res.headers["content-security-policy"]), /default-src 'self'/, url);
    assert.equal(res.headers["x-content-type-options"], "nosniff", url);
    assert.equal(res.headers["x-frame-options"], "DENY", url);
  }
});

test("a URL that can't be decoded answers a plain 400 with the security headers", async () => {
  const { server } = await buildApp(backend(), null, site());
  for (const url of ["/%E0%A4%A", "/api/games/%zz"]) {
    const res = await server.inject({ url });
    assert.equal(res.statusCode, 400, url);
    assert.equal(res.headers["content-type"], "text/plain; charset=utf-8", url);
    assert.equal(res.body, "Bad request", url);
    assert.match(String(res.headers["content-security-policy"]), /default-src 'self'/, url);
    assert.equal(res.headers["x-content-type-options"], "nosniff", url);
    assert.equal(res.headers["x-frame-options"], "DENY", url);
    assert.equal(res.headers["referrer-policy"], "no-referrer", url);
    assert.equal(res.headers["cross-origin-opener-policy"], "same-origin", url);
  }
});

test("sync attempts are limited per visitor, read from the proxy's header", async () => {
  const fake = backend();
  const { server } = await buildApp(fake, "s3cret", site());
  // The tunnel connects from loopback and names the visitor in X-Forwarded-For.
  const attempt = (visitor: string, secret = "wrong") =>
    server.inject({
      method: "POST",
      url: "/api/sync",
      remoteAddress: "127.0.0.1",
      headers: { authorization: `Bearer ${secret}`, "x-forwarded-for": `10.9.9.9, ${visitor}` },
    });
  for (let i = 0; i < 5; i++) assert.equal((await attempt("203.0.113.1")).statusCode, 401);
  const limited = await attempt("203.0.113.1", "s3cret");
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body, "Too many requests");
  assert.ok(limited.headers["retry-after"]);
  assert.equal(fake.syncs, 0);
  // Another visitor has their own budget; the address a visitor claims for themselves is ignored.
  assert.equal((await attempt("203.0.113.2", "s3cret")).statusCode, 200);
});

test("a visitor not behind a local proxy can't pick their address", async () => {
  const { server } = await buildApp(backend(), "s3cret", site());
  const attempt = (claimed: string) =>
    server.inject({
      method: "POST",
      url: "/api/sync",
      remoteAddress: "198.51.100.7",
      headers: { authorization: "Bearer wrong", "x-forwarded-for": claimed },
    });
  for (let i = 0; i < 5; i++) assert.equal((await attempt(`203.0.113.${i}`)).statusCode, 401);
  assert.equal((await attempt("203.0.113.99")).statusCode, 429);
});

test("a request body is refused", async () => {
  const { server } = await buildApp(backend(), "s3cret", site());
  const res = await server.inject({
    method: "POST",
    url: "/api/sync",
    headers: { authorization: "Bearer s3cret", "content-type": "application/json" },
    payload: JSON.stringify({ padding: "x".repeat(2000) }),
  });
  assert.equal(res.statusCode, 413);
});
