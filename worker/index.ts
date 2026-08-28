/**
 * Serves the static site and three small endpoints.
 *
 * Static assets are matched first by the Workers runtime; anything that is not
 * a file in dist/ arrives here.
 */

interface Env {
  DB: D1Database;
  ADMIN_KEY: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

/** Coarse family only. The full UA string is a well-known fingerprinting vector. */
function browserFamily(ua: string): string {
  if (/edg\//i.test(ua)) return "edge";
  if (/chrome|chromium|crios/i.test(ua)) return "chrome";
  if (/firefox|fxios/i.test(ua)) return "firefox";
  if (/safari/i.test(ua)) return "safari";
  return "other";
}

function clampInt(value: unknown, max: number): number | null {
  const n = typeof value === "number" ? Math.trunc(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

/** Only ever a hostname, never a full URL with its path and query. */
function hostOf(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 255) return null;
  return /^[a-z0-9.-]+$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * Fixed set. Free-text error messages could carry anything the browser put in
 * them, so the client sends a category and unknown values collapse to "other".
 */
const OUTCOMES = new Set([
  "ok",
  "session_expired",
  "not_banner_page",
  "no_schedule",
  "empty_schedule",
  "banner_unreachable",
  "unexpected",
  "other",
]);

async function recordEvent(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2000) return json({ ok: false }, 413);
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ ok: false }, 400);
  }

  const kind = body.kind === "success" ? "success" : body.kind === "error" ? "error" : null;
  if (!kind) return json({ ok: false }, 400);

  const outcome = typeof body.outcome === "string" && OUTCOMES.has(body.outcome) ? body.outcome : "other";
  const build = typeof body.build === "string" ? body.build.slice(0, 64) : null;

  await env.DB.prepare(
    `INSERT INTO events (ts, kind, outcome, build, school, browser, courses, skipped, failed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      Math.floor(Date.now() / 1000), // server clock; client clocks are not trustworthy
      kind,
      outcome,
      build,
      hostOf(body.school),
      browserFamily(request.headers.get("user-agent") ?? ""),
      clampInt(body.courses, 100),
      clampInt(body.skipped, 100),
      clampInt(body.failed, 100),
    )
    .run();

  return json({ ok: true });
}

async function subscribe(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 1000) return json({ ok: false }, 413);
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ ok: false }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: "invalid email" }, 400);
  }

  // Idempotent: submitting twice is not an error and does not duplicate.
  await env.DB.prepare(
    `INSERT INTO subscribers (email, ts, school) VALUES (?, ?, ?)
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(email, Math.floor(Date.now() / 1000), hostOf(body.school))
    .run();

  return json({ ok: true });
}

/** Constant-time-ish comparison so the key cannot be guessed byte by byte. */
function keyMatches(supplied: string, expected: string): boolean {
  if (!expected || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function dashboard(request: Request, env: Env): Promise<Response> {
  const supplied = new URL(request.url).searchParams.get("key") ?? "";
  if (!keyMatches(supplied, env.ADMIN_KEY ?? "")) {
    return new Response("Not found", { status: 404 });
  }

  const day = 86400;
  const now = Math.floor(Date.now() / 1000);

  const [totals, daily, outcomes, browsers, subs, subList] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) runs,
              SUM(kind = 'success') ok,
              SUM(kind = 'error') err,
              SUM(ts > ?) last7
       FROM events`,
    )
      .bind(now - 7 * day)
      .first<{ runs: number; ok: number; err: number; last7: number }>(),
    env.DB.prepare(
      `SELECT date(ts, 'unixepoch') d, COUNT(*) n, SUM(kind='error') e
       FROM events WHERE ts > ? GROUP BY d ORDER BY d DESC LIMIT 30`,
    )
      .bind(now - 30 * day)
      .all<{ d: string; n: number; e: number }>(),
    env.DB.prepare(
      `SELECT outcome, COUNT(*) n FROM events GROUP BY outcome ORDER BY n DESC`,
    ).all<{ outcome: string; n: number }>(),
    env.DB.prepare(
      `SELECT browser, COUNT(*) n FROM events GROUP BY browser ORDER BY n DESC`,
    ).all<{ browser: string; n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) n FROM subscribers`).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT email, date(ts,'unixepoch') d FROM subscribers ORDER BY ts DESC LIMIT 500`,
    ).all<{ email: string; d: string }>(),
  ]);

  const rows = <T,>(list: T[], cells: (row: T) => string[]) =>
    list.map((r) => `<tr>${cells(r).map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");

  const html = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Usage</title>
<style>
 body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d1d1f;
      max-width:900px;margin:40px auto;padding:0 24px}
 h1{font-size:24px;letter-spacing:-.02em;margin:0 0 4px}
 h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#248a3d;margin:34px 0 10px}
 .big{display:flex;gap:36px;margin:22px 0 0;flex-wrap:wrap}
 .big div b{display:block;font-size:30px;font-weight:600;letter-spacing:-.02em}
 .big div span{color:#6e6e73;font-size:13px}
 table{border-collapse:collapse;width:100%;font-size:13px}
 td,th{text-align:left;padding:5px 10px 5px 0;border-bottom:1px solid #eee}
 th{color:#6e6e73;font-weight:600}
 .muted{color:#6e6e73;font-size:12px;margin-top:40px;border-top:1px solid #eee;padding-top:14px}
</style>
<h1>Usage</h1>
<div class="big">
  <div><b>${totals?.runs ?? 0}</b><span>runs, all time</span></div>
  <div><b>${totals?.last7 ?? 0}</b><span>last 7 days</span></div>
  <div><b>${totals?.ok ?? 0}</b><span>successful</span></div>
  <div><b>${totals?.err ?? 0}</b><span>errors</span></div>
  <div><b>${subs?.n ?? 0}</b><span>subscribers</span></div>
</div>

<h2>By day</h2>
<table><tr><th>Date</th><th>Runs</th><th>Errors</th></tr>
${rows(daily.results ?? [], (r) => [r.d, String(r.n), String(r.e ?? 0)])}</table>

<h2>Outcomes</h2>
<table><tr><th>Outcome</th><th>Count</th></tr>
${rows(outcomes.results ?? [], (r) => [r.outcome ?? "-", String(r.n)])}</table>

<h2>Browsers</h2>
<table><tr><th>Browser</th><th>Count</th></tr>
${rows(browsers.results ?? [], (r) => [r.browser ?? "-", String(r.n)])}</table>

<h2>Subscribers</h2>
<table><tr><th>Email</th><th>Joined</th></tr>
${rows(subList.results ?? [], (r) => [r.email, r.d])}</table>

<p class="muted">Runs, not unique people &mdash; nothing here identifies anyone.
No IP addresses, no identifiers, and nothing from any student's schedule is stored.</p>`;

  return new Response(html, {
    headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    try {
      if (pathname === "/api/event" && request.method === "POST") return await recordEvent(request, env);
      if (pathname === "/api/subscribe" && request.method === "POST") return await subscribe(request, env);
      if (pathname === "/admin") return await dashboard(request, env);
    } catch {
      // Telemetry must never be able to break the product. A failed insert is
      // a lost data point, not an error the student should ever hear about.
      return json({ ok: false }, 500);
    }

    return new Response("Not found", { status: 404 });
  },
};
