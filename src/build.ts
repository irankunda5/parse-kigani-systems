// Replaced at build time by vite.b.config.ts. Falls back for tests and dev,
// where no define is applied.
declare const __BUILD_ID__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
