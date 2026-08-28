import { beforeAll, describe, expect, it } from "vitest";
import { buildCalendar, buildEvent, firstOccurrence } from "../src/ics";
import { extract } from "../src/extract";
import { parseBannerDate } from "../src/util";
import type { Meeting } from "../src/types";
import { ORIGIN, fakeFetch, fakeStorage } from "./fixtures";

const NOW = new Date("2026-08-27T18:00:00Z");
const API_BASE = `${ORIGIN}/StudentRegistrationSsb/ssb`;

let meetings: Meeting[];
let ics: string;

beforeAll(async () => {
  const result = await extract({
    storage: fakeStorage(),
    apiBase: API_BASE,
    fetchImpl: fakeFetch(),
  });
  meetings = result.meetings;
  ics = buildCalendar(meetings, { now: NOW, calendarName: "Fall 2026" });
});

const byCrn = (crn: string) => meetings.find((m) => m.crn === crn)!;

function eventBlock(crn: string): string {
  const block = ics
    .split("BEGIN:VEVENT")
    .slice(1)
    .find((b) => b.includes(`UID:202604-${crn}-`));
  if (!block) throw new Error(`no VEVENT for CRN ${crn}`);
  return block;
}

describe("firstOccurrence", () => {
  it("advances to the first weekday that the section actually meets", () => {
    // Banner reports startDate 08/31 (a Monday) even for a Thursday-only lab.
    const first = firstOccurrence(parseBannerDate("08/31/2026"), [4]);
    expect(first?.toISOString().slice(0, 10)).toBe("2026-09-03");
  });

  it("keeps the start date when it already matches", () => {
    const first = firstOccurrence(parseBannerDate("08/31/2026"), [1, 3, 5]);
    expect(first?.toISOString().slice(0, 10)).toBe("2026-08-31");
  });

  it("returns null when there is no weekly pattern", () => {
    expect(firstOccurrence(parseBannerDate("08/31/2026"), [])).toBeNull();
  });
});

describe("calendar dates", () => {
  it("anchors a MWF lecture to the real first day of classes", () => {
    const block = eventBlock("10098");
    expect(block).toContain("DTSTART;TZID=America/New_York:20260831T093000");
    expect(block).toContain("DTEND;TZID=America/New_York:20260831T102000");
    expect(block).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261220T045959Z");
  });

  it("anchors a Thursday-only lab to its first Thursday, not to startDate", () => {
    const block = eventBlock("30349");
    expect(block).toContain("DTSTART;TZID=America/New_York:20260903T131500");
    expect(block).toContain("BYDAY=TH");
  });

  /**
   * Regression guard for the bug that would have shipped.
   *
   * sessionStorage.classScheduleEvents reports 2026-08-24 … 2026-08-28 because
   * the schedule grid renders the meeting pattern onto whichever week is on
   * screen. Classes actually start 2026-08-31. If any DTSTART ever lands in
   * that week again, every event for every user is off by exactly seven days.
   */
  it("never emits an event during the week the schedule grid was displaying", () => {
    const starts = [...ics.matchAll(/DTSTART;TZID=[^:]+:(\d{8})/g)].map((m) => m[1]!);
    expect(starts.length).toBeGreaterThan(0);
    for (const start of starts) {
      expect(Number(start)).toBeGreaterThanOrEqual(20260831);
    }
  });
});

describe("timezone handling", () => {
  it("ships a VTIMEZONE with both transitions", () => {
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:America/New_York");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
  });

  /**
   * The term crosses 2026-11-01. A UTC DTSTART with a weekly RRULE would move
   * every class after that date by an hour, so local wall-clock plus TZID is
   * the only correct encoding.
   */
  it("never emits a UTC DTSTART", () => {
    for (const line of ics.split("\r\n")) {
      if (line.startsWith("DTSTART") && !line.startsWith("DTSTART:1970")) {
        expect(line).toContain("TZID=America/New_York");
        expect(line.endsWith("Z")).toBe(false);
      }
    }
  });
});

