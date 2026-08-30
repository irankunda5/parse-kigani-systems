import { resolve } from "node:path";
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
    rollupOptions: {
      // Vite only treats index.html as an entry unless told otherwise. Without
      // this, privacy.html silently never reaches dist/ and the footer link
      // that documents what we collect returns a 404.
      input: {
        index: resolve(__dirname, "site/index.html"),
        privacy: resolve(__dirname, "site/privacy.html"),
      },
    },
  },
  test: {
    globals: true,
    include: ["../test/**/*.test.ts"],
  },
});
