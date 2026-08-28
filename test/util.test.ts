import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  escapeText,
  foldLine,
  newYorkOffsetMinutes,
  parseBannerDate,
  parseBannerTime,
  untilStamp,
} from "../src/util";

describe("decodeEntities", () => {
  it("decodes the numeric apostrophe Banner sends in faculty names", () => {
    expect(decodeEntities("O&#39;Hara, Keith")).toBe("O'Hara, Keith");
  });

  it("decodes named and hex entities", () => {
    expect(decodeEntities("Math &amp; Stat")).toBe("Math & Stat");
    expect(decodeEntities("O&#x27;Hara")).toBe("O'Hara");
  });

  it("does not double-decode", () => {
    // Two passes (named then numeric) would wrongly yield "'" here.
    expect(decodeEntities("&amp;#39;")).toBe("&#39;");
  });

  it("leaves unknown entities untouched rather than mangling them", () => {
    expect(decodeEntities("100&percnt; &notreal;")).toBe("100&percnt; &notreal;");
  });
});

describe("parseBannerDate", () => {
  it("parses MM/DD/YYYY as a timezone-independent calendar date", () => {
    const d = parseBannerDate("08/31/2026");
    expect([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]).toEqual([2026, 8, 31]);
    expect(d.getUTCDay()).toBe(1); // Monday
  });

  it("rejects anything that is not a Banner date", () => {
    expect(() => parseBannerDate("2026-08-31")).toThrow();
    expect(() => parseBannerDate("13/01/2026")).toThrow();
  });
});

describe("parseBannerTime", () => {
  it("parses zero-padded HHMM", () => {
    expect(parseBannerTime("0930")).toEqual({ hour: 9, minute: 30 });
    expect(parseBannerTime("1600")).toEqual({ hour: 16, minute: 0 });
  });

  it("rejects malformed times", () => {
    expect(() => parseBannerTime("930")).toThrow();
    expect(() => parseBannerTime("2570")).toThrow();
  });
});

describe("newYorkOffsetMinutes", () => {
  // Fall 2026 runs 08/31 to 12/19 and therefore crosses the 2026-11-01
  // transition. Getting this wrong shifts every December class by an hour.
  it("returns EDT during the first half of the term", () => {
    expect(newYorkOffsetMinutes(parseBannerDate("08/31/2026"))).toBe(-240);
    expect(newYorkOffsetMinutes(parseBannerDate("10/31/2026"))).toBe(-240);
  });

  it("returns EST from the November transition onward", () => {
    expect(newYorkOffsetMinutes(parseBannerDate("11/01/2026"))).toBe(-300);
    expect(newYorkOffsetMinutes(parseBannerDate("12/19/2026"))).toBe(-300);
  });

  it("switches on the second Sunday of March", () => {
    expect(newYorkOffsetMinutes(parseBannerDate("03/07/2026"))).toBe(-300);
    expect(newYorkOffsetMinutes(parseBannerDate("03/08/2026"))).toBe(-240);
  });
});

describe("untilStamp", () => {
  it("converts the final local day to a UTC instant, as RFC 5545 requires", () => {
    // 2026-12-19 23:59:59 EST (UTC-5) is 2026-12-20 04:59:59 UTC.
    expect(untilStamp(parseBannerDate("12/19/2026"))).toBe("20261220T045959Z");
  });

  it("uses the summer offset when the term ends during EDT", () => {
    expect(untilStamp(parseBannerDate("05/08/2026"))).toBe("20260509T035959Z");
  });
});

describe("escapeText", () => {
  it("escapes the RFC 5545 special characters and only those", () => {
    expect(escapeText("a;b,c\\d")).toBe("a\\;b\\,c\\\\d");
    expect(escapeText("line1\nline2")).toBe("line1\\nline2");
    expect(escapeText("Time: 9:30")).toBe("Time: 9:30");
  });

  it("escapes backslashes before other characters", () => {
    expect(escapeText("\\;")).toBe("\\\\\\;");
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:ENGR 041")).toBe("SUMMARY:ENGR 041");
  });

  it("folds to 75 octets with space-prefixed continuations", () => {
    const folded = foldLine("DESCRIPTION:" + "x".repeat(300));
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const [i, line] of lines.entries()) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(line.startsWith(" ")).toBe(true);
    }
    expect(lines.join("").replace(/^ | /g, "")).toContain("x".repeat(50));
  });

  it("counts UTF-8 octets rather than characters", () => {
    const folded = foldLine("SUMMARY:" + "é".repeat(60));
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