describe("event content", () => {
  it("formats an opaque room code as a location", () => {
    expect(eventBlock("19687")).toContain("LOCATION:Science Center CHANGHOU");
  });

  it("decodes HTML entities in instructor names", () => {
    const block = eventBlock("30590");
    expect(block).toContain("O'Hara");
    expect(block).not.toContain("&#39;");
  });

  it("puts the course code in the summary", () => {
    expect(eventBlock("10098")).toContain("SUMMARY:ENGR 041 Thermofluid Mechanics");
  });

  it("uses stable UIDs so re-importing updates instead of duplicating", () => {
    const again = buildCalendar(meetings, { now: new Date(), calendarName: "Fall 2026" });
    const uids = (text: string) => [...text.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
    expect(uids(again)).toEqual(uids(ics));
  });
});

describe("last class date override", () => {
  it("trims the recurrence when the student shortens the term", () => {
    const trimmed = buildCalendar([byCrn("10098")], {
      now: NOW,
      lastDate: parseBannerDate("12/08/2026"),
    });
    expect(trimmed).toContain("UNTIL=20261209T045959Z");
  });

  it("drops a section entirely if it never meets before the cutoff", () => {
    const lines = buildEvent(byCrn("30349"), { now: NOW, lastDate: parseBannerDate("09/01/2026") });
    expect(lines).toEqual([]);
  });
});

describe("single-meeting sections", () => {
  it("omits RRULE when the section meets exactly once", () => {
    const once: Meeting = {
      ...byCrn("30349"),
      startDate: parseBannerDate("09/03/2026"),
      endDate: parseBannerDate("09/03/2026"),
    };
    const lines = buildEvent(once, { now: NOW });
    expect(lines.some((l) => l.startsWith("RRULE"))).toBe(false);
    expect(lines.some((l) => l.startsWith("DTSTART"))).toBe(true);
  });
});

describe("RFC 5545 conformance", () => {
  it("uses CRLF throughout and terminates with one", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("keeps every line within 75 octets", () => {
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("emits one VEVENT per meeting pattern", () => {
    expect(ics.split("BEGIN:VEVENT").length - 1).toBe(8);
  });
});

describe("split meeting patterns under one CRN", () => {
  /**
   * A course that changes room at the midpoint publishes two fmt entries with
   * identical weekdays and start times but different date ranges. Keying the
   * UID on CRN + time + days alone made them collide, and a calendar client
   * keeping one UID silently discarded half the term.
   */
  const firstHalf: Meeting = {
    ...({} as Meeting),
    crn: "10098", term: "202604", title: "Thermofluid Mechanics",
    subject: "ENGR", courseNumber: "041", days: [1, 3, 5],
    beginTime: "0930", endTime: "1020",
    startDate: parseBannerDate("08/31/2026"), endDate: parseBannerDate("10/16/2026"),
    location: "Singer Hall 221", instructors: ["Loh, Kristine"], meetingTypeDescription: "Class",
  };
  const secondHalf: Meeting = {
    ...firstHalf,
    startDate: parseBannerDate("10/19/2026"), endDate: parseBannerDate("12/19/2026"),
    location: "Kohlberg Hall 226",
  };

  it("gives the two halves distinct UIDs", () => {
    const out = buildCalendar([firstHalf, secondHalf], { now: NOW });
    const uids = [...out.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
    expect(uids).toHaveLength(2);
    expect(new Set(uids).size).toBe(2);
  });

  it("keeps both rooms and both date ranges", () => {
    const out = buildCalendar([firstHalf, secondHalf], { now: NOW });
    expect(out).toContain("LOCATION:Singer Hall 221");
    expect(out).toContain("LOCATION:Kohlberg Hall 226");
    expect(out).toContain("UNTIL=20261017T035959Z");
    expect(out).toContain("UNTIL=20261220T045959Z");
  });
});
