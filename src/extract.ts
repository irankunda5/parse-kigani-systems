import type {
  BannerFmtResponse,
  BannerMeetingTime,
  ExtractResult,
  Meeting,
  ScheduleEvent,
  SkippedCourse,
} from "./types";
import { decodeEntities, parseBannerDate } from "./util";

export const STORAGE_KEY = "classScheduleEvents";

/** Index matches JS getDay(): 0=Sun … 6=Sat. */
const DAY_FIELDS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export class CalensError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "CalensError";
  }
}

/**
 * Swarthmore fronts Banner with CAS/Shibboleth SSO. When the session lapses,
 * the API answers 200 with an HTML login page rather than an error status, so
 * a naive response.json() throws "Unexpected token '<'" and the user is told
 * nothing useful. Every response is content-type checked for this reason.
 */
function assertJson(response: Response, body: string): void {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    if (/login|cas|shibboleth|<html/i.test(body.slice(0, 500))) {
      throw new CalensError(
        "Your Banner session has expired.",
        "Reload this page, sign in again, and click the bookmark once more.",
      );
    }
    throw new CalensError(
      `Banner returned ${type || "an unknown format"} instead of JSON.`,
      "Make sure you are on the schedule page and signed in.",
    );
  }
}

/**
 * Derived from the current URL rather than hardcoded, so the same payload works
 * on any Banner 9 instance without a per-school build.
 * /StudentRegistrationSsb/ssb/registrationHistory/... -> /StudentRegistrationSsb/ssb
 */
export function apiBaseFrom(origin: string, pathname: string): string {
  const match = /^(.*\/ssb)(\/|$)/.exec(pathname);
  if (!match) {
    throw new CalensError(
      "This does not look like a Banner registration page.",
      "Open your class schedule in Banner, then click the bookmark from that tab.",
    );
  }
  return origin + match[1];
}

export function readScheduleEvents(storage: Pick<Storage, "getItem">): ScheduleEvent[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    throw new CalensError(
      "No schedule found on this page.",
      "Open the schedule view in Banner so the timetable is visible, then click the bookmark.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CalensError("The schedule data on this page is unreadable.", "Reload the page and try again.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new CalensError(
      "Your schedule appears to be empty.",
      "If you are registered for classes, reload the schedule page and try again.",
    );
  }
  return parsed as ScheduleEvent[];
}

interface CourseIdentity {
  crn: string;
  term: string;
  title: string;
  subject: string;
  courseNumber: string;
}

/**
 * The grid emits one entry per rendered day, so a MWF course appears three
 * times. Collapse to one identity per CRN. Note we take only title/subject/
 * courseNumber from here — the start/end dates in this payload are the
 * currently-displayed week, not the term, and are never used.
 */
export function courseIdentities(events: ScheduleEvent[]): CourseIdentity[] {
  const byCrn = new Map<string, CourseIdentity>();
  for (const event of events) {
    if (!event?.crn || byCrn.has(event.crn)) continue;
    byCrn.set(event.crn, {
      crn: event.crn,
      term: event.term,
      title: decodeEntities(event.title ?? "").trim(),
      subject: (event.subject ?? "").trim(),
      courseNumber: (event.courseNumber ?? "").trim(),
    });
  }
  return [...byCrn.values()];
}

