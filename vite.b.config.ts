import { defineConfig } from "vite";

// b.js is injected into the Banner page by the loader bookmarklet.
//
// Hard requirements:
//   - IIFE, no ES module syntax (a <script src> injected into a page that
//     is not a module context must not use import/export)
//   - No code splitting, no dynamic import: exactly one file at a stable URL
//   - Filename must be literally "b.js" forever, because that URL is frozen
//     inside every bookmark we distribute and can never be changed
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/bookmarklet.ts",
      formats: ["iife"],
      name: "__calens",
      fileName: () => "b.js",
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
      },
    },
    target: "es2019",
  },
});
