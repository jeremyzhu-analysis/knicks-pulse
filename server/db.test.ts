import assert from "node:assert/strict";
import { test } from "node:test";

import { ADDED_COLUMNS, SCHEMA, escapeId, splitDatabase } from "./db.ts";

test("splits database from url", () => {
  assert.deepEqual(splitDatabase("mysql://knicks:knicks@127.0.0.1:3307/knicks"), [
    "mysql://knicks:knicks@127.0.0.1:3307/",
    "knicks",
  ]);
  assert.deepEqual(splitDatabase("mysql://u@h/my%20db?ssl-mode=disabled"), ["mysql://u@h/?ssl-mode=disabled", "my db"]);
  assert.throws(() => splitDatabase("mysql://u@h"));
  assert.throws(() => splitDatabase("mysql://u@h/"));
});

test("added columns are in the schema", () => {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    assert.ok(SCHEMA.includes(`  ${column} ${definition},\n`), `${table}.${column} differs from schema.sql`);
  }
});

test("escapes identifiers", () => {
  assert.equal(escapeId("knicks"), "`knicks`");
  assert.equal(escapeId("a`b"), "`a``b`");
});
