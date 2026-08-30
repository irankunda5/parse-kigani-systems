import type { ExtractResult, Meeting } from "./types";
import { buildCalendar } from "./ics";
import { BUILD_ID } from "./build";
import {
  hasGivenEmail,
  isOptedOut,
  setGivenEmail,
  setOptedOut,
  subscribe as subscribeEmail,
} from "./telemetry";

const HOST_ID = "calens-overlay-host";
const DAY_LABEL = ["U", "M", "T", "W", "R", "F", "S"];

/**
 * Everything renders inside a shadow root. Banner ships broad global CSS that
 * would otherwise restyle the panel, and we equally must not leak styles back
 * into the registration page.
 */
const STYLE = `
:host { all: initial; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #0f172a;
}
.panel {
  background: #fff; border-radius: 10px; width: min(760px, 92vw);
  max-height: 88vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 50px rgba(0,0,0,.3);
}
header { display: flex; align-items: baseline; gap: 10px; padding: 18px 22px 12px; border-bottom: 1px solid #e2e8f0; }
h1 { font-size: 17px; font-weight: 650; margin: 0; }
.sub { color: #64748b; font-size: 13px; }
.close { margin-left: auto; background: none; border: 0; font-size: 22px; line-height: 1; cursor: pointer; color: #64748b; padding: 0 4px; }
.body { padding: 16px 22px; overflow: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th { text-align: left; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0; padding: 6px 8px 6px 0; }
td { padding: 7px 8px 7px 0; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
td.days { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 1px; white-space: nowrap; }
td.time { white-space: nowrap; }
.muted { color: #64748b; }
.note { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-top: 14px; font-size: 13px; }
.note strong { font-weight: 600; }
.warn { background: #fffbeb; border-color: #fde68a; }
.err { background: #fef2f2; border-color: #fecaca; }
footer { display: flex; align-items: center; gap: 12px; padding: 14px 22px; border-top: 1px solid #e2e8f0; flex-wrap: wrap; }
label { font-size: 13px; color: #475569; display: flex; align-items: center; gap: 7px; }
input[type=date] { font: inherit; padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 5px; }
button.go {
  background: #a11833; color: #fff; border: 0;
  padding: 9px 18px; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer;
}
button.go:hover { background: #85142a; }
button.go:disabled { background: #94a3b8; cursor: default; }
.gate { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.gate input {
  font: inherit; font-size: 13px; width: 210px;
  padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; color: #0f172a;
}
.gate input.bad { border-color: #dc2626; }
#copy { margin-left: auto; }
.status { padding: 34px 22px; text-align: center; color: #475569; }
.fine {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 11px 22px; border-top: 1px solid #f1f5f9;
  font-size: 12px; color: #94a3b8; background: #fcfcfd;
  border-radius: 0 0 10px 10px;
}
.link {
  background: none; border: 0; padding: 0; font: inherit;
  color: #64748b; text-decoration: underline; cursor: pointer;
}
.fine a { color: #64748b; }
`;

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function formatDays(days: number[]): string {
  return DAY_LABEL.map((label, i) => (days.includes(i) ? label : "\u00b7")).join("");
}

function formatTime(hhmm: string): string {
  const hour = Number(hhmm.slice(0, 2));
  const minute = hhmm.slice(2);
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute}${suffix}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface Overlay {
  setStatus(message: string): void;
  showError(message: string, hint: string, detail?: string): void;
  showResult(result: ExtractResult): void;
  close(): void;
}

/**
 * Assembled only when the student clicks "Copy details", and only into their
 * clipboard. Nothing is transmitted anywhere.
 *
 * With no telemetry there is no other way to learn what broke for someone, and
 * "it didn't work" from a stranger is not actionable. CRNs are public course
 * identifiers, not personal data; no titles, names or times are included.
 */
function diagnostics(message: string, detail: string | undefined): string {
  const lines = [
    `build:    ${BUILD_ID}`,
    `page:     ${location.origin}${location.pathname}`,
    `agent:    ${navigator.userAgent}`,
    `error:    ${message}`,
  ];
  try {
    const raw = sessionStorage.getItem("classScheduleEvents");
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const crns = [...new Set(parsed.map((e: { crn?: string }) => e?.crn).filter(Boolean))];
      lines.push(`entries:  ${parsed.length}`, `crns:     ${crns.join(", ")}`);
    } else {
      lines.push("entries:  none");
    }
  } catch {
    lines.push("entries:  unreadable");
  }
  if (detail) lines.push("", detail);
  return lines.join("\n");
}

