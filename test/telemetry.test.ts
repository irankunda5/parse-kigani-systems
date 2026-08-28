import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These assert the promises made on /privacy.html. If one fails, the site is
 * making a claim the code does not honour, which matters more than a bug.
 */

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("document", { currentScript: { src: "https://parse.kigani-systems.com/b.js?123" } });
vi.stubGlobal("location", { hostname: "studentregistration.swarthmore.edu" });

const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
  sent.push({ url, body: JSON.parse(String(init.body)) });
  return Promise.resolve(new Response("{}", { status: 200 }));
});

const { track, isOptedOut, setOptedOut } = await import("../src/telemetry");

beforeEach(() => {
  sent.length = 0;
  store.clear();
});

describe("what leaves the browser", () => {
  it("sends only counts and a fixed-vocabulary outcome", () => {
    track({ kind: "success", outcome: "ok", courses: 8, skipped: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]!.body).sort()).toEqual([
      "build", "courses", "failed", "kind", "outcome", "school", "skipped",
    ]);
  });

  it("never includes anything from the schedule", () => {
    track({ kind: "success", outcome: "ok", courses: 8, skipped: 0, failed: 0 });
    const serialised = JSON.stringify(sent[0]!.body);
    for (const forbidden of ["10098", "Thermofluid", "Singer", "O'Hara", "0930", "ENGR"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("carries no identifier that could link two runs together", () => {
    track({ kind: "success", outcome: "ok", courses: 8 });
    track({ kind: "success", outcome: "ok", courses: 8 });
    expect(sent[0]!.body).toEqual(sent[1]!.body);
  });

  it("does not send a client timestamp", () => {
    track({ kind: "error", outcome: "session_expired" });
    expect(sent[0]!.body).not.toHaveProperty("ts");
  });

  it("posts to the origin b.js was loaded from, following the loader fallback", () => {
    track({ kind: "success", outcome: "ok" });
    expect(sent[0]!.url).toBe("https://parse.kigani-systems.com/api/event");
  });
});

describe("opt out", () => {
  it("sends nothing once opted out", () => {
    setOptedOut(true);
    track({ kind: "success", outcome: "ok", courses: 8 });
    expect(sent).toHaveLength(0);
  });

  it("resumes when opted back in", () => {
    setOptedOut(true);
    setOptedOut(false);
    track({ kind: "success", outcome: "ok" });
    expect(sent).toHaveLength(1);
  });

  it("treats unreadable storage as opted out", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(isOptedOut()).toBe(true);
    track({ kind: "success", outcome: "ok" });
    expect(sent).toHaveLength(0);
  });
});
