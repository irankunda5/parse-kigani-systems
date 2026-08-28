// Shared primitives. Deliberately dependency-free so the bookmarklet payload
// stays small and so tests run identically in Node and in a browser.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  hellip: "\u2026",
};

/**
 * Banner returns HTML-escaped text in JSON fields: faculty "O&#39;Hara, Keith",
 * course titles with "&amp;". Left alone these land literally in the .ics.
 *
 * Single regex pass on purpose. Decoding named and numeric entities in two
 * passes would turn "&amp;#39;" into an apostrophe, which is wrong.
 */
export function decodeEntities(input: string): string {
  return input.replace(
    /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? match : named;
    },
  );
}

/**
 * Parse Banner's "MM/DD/YYYY" into a Date pinned to UTC midnight.
 *
 * Every Date in this codebase represents a CALENDAR DATE, never an instant.
 * They are built with Date.UTC and read with getUTC* accessors exclusively,
 * so results do not change with the machine's timezone. A student in Tokyo
 * running this on the Banner page must get byte-identical output to CI.
 */
export function parseBannerDate(mdy: string): Date {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mdy.trim());
  if (!m) throw new Error(`Unrecognised Banner date: ${JSON.stringify(mdy)}`);
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Out-of-range Banner date: ${mdy}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/** "0930" -> { hour: 9, minute: 30 } */
export function parseBannerTime(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{2})(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Unrecognised Banner time: ${JSON.stringify(hhmm)}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`Out-of-range Banner time: ${hhmm}`);
  return { hour, minute };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

/** Day-of-week for a calendar date. 0=Sun … 6=Sat. Timezone independent. */
export function dayOfWeek(date: Date): number {
  return date.getUTCDay();
}

/** Date of the nth (1-based) given weekday in a month. */
function nthWeekdayOfMonth(year: number, month1: number, weekday: number, nth: number): number {
  const firstDow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  return 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
}

/**
 * Offset of America/New_York for a given calendar date, in minutes.
 * -240 during EDT, -300 during EST.
 *
 * These rules are duplicated in the VTIMEZONE block we emit, and the two must
 * agree. US rules since 2007: DST starts 2nd Sunday of March at 02:00 local,
 * ends 1st Sunday of November at 02:00 local.
 *
 * Resolution is whole days. On a transition day the switch happens at 02:00,
 * which is earlier than any plausible class, so treating the entire day as the
 * post-transition offset is correct for this application.
 */
export function newYorkOffsetMinutes(date: Date): number {
  const year = date.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, nthWeekdayOfMonth(year, 3, 0, 2));
  const dstEnd = Date.UTC(year, 10, nthWeekdayOfMonth(year, 11, 0, 1));
  const t = date.getTime();
  return t >= dstStart && t < dstEnd ? -240 : -300;
}

/** Local wall-clock stamp for DTSTART;TZID=... -> "20260831T093000" */
export function formatLocalStamp(date: Date, hour: number, minute: number): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(hour)}${pad2(minute)}00`
  );
}

/** UTC stamp for UNTIL and DTSTAMP -> "20261220T045959Z" */
export function formatUtcStamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/**
 * RFC 5545 requires UNTIL to be UTC whenever DTSTART carries a TZID.
 * Emitting a local-looking UNTIL is silently accepted by some clients and
 * rejected by others, so convert properly: end of the final day, New York
 * local, expressed as UTC.
 */
export function untilStamp(lastDate: Date): string {
  const localEndOfDay = Date.UTC(
    lastDate.getUTCFullYear(),
    lastDate.getUTCMonth(),
    lastDate.getUTCDate(),
    23,
    59,
    59,
  );
  return formatUtcStamp(localEndOfDay - newYorkOffsetMinutes(lastDate) * 60000);
}

/** Escape an RFC 5545 TEXT value. Colons are not escaped in values. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold to 75 octets per RFC 5545. The limit counts UTF-8 bytes, not
 * characters, and continuation lines include their leading space in the count.
 * Iterating with for..of walks code points so astral characters are not split
 * across a fold boundary.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 75) {
      parts.push(current);
      current = " ";
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}
