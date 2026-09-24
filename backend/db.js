import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH lets you point at a persistent volume in production
// e.g. DB_PATH=/data/yolo.db  (see DEPLOYMENT.md)
const dbPath = process.env.DB_PATH || path.join(__dirname, "yolo.db");

export const db = new Database(dbPath);
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

CREATE INDEX IF NOT EXISTS idx_members_trip ON members(trip_id);
CREATE INDEX IF NOT EXISTS idx_contrib_trip ON contributions(trip_id);
CREATE INDEX IF NOT EXISTS idx_expense_trip ON expenses(trip_id);
`);

// Lightweight migrations for databases created by earlier versions.
const tripColumns = new Set(db.prepare("PRAGMA table_info(trips)").all().map((column) => column.name));
if (!tripColumns.has("completed_at")) {
  db.exec("ALTER TABLE trips ADD COLUMN completed_at TEXT");
}

db.exec(`
CREATE TABLE IF NOT EXISTS completion_votes (
  trip_id    INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (trip_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_completion_votes_trip ON completion_votes(trip_id);
`);
