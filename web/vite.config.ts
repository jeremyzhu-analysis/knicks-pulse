import { defineConfig } from "vite";

// Run as `vite web`: the root is this folder and the build goes to web/dist,
// which the Rust server serves.
export default defineConfig({
  server: {
    // The API comes from `cargo run -- serve` during development.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
