-- Anonymous usage counters.
--
-- Deliberately absent: IP address, user agent string, any persistent or random
-- identifier, and anything at all from the student's schedule. There is no
-- column here that could tie two rows to the same person, which is what makes
-- the "anonymous" claim on the site true rather than aspirational.
--
-- Consequence, accepted on purpose: this counts runs, not unique users.
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,           -- unix seconds, server-assigned
  kind     TEXT    NOT NULL,           -- 'success' | 'error'
  outcome  TEXT,                       -- 'ok' or an error category, never a message
  build    TEXT,                       -- build id of b.js that ran
  school   TEXT,                       -- Banner hostname, for multi-school later
  browser  TEXT,                       -- coarse family only: chrome/firefox/safari/edge
  courses  INTEGER,                    -- how many meetings found. a count, not what they are
  skipped  INTEGER,
  failed   INTEGER
);

CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

-- Explicit opt-in only. A row exists here solely because someone typed their
-- address into a box and pressed a button.
CREATE TABLE IF NOT EXISTS subscribers (
  email    TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL,
  school   TEXT
);
