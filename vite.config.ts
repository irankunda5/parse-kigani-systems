import { defineConfig } from "vite";

// Builds the public landing page at parse.kigani-systems.com.
// The bookmarklet payload (b.js) is built separately by vite.b.config.ts,
// because it needs to be a single self-contained IIFE with no module syntax.
export default defineConfig({
  root: "site",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  test: {
    globals: true,
    include: ["../test/**/*.test.ts"],
  },
});
