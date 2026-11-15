// `export`: the whole site as one HTML file that needs no server. The built
// page (`npm run build`) goes in with its script and stylesheet inlined, and
// every document the API would serve goes in as `window.__KNICKS__`, which
// the page reads instead of fetching.

import { readFileSync, writeFileSync } from "node:fs";

import type { Pool } from "mysql2/promise";

import { documents } from "./api.ts";
import { TEAM_ID } from "./config.ts";
import { loadDataset } from "./report/load.ts";
import { checkedAt } from "./sync.ts";

/** Built by `npm run build`; relative to the repo root. */
export const DIST = "web/dist";

function read(path: string, hint = ""): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`reading ${path}${hint}`, { cause: error });
  }
}

export async function exportSite(pool: Pool, to: string): Promise<void> {
  const data = await loadDataset(pool, TEAM_ID);
  const values = [...documents(data)].map(([path, document]): [string, unknown] => [path, document.value]);
  const snapshot = snapshotJson(values, await checkedAt(pool));
  const index = read(`${DIST}/index.html`, "; run `npm run build` first");
  const html = inlineAssets(index, snapshot, (path) => read(`${DIST}${path}`));
  try {
    writeFileSync(to, html);
  } catch (error) {
    throw new Error(`writing ${to}`, { cause: error });
  }
}

/**
 * `{"checkedAt": …, "documents": {path: document, …}}`, safe inside a
 * `<script>` element: `<` only occurs inside JSON strings, where `<`
 * means the same, so no `</script>` or `<!--` can end or derail the element.
 */
export function snapshotJson(documents: readonly [string, unknown][], checkedAt: string | null): string {
  return JSON.stringify({ checkedAt, documents: Object.fromEntries(documents) }).replaceAll("<", "\\u003c");
}

/**
 * Replaces every element of the built index.html that loads a file from
 * `/assets/` with the file's content, and puts the snapshot ahead of the
 * first one so the page's script finds it. `read` takes the path as written
 * in the page, such as "/assets/index-CH1jHogz.js".
 */
export function inlineAssets(index: string, snapshot: string, read: (path: string) => string): string {
  const MARKER = '"/assets/';
  let html = "";
  let rest = index;
  let scripts = 0;
  let placed = false;
  for (let found = rest.indexOf(MARKER); found >= 0; found = rest.indexOf(MARKER)) {
    const start = rest.lastIndexOf("<", found - 1);
    if (found === 0 || start < 0) throw new Error("index.html: /assets/ outside a tag");
    const pathStart = found + 1;
    const pathEnd = rest.indexOf('"', pathStart);
    if (pathEnd < 0) throw new Error("index.html: unclosed attribute");
    const path = rest.slice(pathStart, pathEnd);
    const tag = rest.slice(start);
    const content = read(path);
    html += rest.slice(0, start);
    if (!placed) {
      html += `<script>window.__KNICKS__=${snapshot}</script>\n`;
      placed = true;
    }
    let end: number;
    if (tag.startsWith("<script")) {
      scripts++;
      // "</script" inside the code would end the element early; "<\/"
      // means the same to JavaScript in a string or a regular expression.
      html += `<script type="module">${content.replaceAll("</script", "<\\/script")}</script>`;
      const close = tag.indexOf("</script>");
      if (close < 0) throw new Error("index.html: unclosed <script>");
      end = close + "</script>".length;
    } else if (tag.startsWith("<link")) {
      if (content.includes("</style")) throw new Error(`${path} contains </style and can't be inlined`);
      html += `<style>${content}</style>`;
      const close = tag.indexOf(">");
      if (close < 0) throw new Error("index.html: unclosed <link>");
      end = close + 1;
    } else {
      throw new Error(`index.html loads ${path} in a way export doesn't know`);
    }
    rest = rest.slice(start + end);
  }
  if (scripts === 0) throw new Error("index.html loads no script from /assets/; run `npm run build` first");
  return html + rest;
}
