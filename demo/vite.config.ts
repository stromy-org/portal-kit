import { defineConfig } from "vite";

// Built once for the e2e run; served by e2e/serve.ts with the strict CSP header.
export default defineConfig({
  root: "demo",
  base: "/",
  build: { outDir: "../e2e/.dist", emptyOutDir: true, sourcemap: false, modulePreload: { polyfill: false } },
});
