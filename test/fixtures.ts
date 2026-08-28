import type { BannerFmtResponse } from "../src/types";

/**
 * Captured live from studentregistration.swarthmore.edu on 2026-08-27.
 *
 * This is the verbatim contents of sessionStorage.classScheduleEvents.
 * Note the dates: 2026-08-24 through 2026-08-28. Classes do not begin until
 * 2026-08-31. These are the week that happened to be on screen, and are the
 * reason this payload is never used as a source of dates.
 */
export const SESSION_STORAGE_RAW = JSON.stringify([
  { id: 1787865150927, title: "Thermofluid Mechanics", start: "2026-08-24T09:30:30-0400", end: "2026-08-24T10:20:30-0400", editable: false, allDay: false, className: "registeredEvent event0", term: "202604", crn: "10098", subject: "ENGR", courseNumber: "041" },
  { id: 1787865150927, title: "Thermofluid Mechanics", start: "2026-08-26T09:30:30-0400", end: "2026-08-26T10:20:30-0400", editable: false, allDay: false, className: "registeredEvent event0", term: "202604", crn: "10098", subject: "ENGR", courseNumber: "041" },
  { id: 1787865150927, title: "Thermofluid Mechanics", start: "2026-08-28T09:30:30-0400", end: "2026-08-28T10:20:30-0400", editable: false, allDay: false, className: "registeredEvent event0", term: "202604", crn: "10098", subject: "ENGR", courseNumber: "041" },
  { id: 1787865150932, title: "Thermofluid Mechan- Lab", start: "2026-08-26T13:15:30-0400", end: "2026-08-26T16:00:30-0400", editable: false, allDay: false, className: "registeredEvent event1", term: "202604", crn: "10128", subject: "ENGR", courseNumber: "041" },
  { id: 1787865150938, title: "Introduction to Economics", start: "2026-08-24T10:30:30-0400", end: "2026-08-24T11:45:30-0400", editable: false, allDay: false, className: "registeredEvent event2", term: "202604", crn: "15870", subject: "ECON", courseNumber: "001" },
  { id: 1787865150938, title: "Introduction to Economics", start: "2026-08-26T10:30:30-0400", end: "2026-08-26T11:45:30-0400", editable: false, allDay: false, className: "registeredEvent event2", term: "202604", crn: "15870", subject: "ECON", courseNumber: "001" },
  { id: 1787865150943, title: "Comp Engr Fndmntls", start: "2026-08-25T08:30:30-0400", end: "2026-08-25T09:45:30-0400", editable: false, allDay: false, className: "registeredEvent event3", term: "202604", crn: "19687", subject: "ENGR", courseNumber: "021" },
  { id: 1787865150943, title: "Comp Engr Fndmntls", start: "2026-08-27T08:30:30-0400", end: "2026-08-27T09:45:30-0400", editable: false, allDay: false, className: "registeredEvent event3", term: "202604", crn: "19687", subject: "ENGR", courseNumber: "021" },
  { id: 1787865150949, title: "Comp Engr Fndmntls-Lab", start: "2026-08-27T13:15:30-0400", end: "2026-08-27T16:00:30-0400", editable: false, allDay: false, className: "registeredEvent event4", term: "202604", crn: "30349", subject: "ENGR", courseNumber: "021" },
  { id: 1787865150954, title: "Experiment for Engr Design", start: "2026-08-25T11:20:30-0400", end: "2026-08-25T12:35:30-0400", editable: false, allDay: false, className: "registeredEvent event5", term: "202604", crn: "30363", subject: "ENGR", courseNumber: "014" },
  { id: 1787865150954, title: "Experiment for Engr Design", start: "2026-08-27T11:20:30-0400", end: "2026-08-27T12:35:30-0400", editable: false, allDay: false, className: "registeredEvent event5", term: "202604", crn: "30363", subject: "ENGR", courseNumber: "014" },
  { id: 1787865150965, title: "Games Systems", start: "2026-08-25T09:55:30-0400", end: "2026-08-25T11:10:30-0400", editable: false, allDay: false, className: "registeredEvent event7", term: "202604", crn: "30590", subject: "ENGR", courseNumber: "024" },
  { id: 1787865150965, title: "Games Systems", start: "2026-08-27T09:55:30-0400", end: "2026-08-27T11:10:30-0400", editable: false, allDay: false, className: "registeredEvent event7", term: "202604", crn: "30590", subject: "ENGR", courseNumber: "024" },
  { id: 1787865150971, title: "Games Systems-Lab", start: "2026-08-24T13:05:30-0400", end: "2026-08-24T14:35:30-0400", editable: false, allDay: false, className: "registeredEvent event0", term: "202604", crn: "30591", subject: "ENGR", courseNumber: "024" },
]);