function locationOf(meeting: BannerMeetingTime): string | null {
  const building = decodeEntities(meeting.buildingDescription ?? meeting.building ?? "").trim();
  // Room codes are opaque strings, not numbers: "221", "036A", "CHANGHOU".
  const room = decodeEntities(meeting.room ?? "").trim();
  const parts = [building, room].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function normaliseMeeting(
  identity: CourseIdentity,
  meeting: BannerMeetingTime | null | undefined,
  faculty: string[],
): Meeting | { skip: string } {
  // Banner has been observed to return an fmt entry with no meetingTime at all.
  // Indexing into it directly throws a TypeError that escapes as "Something
  // went wrong", so treat a missing object as a skip like any other.
  if (!meeting) return { skip: "no meeting information published" };

  const days = DAY_FIELDS.map((field, index) => (meeting[field] ? index : -1)).filter((i) => i >= 0);
  if (days.length === 0) return { skip: "no weekly meeting pattern (online or arranged)" };
  if (!meeting.beginTime || !meeting.endTime) return { skip: "no meeting time listed" };
  if (!meeting.startDate || !meeting.endDate) return { skip: "no term dates listed" };

  return {
    crn: identity.crn,
    term: identity.term,
    title: identity.title,
    subject: identity.subject,
    courseNumber: identity.courseNumber,
    days,
    beginTime: meeting.beginTime,
    endTime: meeting.endTime,
    startDate: parseBannerDate(meeting.startDate),
    endDate: parseBannerDate(meeting.endDate),
    location: locationOf(meeting),
    instructors: faculty.map((name) => decodeEntities(name).trim()).filter(Boolean),
    meetingTypeDescription: meeting.meetingTypeDescription
      ? decodeEntities(meeting.meetingTypeDescription).trim()
      : null,
  };
}

export interface ExtractDeps {
  storage: Pick<Storage, "getItem">;
  apiBase: string;
  fetchImpl: typeof fetch;
  onProgress?: (done: number, total: number) => void;
  /** Per-request budget. Banner occasionally stalls rather than erroring. */
  timeoutMs?: number;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_ATTEMPTS = 3;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One request, with a hard time budget.
 *
 * Without this a stalled connection leaves the panel showing "Looking up
 * meeting times… 3/8" forever, which is indistinguishable from a hung browser
 * and gives the student nothing to act on.
 */
async function fetchOnce(deps: ExtractDeps, url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await deps.fetchImpl(url, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      signal: controller.signal,
    });
    const body = await response.text();
    // Checked before the status code: an expired CAS session answers 200 with
    // an HTML login page, so status alone would look like success.
    assertJson(response, body);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retries transient faults only. An expired session is not transient — retrying
 * it three times just delays a message the student needs immediately.
 */
async function fetchWithRetry(deps: ExtractDeps, url: string): Promise<string> {
  const attempts = deps.attempts ?? DEFAULT_ATTEMPTS;
  const sleep = deps.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchOnce(deps, url);
    } catch (error) {
      if (error instanceof CalensError) throw error;
      lastError = error;
      if (attempt < attempts) await sleep(250 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function extract(deps: ExtractDeps): Promise<ExtractResult> {
  const identities = courseIdentities(readScheduleEvents(deps.storage));
  const meetings: Meeting[] = [];
  const skipped: SkippedCourse[] = [];
  const failed: SkippedCourse[] = [];

  // Sequential on purpose. Eight requests at ~80ms is under a second, and a
  // burst of parallel authenticated requests against a university SSO-fronted
  // app is not worth the saved fraction of a second.
  let done = 0;
  for (const identity of identities) {
    const url =
      `${deps.apiBase}/searchResults/getFacultyMeetingTimes` +
      `?term=${encodeURIComponent(identity.term)}` +
      `&courseReferenceNumber=${encodeURIComponent(identity.crn)}`;

    try {
      const body = await fetchWithRetry(deps, url);

      let payload: BannerFmtResponse;
      try {
        payload = JSON.parse(body) as BannerFmtResponse;
      } catch {
        throw new Error("response was not valid JSON");
      }

      const entries = payload.fmt ?? [];
      if (entries.length === 0) {
        skipped.push({ crn: identity.crn, title: identity.title, reason: "no meeting times published" });
      }

      for (const entry of entries) {
        const faculty = (entry?.faculty ?? []).map((f) => f?.displayName).filter(Boolean) as string[];
        const result = normaliseMeeting(identity, entry?.meetingTime, faculty);
        if ("skip" in result) {
          skipped.push({ crn: identity.crn, title: identity.title, reason: result.skip });
        } else {
          meetings.push(result);
        }
      }
    } catch (error) {
      // A dead session kills every subsequent request too, so surface it now
      // rather than grinding through the remaining courses to say the same
      // thing eight times.
      if (error instanceof CalensError) throw error;

      // Anything else is isolated to this course. Seven correct classes plus a
      // visible warning about the eighth beats failing the whole download.
      failed.push({
        crn: identity.crn,
        title: identity.title,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    deps.onProgress?.(++done, identities.length);
  }

  if (meetings.length === 0 && failed.length > 0) {
    throw new CalensError(
      "Could not load any of your courses from Banner.",
      "Reload the page and try again. If it keeps happening, Banner may be down.",
    );
  }

  return {
    termCode: identities[0]?.term ?? "",
    meetings,
    skipped,
    failed,
  };
}
