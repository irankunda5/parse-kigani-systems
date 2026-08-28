import { readFileSync, statSync } from "node:fs";

// The build runs Vite twice, and a partial build is worse than a failed one:
// the landing page deploys fine while b.js 404s, so the site looks healthy
// and every bookmarklet in circulation silently stops working.
// Fail the build instead.

const checks = [
  {
    path: "dist/index.html",
    assert: (text) => text.includes("parse.kigani-systems.com/b.js") || "landing page is missing the loader URL",
  },
  {
    path: "dist/b.js",
    assert: (text) => {
      if (!text.startsWith("(function()")) return "b.js is not an IIFE; it will not run when injected into a page";
      if (/^\s*(import|export)\s/m.test(text)) return "b.js contains module syntax and will throw when injected";
      if (!text.includes("getFacultyMeetingTimes")) return "b.js does not contain the extractor";
      return true;
    },
  },
  {
    path: "dist/_headers",
    assert: (text) => text.includes("/b.js") || "_headers is missing the b.js cache rule",
  },
];

let failed = false;
for (const { path, assert } of checks) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    console.error(`  MISSING  ${path}`);
    failed = true;
    continue;
  }
  const result = assert(text);
  if (result !== true) {
    console.error(`  INVALID  ${path}: ${result}`);
    failed = true;
    continue;
  }
  console.log(`  ok       ${path} (${statSync(path).size} bytes)`);
}

if (failed) {
  console.error("\nBuild output is incomplete. Refusing to deploy.");
  process.exit(1);
}
console.log("\nBuild output verified.");