interface FixtureSpec {
  crn: string;
  days: string; // MTWRFSU, "_" for no meeting
  beginTime: string;
  endTime: string;
  building: string;
  buildingDescription: string;
  room: string;
  faculty: string;
}

/**
 * Transcribed from the live getFacultyMeetingTimes responses.
 *
 * `buildingDescription` was confirmed on the wire only for SINGER ("Singer
 * Hall"); the other three are plausible stand-ins, since no assertion depends
 * on their exact text. Everything else — days, times, dates, room codes and the
 * HTML-entity-encoded faculty names — is exactly as returned.
 */
const SPECS: FixtureSpec[] = [
  { crn: "10098", days: "M_W_F__", beginTime: "0930", endTime: "1020", building: "SINGER", buildingDescription: "Singer Hall", room: "221", faculty: "Loh, Kristine" },
  { crn: "10128", days: "__W____", beginTime: "1315", endTime: "1600", building: "SINGER", buildingDescription: "Singer Hall", room: "036A", faculty: "Loh, Kristine" },
  { crn: "15870", days: "M_W____", beginTime: "1030", endTime: "1145", building: "KOHL", buildingDescription: "Kohlberg Hall", room: "226", faculty: "Bottmer, Lea" },
  { crn: "19687", days: "_T_R___", beginTime: "0830", endTime: "0945", building: "SCI", buildingDescription: "Science Center", room: "CHANGHOU", faculty: "Masroor, Emad" },
  { crn: "30349", days: "___R___", beginTime: "1315", endTime: "1600", building: "SINGER", buildingDescription: "Singer Hall", room: "221", faculty: "Zucker, Matthew" },
  { crn: "30363", days: "_T_R___", beginTime: "1120", endTime: "1235", building: "SINGER", buildingDescription: "Singer Hall", room: "346", faculty: "Piovoso, Michael" },
  { crn: "30590", days: "_T_R___", beginTime: "0955", endTime: "1110", building: "MARTIN", buildingDescription: "Martin Hall", room: "313", faculty: "O&#39;Hara, Keith" },
  { crn: "30591", days: "M______", beginTime: "1305", endTime: "1435", building: "MARTIN", buildingDescription: "Martin Hall", room: "313", faculty: "O&#39;Hara, Keith" },
];

export const TERM_START = "08/31/2026";
export const TERM_END = "12/19/2026";

function toResponse(spec: FixtureSpec): BannerFmtResponse {
  const order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  const flags = {} as Record<(typeof order)[number], boolean>;
  order.forEach((day, i) => {
    flags[day] = spec.days[i] !== "_";
  });
  return {
    fmt: [
      {
        courseReferenceNumber: spec.crn,
        faculty: [
          { displayName: spec.faculty, emailAddress: null, primaryIndicator: true, bannerId: "000000" },
        ],
        meetingTime: {
          beginTime: spec.beginTime,
          endTime: spec.endTime,
          startDate: TERM_START,
          endDate: TERM_END,
          building: spec.building,
          buildingDescription: spec.buildingDescription,
          room: spec.room,
          campusDescription: "Swarthmore College",
          meetingType: "CLAS",
          meetingTypeDescription: "Class",
          meetingScheduleType: "L",
          creditHourSession: 1,
          hoursWeek: 2.5,
          courseReferenceNumber: spec.crn,
          term: "202604",
          ...flags,
        },
      },
    ],
  };
}

export const FMT_BY_CRN: Record<string, BannerFmtResponse> = Object.fromEntries(
  SPECS.map((spec) => [spec.crn, toResponse(spec)]),
);

export const ORIGIN = "https://studentregistration.swarthmore.edu";
export const PATHNAME = "/StudentRegistrationSsb/ssb/registrationHistory/registrationHistory";

export function fakeStorage(raw: string = SESSION_STORAGE_RAW) {
  return { getItem: (key: string) => (key === "classScheduleEvents" ? raw : null) };
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}

/** Stands in for the CAS login page Banner serves once the session lapses. */
export function loginRedirectResponse(): Response {
  return new Response("<!DOCTYPE html><html><head><title>CAS Login</title></head></html>", {
    status: 200,
    headers: { "content-type": "text/html;charset=UTF-8" },
  });
}

export function fakeFetch(overrides: Record<string, Response> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const crn = new URL(url).searchParams.get("courseReferenceNumber") ?? "";
    if (overrides[crn]) return overrides[crn]!.clone();
    const payload = FMT_BY_CRN[crn];
    if (!payload) throw new Error(`fixture missing for CRN ${crn}`);
    return jsonResponse(payload);
  }) as typeof fetch;
}
