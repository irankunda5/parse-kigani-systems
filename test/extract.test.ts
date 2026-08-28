import { describe, expect, it } from "vitest";
import { CalensError, apiBaseFrom, courseIdentities, extract, readScheduleEvents } from "../src/extract";
import type { ScheduleEvent } from "../src/types";
import {
  ORIGIN,
  PATHNAME,
  SESSION_STORAGE_RAW,
  fakeFetch,
  fakeStorage,
  jsonResponse,
  loginRedirectResponse,
} from "./fixtures";

const API_BASE = `${ORIGIN}/StudentRegistrationSsb/ssb`;

describe("apiBaseFrom", () => {
  it("derives the API root from the current page rather than hardcoding a school", () => {
    expect(apiBaseFrom(ORIGIN, PATHNAME)).toBe(API_BASE);
  });

  it("handles the bare /ssb path", () => {
    expect(apiBaseFrom(ORIGIN, "/StudentRegistrationSsb/ssb")).toBe(API_BASE);
  });

  it("explains itself when run on the wrong page", () => {
    expect(() => apiBaseFrom(ORIGIN, "/some/other/page")).toThrow(CalensError);
    expect(() => apiBaseFrom(ORIGIN, "/some/other/page")).toThrow(/Banner registration page/);
  });
});

describe("readScheduleEvents", () => {
  it("reads the schedule out of sessionStorage", () => {
    expect(readScheduleEvents(fakeStorage())).toHaveLength(14);
  });

  it("gives an actionable message when the key is absent", () => {
    expect(() => readScheduleEvents({ getItem: () => null })).toThrow(/No schedule found/);
  });

  it("gives an actionable message when the schedule is empty", () => {
    expect(() => readScheduleEvents(fakeStorage("[]"))).toThrow(/empty/);
  });

  it("does not crash on corrupt JSON", () => {
    expect(() => readScheduleEvents(fakeStorage("{not json"))).toThrow(/unreadable/);
  });
});

describe("courseIdentities", () => {
  it("collapses the per-day grid entries into one identity per CRN", () => {
    // 14 rendered entries, 8 distinct registrations.
    const identities = courseIdentities(JSON.parse(SESSION_STORAGE_RAW) as ScheduleEvent[]);
    expect(identities).toHaveLength(8);
    expect(identities.map((i) => i.crn)).toEqual([
      "10098", "10128", "15870", "19687", "30349", "30363", "30590", "30591",
    ]);
  });

  it("keeps the title, which the meeting-times API does not return", () => {
    const identities = courseIdentities(JSON.parse(SESSION_STORAGE_RAW) as ScheduleEvent[]);
    expect(identities[0]!.title).toBe("Thermofluid Mechanics");
  });
});