export function openOverlay(): Overlay {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  root.append(style);

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  root.append(backdrop);
  document.body.append(host);

  const close = () => host.remove();
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);

  const shell = (inner: string) => {
    backdrop.innerHTML = `<div class="panel">${inner}</div>`;
    backdrop.querySelector<HTMLButtonElement>(".close")?.addEventListener("click", close);
  };

  const header = (sub: string) =>
    `<header><h1>Class schedule</h1><span class="sub">${esc(sub)}</span>
     <button class="close" title="Close">&times;</button></header>`;

  shell(`${header("")}<div class="status">Reading your schedule\u2026</div>`);

  return {
    setStatus(message) {
      const el = backdrop.querySelector(".status");
      if (el) el.textContent = message;
    },

    showError(message, hint, detail) {
      shell(
        `${header("")}<div class="body">
           <div class="note err"><strong>${esc(message)}</strong><br>${esc(hint)}</div>
         </div>
         <footer>
           <span class="sub">${esc(BUILD_ID)}</span>
           <button class="go" id="copy">Copy details</button>
         </footer>`,
      );
      const button = backdrop.querySelector<HTMLButtonElement>("#copy")!;
      button.addEventListener("click", () => {
        void navigator.clipboard.writeText(diagnostics(message, detail)).then(
          () => (button.textContent = "Copied"),
          () => (button.textContent = "Copy failed"),
        );
      });
    },

    showResult(result) {
      const { meetings, skipped, failed } = result;
      if (meetings.length === 0) {
        this.showError(
          "No classes with meeting times were found.",
          "If you are registered, make sure the schedule is visible on this page and try again.",
        );
        return;
      }

      // Banner's endDate is the end of the exam period, not the last day of
      // classes, so the default run is deliberately long. Surfacing it as an
      // editable field lets a student trim it without us having to encode a
      // per-school academic calendar.
      const defaultLast = meetings.reduce(
        (latest, m) => (m.endDate > latest ? m.endDate : latest),
        meetings[0]!.endDate,
      );

      const rows = meetings
        .map(
          (m) => `<tr>
            <td><strong>${esc(m.subject)} ${esc(m.courseNumber)}</strong><br>
                <span class="muted">${esc(m.title)}</span></td>
            <td class="days">${formatDays(m.days)}</td>
            <td class="time">${formatTime(m.beginTime)}\u2013${formatTime(m.endTime)}</td>
            <td>${esc(m.location ?? "\u2014")}</td>
            <td class="muted">${esc(m.instructors.join(", "))}</td>
          </tr>`,
        )
        .join("");

      const skippedNote =
        skipped.length === 0
          ? ""
          : `<div class="note warn"><strong>Not included:</strong> ${skipped
              .map((s) => `${esc(s.title || s.crn)} (${esc(s.reason)})`)
              .join("; ")}</div>`;

      // Deliberately louder than the skipped note. A skipped async course is
      // expected; a failed lookup means a class the student is registered for
      // is missing from the file they are about to trust.
      const failedNote =
        failed.length === 0
          ? ""
          : `<div class="note err"><strong>Could not load ${failed.length}
              ${failed.length === 1 ? "course" : "courses"}:</strong> ${failed
                .map((f) => esc(f.title || f.crn))
                .join(", ")}.
              These are missing from the download. Close this and click the bookmark again to retry.</div>`;

      shell(
        `${header(`${meetings.length} meeting patterns`)}
         <div class="body">
           <table>
             <thead><tr><th>Course</th><th>Days</th><th>Time</th><th>Where</th><th>Instructor</th></tr></thead>
             <tbody>${rows}</tbody>
           </table>
           ${failedNote}
           ${skippedNote}
           <div class="note">
             <strong>Import into a new calendar, not your main one.</strong>
             In Google Calendar create a calendar first, then import into it. That way you can
             delete everything in one step if something looks wrong.
           </div>
         </div>
         <footer>
           <label>Classes end
             <input type="date" id="last" value="${isoDate(defaultLast)}">
           </label>
           <span class="sub">Banner lists the term through ${isoDate(defaultLast)} (end of exams).</span>
           <span class="gate">
             ${
               hasGivenEmail()
                 ? ""
                 : `<input type="email" id="email" placeholder="you@swarthmore.edu"
                           autocomplete="email" spellcheck="false">`
             }
             <button class="go" id="dl">${hasGivenEmail() ? "Download .ics" : "Get my calendar"}</button>
           </span>
         </footer>
         <div class="fine">
           <span id="finetext">${
             hasGivenEmail()
               ? "Your schedule is never uploaded."
               : "Your email is stored so we can contact you about this tool. Your schedule is never uploaded."
           }</span>
           <a href="https://parse.kigani-systems.com/privacy.html" target="_blank" rel="noopener">Privacy</a>
           <button class="link" id="optout">${isOptedOut() ? "Opt back in" : "Opt out of counting"}</button>
         </div>`,
      );

      const lastInput = backdrop.querySelector<HTMLInputElement>("#last")!;
      const emailInput = backdrop.querySelector<HTMLInputElement>("#email");
      const button = backdrop.querySelector<HTMLButtonElement>("#dl")!;

      const startDownload = () => {
        const [y, m, d] = lastInput.value.split("-").map(Number);
        download(meetings, new Date(Date.UTC(y!, m! - 1, d!)), result.termCode);
      };

      button.addEventListener("click", () => {
        if (!emailInput) return startDownload();

        const value = emailInput.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
          emailInput.classList.add("bad");
          emailInput.focus();
          return;
        }
        emailInput.classList.remove("bad");
        button.disabled = true;
        button.textContent = "\u2026";

        void subscribeEmail(value).then((ok) => {
          if (ok) setGivenEmail();
          // Deliberately fails open. If our own endpoint is unreachable, the
          // student still gets the calendar they came for — withholding it
          // because an address could not be recorded would be putting our
          // mailing list ahead of the thing that is actually useful to them.
          button.disabled = false;
          button.textContent = "Download .ics";
          emailInput.remove();
          startDownload();
        });
      });

      const optOut = backdrop.querySelector<HTMLButtonElement>("#optout")!;
      optOut.addEventListener("click", () => {
        const next = !isOptedOut();
        setOptedOut(next);
        optOut.textContent = next ? "Opt back in" : "Opt out of counting";
        backdrop.querySelector("#finetext")!.textContent = next
          ? "Opted out of anonymous counts. Your schedule is never uploaded."
          : "Your schedule is never uploaded.";
      });
    },

    close,
  };
}

function download(meetings: Meeting[], lastDate: Date, termCode: string): void {
  const ics = buildCalendar(meetings, {
    lastDate,
    calendarName: `Classes ${termCode}`,
  });
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `class-schedule-${termCode}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
