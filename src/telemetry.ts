import { BUILD_ID } from "./build";

const OPT_OUT_KEY = "calens-opt-out";

/**
 * Derived from the URL b.js was actually loaded from, so telemetry follows
 * whichever hostname the loader fell back to instead of guessing.
 * Read at module init, while document.currentScript is still our own tag.
 */
const API_ORIGIN: string = (() => {
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (src) {
    try {
      return new URL(src).origin;
    } catch {
      /* fall through */
    }
  }
  return "https://parse.kigani-systems.com";
})();

export function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    // Storage can throw in locked-down browser configurations. Treat an
    // unreadable preference as opted out: defaulting to not sending is the
    // only safe way to be wrong here.
    return true;
  }
}

export function setOptedOut(value: boolean): void {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* preference simply will not persist */
  }
}

export type Outcome =
  | "ok"
  | "session_expired"
  | "not_banner_page"
  | "no_schedule"
  | "empty_schedule"
  | "banner_unreachable"
  | "unexpected";

export interface EventPayload {
  kind: "success" | "error";
  outcome: Outcome;
  courses?: number;
  skipped?: number;
  failed?: number;
}

/**
 * Fire and forget.
 *
 * Everything sent is either a count or a value from a fixed set. No schedule
 * content, no identifier, no timestamp from the client. Sent as text/plain so
 * the request is CORS-simple and never triggers a preflight.
 */
export function track(payload: EventPayload): void {
  if (isOptedOut()) return;
  try {
    void fetch(`${API_ORIGIN}/api/event`, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ ...payload, build: BUILD_ID, school: location.hostname }),
      keepalive: true,
      mode: "cors",
      credentials: "omit",
    }).catch(() => {});
  } catch {
    /* never surfaces to the student */
  }
}

export async function subscribe(email: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_ORIGIN}/api/subscribe`, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ email, school: location.hostname }),
      mode: "cors",
      credentials: "omit",
    });
    return response.ok;
  } catch {
    return false;
  }
}
