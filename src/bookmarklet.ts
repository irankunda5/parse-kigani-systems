import { CalensError, apiBaseFrom, extract } from "./extract";
import { openOverlay } from "./overlay";

// Entry point for b.js, which the loader bookmarklet injects into the Banner
// page. It runs on load, so it must be self-contained and must never throw
// past this boundary — an uncaught error here shows the student nothing.

declare global {
  interface Window {
    __calensRunning?: boolean;
  }
}

async function main(): Promise<void> {
  const overlay = openOverlay();
  try {
    const apiBase = apiBaseFrom(location.origin, location.pathname);
    const result = await extract({
      storage: sessionStorage,
      apiBase,
      fetchImpl: fetch.bind(window),
      onProgress: (done, total) => overlay.setStatus(`Looking up meeting times\u2026 ${done}/${total}`),
    });
    overlay.showResult(result);
  } catch (error) {
    if (error instanceof CalensError) {
      overlay.showError(error.message, error.hint);
    } else {
      overlay.showError(
        "Something went wrong reading your schedule.",
        "Click Copy details and send it over, then try again.",
        error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error),
      );
    }
  }
}

// Double-clicking the bookmark should reopen the panel, not run two extractions
// against the registrar's API at once.
if (!window.__calensRunning) {
  window.__calensRunning = true;
  void main().finally(() => {
    window.__calensRunning = false;
  });
}
