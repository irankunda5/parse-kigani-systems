// Shapes observed on Swarthmore's Banner 9 instance
// (studentregistration.swarthmore.edu, Ellucian StudentRegistrationSsb).
// Verified against live data 2026-08-27; see test/fixtures.ts.

/**
 * One entry from `sessionStorage.classScheduleEvents`.
 *
 * WARNING: `start` and `end` are NOT schedule data. The schedule grid projects
 * each meeting pattern onto whatever week is currently being displayed, so the
 * dates are simply "this week" and are wrong for any other week of the term.
 * Only the time-of-day and the weekday are meaningful, and even those we prefer
 * to take from the meeting-times API. This object is used solely as the source
 * of the CRN list and the human-readable course title.
 */
export interface ScheduleEvent {
  id: number;
  title: string;
  start: string;
  end: string;
  editable: boolean;
  allDay: boolean;
  className: string;
  term: string;
  crn: string;
  subject: string;
  courseNumber: string;
}

/** `fmt[].meetingTime` from getFacultyMeetingTimes. Authoritative. */
export interface BannerMeetingTime {
  beginTime: string | null; // "0930" — HHMM, local wall clock, zero padded
  endTime: string | null; // "1020"
  startDate: string; // "08/31/2026" — MM/DD/YYYY
  endDate: string; // "12/19/2026"
  building: string | null; // "SINGER" — short code
  buildingDescription: string | null; // "Singer Hall"
  room: string | null; // "221", but also "036A" and "CHANGHOU" — opaque string
  campusDescription: string | null;
  meetingType: string | null;
  meetingTypeDescription: string | null;
  meetingScheduleType: string | null;
  creditHourSession: number | null;
  hoursWeek: number | null;
  courseReferenceNumber: string;
  term: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

export interface BannerFaculty {
  displayName: string; // may contain HTML entities: "O&#39;Hara, Keith"
  emailAddress: string | null;
  primaryIndicator: boolean;
  bannerId: string;
}

export interface BannerFmtEntry {
  courseReferenceNumber: string;
  faculty: BannerFaculty[];
  meetingTime: BannerMeetingTime;
}

export interface BannerFmtResponse {
  fmt: BannerFmtEntry[];
}

/**
 * A single weekly meeting pattern, normalised from both sources.
 * One CRN can produce more than one of these (e.g. a lecture and a
 * separately-scheduled recitation under the same registration).
 */
export interface Meeting {
  crn: string;
  term: string;
  title: string; // "Thermofluid Mechanics" — entities already decoded
  subject: string; // "ENGR"
  courseNumber: string; // "041"
  /** JS getDay() values: 0=Sun … 6=Sat. Empty means no weekly pattern. */
  days: number[];
  beginTime: string; // "0930"
  endTime: string; // "1020"
  startDate: Date; // local midnight, calendar-date semantics only
  endDate: Date;
  location: string | null; // "Singer Hall 221"
  instructors: string[]; // decoded display names
  meetingTypeDescription: string | null;
}

/** A CRN that produced no usable meeting pattern, surfaced to the user. */
export interface SkippedCourse {
  crn: string;
  title: string;
  reason: string;
}

export interface ExtractResult {
  termCode: string;
  meetings: Meeting[];
  skipped: SkippedCourse[];
}