describe("extract", () => {
  it("produces one meeting per section with room and instructor attached", async () => {
    const result = await extract({ storage: fakeStorage(), apiBase: API_BASE, fetchImpl: fakeFetch() });

    expect(result.termCode).toBe("202604");
    expect(result.meetings).toHaveLength(8);
    expect(result.skipped).toHaveLength(0);

    const thermo = result.meetings.find((m) => m.crn === "10098")!;
    expect(thermo.days).toEqual([1, 3, 5]);
    expect(thermo.location).toBe("Singer Hall 221");
    expect(thermo.instructors).toEqual(["Loh, Kristine"]);
    expect(thermo.beginTime).toBe("0930");
  });

  it("decodes entities in instructor names during extraction", async () => {
    const result = await extract({ storage: fakeStorage(), apiBase: API_BASE, fetchImpl: fakeFetch() });
    const games = result.meetings.find((m) => m.crn === "30590")!;
    expect(games.instructors).toEqual(["O'Hara, Keith"]);
  });

  it("reports progress so the UI can show it", async () => {
    const seen: number[] = [];
    await extract({
      storage: fakeStorage(),
      apiBase: API_BASE,
      fetchImpl: fakeFetch(),
      onProgress: (done, total) => {
        expect(total).toBe(8);
        seen.push(done);
      },
    });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  /**
   * Swarthmore sits behind CAS. An expired session yields 200 + an HTML login
   * page, not a 401, so response.json() would throw "Unexpected token '<'" and
   * the student would see nothing they could act on.
   */
  it("recognises an expired SSO session instead of failing to parse HTML", async () => {
    const promise = extract({
      storage: fakeStorage(),
      apiBase: API_BASE,
      fetchImpl: fakeFetch({ "10098": loginRedirectResponse() }),
    });
    await expect(promise).rejects.toThrow(CalensError);
    await expect(promise).rejects.toThrow(/session has expired/);
  });

  it("skips a course with no published meeting times rather than aborting", async () => {
    const result = await extract({
      storage: fakeStorage(),
      apiBase: API_BASE,
      fetchImpl: fakeFetch({ "15870": jsonResponse({ fmt: [] }) }),
    });
    expect(result.meetings).toHaveLength(7);
    expect(result.skipped).toEqual([
      { crn: "15870", title: "Introduction to Economics", reason: "no meeting times published" },
    ]);
  });

  it("skips an asynchronous section that has no weekly pattern", async () => {
    const async = {
      fmt: [
        {
          courseReferenceNumber: "15870",
          faculty: [],
          meetingTime: {
            beginTime: null, endTime: null,
            startDate: "08/31/2026", endDate: "12/19/2026",
            building: null, buildingDescription: null, room: null,
            campusDescription: null, meetingType: "ONL", meetingTypeDescription: "Online",
            meetingScheduleType: null, creditHourSession: null, hoursWeek: null,
            courseReferenceNumber: "15870", term: "202604",
            monday: false, tuesday: false, wednesday: false, thursday: false,
            friday: false, saturday: false, sunday: false,
          },
        },
      ],
    };
    const result = await extract({
      storage: fakeStorage(),
      apiBase: API_BASE,
      fetchImpl: fakeFetch({ "15870": jsonResponse(async) }),
    });
    expect(result.meetings).toHaveLength(7);
    expect(result.skipped[0]!.reason).toMatch(/no weekly meeting pattern/);
  });
});

describe("resilience", () => {
  const deps = (fetchImpl: typeof fetch, extra = {}) => ({
    storage: fakeStorage(),
    apiBase: API_BASE,
    fetchImpl,
    sleep: async () => {},
    ...extra,
  });

  /**
   * A single flaky request must not cost the student their whole schedule.
   * Before this, one transient failure among eight courses aborted everything.
   */
  it("isolates a failing course and still returns the rest", async () => {
    const result = await extract(
      deps(fakeFetch({ "15870": new Response("boom", { status: 500, headers: { "content-type": "application/json" } }) })),
    );
    expect(result.meetings).toHaveLength(7);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.crn).toBe("15870");
  });

  it("retries a transient failure and succeeds", async () => {
    let calls = 0;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const crn = new URL(String(input)).searchParams.get("courseReferenceNumber");
      if (crn === "10098" && ++calls < 3) throw new TypeError("NetworkError");
      return fakeFetch()(input, init);
    }) as typeof fetch;

    const result = await extract(deps(flaky));
    expect(calls).toBe(3);
    expect(result.meetings).toHaveLength(8);
    expect(result.failed).toHaveLength(0);
  });

  it("does not retry an expired session", async () => {
    let calls = 0;
    const expired = (async () => {
      calls++;
      return loginRedirectResponse();
    }) as typeof fetch;

    await expect(extract(deps(expired))).rejects.toThrow(/session has expired/);
    // One attempt, not three: retrying a dead session only delays the message.
    expect(calls).toBe(1);
  });

  it("aborts a request that exceeds the time budget", async () => {
    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;

    await expect(extract(deps(hang, { timeoutMs: 10, attempts: 1 }))).rejects.toThrow(
      /Could not load any of your courses/,
    );
  });

  it("fails loudly when every course fails rather than downloading an empty file", async () => {
    const dead = (async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } })) as typeof fetch;
    await expect(extract(deps(dead, { attempts: 1 }))).rejects.toThrow(/Could not load any of your courses/);
  });

  it("survives an fmt entry with no meetingTime object", async () => {
    const malformed = { fmt: [{ courseReferenceNumber: "15870", faculty: [] }] };
    const result = await extract(deps(fakeFetch({ "15870": jsonResponse(malformed) })));
    expect(result.meetings).toHaveLength(7);
    expect(result.skipped[0]!.reason).toMatch(/no meeting information/);
    expect(result.failed).toHaveLength(0);
  });
});
