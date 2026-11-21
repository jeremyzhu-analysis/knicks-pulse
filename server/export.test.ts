import assert from "node:assert/strict";
import { test } from "node:test";

import { inlineAssets, snapshotJson } from "./export.ts";

test("snapshot cannot close its script element", () => {
  const json = snapshotJson([["/api/report", { name: "</script><b>" }]], "2026-11-14T00:00:00Z");
  assert.ok(!json.includes("<"));
  const parsed = JSON.parse(json);
  assert.equal(parsed.checkedAt, "2026-11-14T00:00:00Z");
  assert.equal(parsed.documents["/api/report"].name, "</script><b>");
});

test("inlines the script and stylesheet after the snapshot", () => {
  const index =
    '<head><title>T</title>\n  <script type="module" crossorigin src="/assets/a.js"></script>\n  <link rel="stylesheet" crossorigin href="/assets/a.css">\n</head><body></body>';
  const html = inlineAssets(index, "{}", (path) => {
    if (path === "/assets/a.js") return 'let s = "</script>";';
    if (path === "/assets/a.css") return "body{}";
    throw new Error(`unexpected ${path}`);
  });
  assert.equal(
    html,
    '<head><title>T</title>\n  <script>window.__KNICKS__={}</script>\n<script type="module">let s = "<\\/script>";</script>\n  <style>body{}</style>\n</head><body></body>',
  );
  assert.throws(() => inlineAssets("<body></body>", "{}", () => ""));
});

test("inlined code cannot close its element whatever the case", () => {
  const index =
    '<head><script type="module" src="/assets/a.js"></script><link rel="stylesheet" href="/assets/a.css"></head>';
  const html = inlineAssets(index, "{}", (path) => (path.endsWith(".js") ? 'a("</SCRIPT>", "</Script >")' : "b{}"));
  assert.ok(!/<\/script[^>]*>[^]*<\/script/i.test(html.slice(html.indexOf('type="module"'), html.indexOf("<style>"))));
  assert.ok(html.includes('a("<\\/SCRIPT>", "<\\/Script >")'));
  assert.throws(() => inlineAssets(index, "{}", (path) => (path.endsWith(".js") ? "x" : "a{}</STYLE>")), /<\/style/i);
});

test("inlines only files named directly under /assets/", () => {
  const index = '<head><script type="module" src="/assets/../../.env"></script></head>';
  const read: string[] = [];
  assert.throws(() => inlineAssets(index, "{}", (path) => (read.push(path), "x")), /asset path/);
  assert.deepEqual(read, []);
});
