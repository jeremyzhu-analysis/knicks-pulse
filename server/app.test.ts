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
  const { server } = buildApp(fake, "s3cret", site());
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
  const { server } = buildApp(fake, null, site());
  const res = await server.inject({ method: "POST", url: "/api/sync", headers: { authorization: "Bearer " } });
  assert.equal(res.statusCode, 403);
  assert.equal(fake.syncs, 0);
});

test("a second sync request during a sync starts none", async () => {
  let finish = (_: SyncResult) => {};
  const fake = backend({ sync: () => new Promise<SyncResult>((resolve) => (finish = resolve)) });
  const { server } = buildApp(fake, "s3cret", site());
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
  const app = buildApp(fake, null, site());
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
  const { server } = buildApp(backend(), null, site());
  for (const url of ["/api/games/1", "/api/games/abc", "/api/players/-1", "/api/nope"]) {
    const res = await server.inject({ url });
    assert.equal(res.statusCode, 404, url);
    assert.equal(res.body, "Not found", url);
  }
});

test("serves the built page with its cache headers and nothing outside it", async () => {
  const { server } = buildApp(backend(), null, site());
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

  for (const url of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/..%2f..%2fsecret.txt", "/.hidden", "/assets%00"]) {
    const res = await server.inject({ url });
    assert.equal(res.statusCode, 404, url);
    assert.notEqual(res.body, "secret", url);
    assert.notEqual(res.body, "hidden", url);
  }
});
