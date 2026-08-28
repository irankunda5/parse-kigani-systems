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
  meeting: BannerMeetingTime,
  faculty: string[],
): Meeting | { skip: string } {
  const days = DAY_FIELDS.map((field, index) => (meeting[field] ? index : -1)).filter((i) => i >= 0);
  if (days.length === 0) return { skip: "no weekly meeting pattern (online or arranged)" };
  if (!meeting.beginTime || !meeting.endTime) return { skip: "no meeting time listed" };

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
}

export async function extract(deps: ExtractDeps): Promise<ExtractResult> {
  const identities = courseIdentities(readScheduleEvents(deps.storage));
  const meetings: Meeting[] = [];
  const skipped: SkippedCourse[] = [];

  // Sequential on purpose. Eight requests at ~80ms is under a second, and a
  // burst of parallel authenticated requests against a university SSO-fronted
  // app is not worth the saved fraction of a second.
  let done = 0;
  for (const identity of identities) {
    const url =
      `${deps.apiBase}/searchResults/getFacultyMeetingTimes` +
      `?term=${encodeURIComponent(identity.term)}` +
      `&courseReferenceNumber=${encodeURIComponent(identity.crn)}`;

    const response = await deps.fetchImpl(url, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const body = await response.text();
    assertJson(response, body);

    let payload: BannerFmtResponse;
    try {
      payload = JSON.parse(body) as BannerFmtResponse;
    } catch {
      throw new CalensError(
        `Could not read meeting times for CRN ${identity.crn}.`,
        "Reload the page and try again.",
      );
    }

    const entries = payload.fmt ?? [];
    if (entries.length === 0) {
      skipped.push({ crn: identity.crn, title: identity.title, reason: "no meeting times published" });
    }

    for (const entry of entries) {
      const faculty = (entry.faculty ?? []).map((f) => f.displayName).filter(Boolean);
      const result = normaliseMeeting(identity, entry.meetingTime, faculty);
      if ("skip" in result) {
        skipped.push({ crn: identity.crn, title: identity.title, reason: result.skip });
      } else {
        meetings.push(result);
      }
    }

    deps.onProgress?.(++done, identities.length);
  }

  return {
    termCode: identities[0]?.term ?? "",
    meetings,
    skipped,
  };
}
