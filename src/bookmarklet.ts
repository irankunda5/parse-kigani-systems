import { CalensError, apiBaseFrom, extract } from "./extract";
import { openOverlay } from "./overlay";
import { type Outcome, track } from "./telemetry";

// Entry point for b.js, which the loader bookmarklet injects into the Banner
// page. It runs on load, so it must be self-contained and must never throw
// past this boundary — an uncaught error here shows the student nothing.

declare global {
  interface Window {
    __calensRunning?: boolean;
  }
}

/**
 * Maps an error onto a fixed vocabulary. Error messages are never transmitted:
 * they can contain arbitrary text from the browser or the page, and a free-text
 * field is how a "no personal data" promise quietly stops being true.
 */
function categorise(error: unknown): Outcome {
  if (!(error instanceof CalensError)) return "unexpected";
  const message = error.message.toLowerCase();
  if (message.includes("session")) return "session_expired";
  if (message.includes("banner registration page")) return "not_banner_page";
  if (message.includes("no schedule")) return "no_schedule";
  if (message.includes("empty")) return "empty_schedule";
  if (message.includes("could not load any")) return "banner_unreachable";
  return "unexpected";
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
    track({
      kind: "success",
      outcome: "ok",
      courses: result.meetings.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
    });
  } catch (error) {
    track({ kind: "error", outcome: categorise(error) });
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
