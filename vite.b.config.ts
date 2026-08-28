import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Stamped into the bundle so a bug report can be tied to an exact build.
// Without it, "it didn't work" is unanswerable: b.js has a 60 second TTL and
// changes underneath users, so there is otherwise no way to know what they ran.
function buildId(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return `${stamp} ${sha}`;
  } catch {
    return `${stamp} nogit`;
  }
}

// b.js is injected into the Banner page by the loader bookmarklet.
//
// Hard requirements:
//   - IIFE, no ES module syntax (a <script src> injected into a page that
//     is not a module context must not use import/export)
//   - No code splitting, no dynamic import: exactly one file at a stable URL
//   - Filename must be literally "b.js" forever, because that URL is frozen
//     inside every bookmark we distribute and can never be changed
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
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
