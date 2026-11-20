import { defineConfig } from "vite";

// Run as `vite web`: the root is this folder and the build goes to web/dist,
// which the server serves.
export default defineConfig({
  server: {
    // The API comes from `npm run serve` during development.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
