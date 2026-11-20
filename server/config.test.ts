import assert from "node:assert/strict";
import { test } from "node:test";

import { configFrom } from "./config.ts";

test("reads settings with their defaults", () => {
  const config = configFrom({ DATABASE_URL: "mysql://a:b@h:1/db", HOST: "", PORT: " 4000 " });
  assert.deepEqual(config, {
    databaseUrl: "mysql://a:b@h:1/db",
    host: "127.0.0.1",
    port: 4000,
    syncIntervalMinutes: 60,
    syncSecret: null,
  });
  assert.equal(configFrom({ DATABASE_URL: "x", SYNC_INTERVAL_MINUTES: "0" }).syncIntervalMinutes, 0);
  assert.equal(configFrom({ DATABASE_URL: "x", SYNC_SECRET: "s3cret" }).syncSecret, "s3cret");
});

test("refuses a missing database and numbers that aren't whole", () => {
  assert.throws(() => configFrom({}), /Missing environment variable DATABASE_URL/);
  assert.throws(() => configFrom({ DATABASE_URL: "x", PORT: "3000.5" }), /PORT must be a whole number, got "3000.5"/);
  assert.throws(() => configFrom({ DATABASE_URL: "x", PORT: "70000" }), /PORT must be a whole number/);
  assert.throws(() => configFrom({ DATABASE_URL: "x", SYNC_INTERVAL_MINUTES: "-1" }), /whole number/);
});
