import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH lets you point at a persistent volume in production
// e.g. DB_PATH=/data/yolo.db  (see DEPLOYMENT.md)
const dbPath = process.env.DB_PATH || path.join(__dirname, "yolo.db");

export const db = new Database(dbPath);
export const DEFAULT_CATEGORIES = ["General", "Transport", "Food", "Stay", "Activities", "Shopping"];
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS trips (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'LKR',
  target_amount REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id    INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount      REAL NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  paid_by     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'General',
  amount      REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trip_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id    INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name       TEXT NOT NULL COLLATE NOCASE,
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE (trip_id, name)
);

CREATE TABLE IF NOT EXISTS notes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id          INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  author_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  author_name      TEXT NOT NULL,
  content          TEXT NOT NULL,
  is_priority      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_members_trip ON members(trip_id);
CREATE INDEX IF NOT EXISTS idx_contrib_trip ON contributions(trip_id);
CREATE INDEX IF NOT EXISTS idx_expense_trip ON expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_categories_trip ON trip_categories(trip_id);
CREATE INDEX IF NOT EXISTS idx_notes_trip ON notes(trip_id);
`);

// Existing trips retain their original choices and any categories used by older expenses.
db.transaction(() => {
  const seed = db.prepare("INSERT OR IGNORE INTO trip_categories (trip_id, name, is_default) VALUES (?, ?, 1)");
  for (const trip of db.prepare("SELECT id FROM trips").all()) {
    for (const name of DEFAULT_CATEGORIES) seed.run(trip.id, name);
  }
  db.exec(`
    INSERT OR IGNORE INTO trip_categories (trip_id, name, is_default)
    SELECT trip_id, TRIM(category), 0 FROM expenses WHERE TRIM(category) <> ''
  `);
})();

// Lightweight migrations for databases created by earlier versions.
const tripColumns = new Set(db.prepare("PRAGMA table_info(trips)").all().map((column) => column.name));
if (!tripColumns.has("completed_at")) {
  db.exec("ALTER TABLE trips ADD COLUMN completed_at TEXT");
}

const noteColumns = new Set(db.prepare("PRAGMA table_info(notes)").all().map((column) => column.name));
if (!noteColumns.has("is_priority")) {
  db.exec("ALTER TABLE notes ADD COLUMN is_priority INTEGER NOT NULL DEFAULT 0");
}

db.exec(`
CREATE TABLE IF NOT EXISTS completion_votes (
  trip_id    INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (trip_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_completion_votes_trip ON completion_votes(trip_id);

CREATE TABLE IF NOT EXISTS member_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions(member_id);

CREATE TABLE IF NOT EXISTS member_pins (
  member_id       INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  salt            TEXT NOT NULL,
  pin_hash        TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0
);
`);

// Preserve tokens issued before members could sign in from multiple browsers.
const sessionColumns = new Set(db.prepare("PRAGMA table_info(member_sessions)").all().map((column) => column.name));
if (!sessionColumns.has("id")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE member_sessions_next (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO member_sessions_next (member_id, token_hash)
      SELECT member_id, token_hash FROM member_sessions;
      DROP TABLE member_sessions;
      ALTER TABLE member_sessions_next RENAME TO member_sessions;
      CREATE INDEX idx_member_sessions_member ON member_sessions(member_id);
    `);
  })();
}
