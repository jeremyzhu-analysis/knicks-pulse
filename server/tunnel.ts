// `npm run tunnel`: a Cloudflare quick tunnel to the server `npm run serve`
// started with the same `.env`. cloudflared prints the trycloudflare.com
// address. Arguments after `--` go to cloudflared as they are.

import { spawn } from "node:child_process";

import { loadConfig } from "./config.ts";

const isLoopback = (host: string) => host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);

/** The address cloudflared forwards to. */
function origin(host: string, port: number): string {
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function main(): void {
  const config = loadConfig();
  if (!isLoopback(config.host)) {
    // Listening on the network as well would leave a way in that skips Cloudflare.
    throw new Error(`HOST is ${config.host}; set it to 127.0.0.1 before opening a tunnel.`);
  }
  if (config.syncSecret === null) {
    console.error('SYNC_SECRET is empty: visitors can read the site, and "Check for new games" is off.');
  }
  const child = spawn("cloudflared", ["tunnel", "--url", origin(config.host, config.port), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "ENOENT"
        ? "cloudflared isn't installed or not on the PATH. See the README, section Sharing through a Cloudflare tunnel."
        : `Error: starting cloudflared: ${error.message}`,
    );
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
  // Ctrl-C reaches cloudflared as well, since it shares the terminal; this
  // process then waits for it to close the tunnel.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
