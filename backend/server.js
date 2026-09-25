import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { fileURLToPath } from "url";
import { customAlphabet } from "nanoid";
import { db, DEFAULT_CATEGORIES } from "./db.js";
import { createTripReport } from "./report.js";
import {
  audit,
  completionVotesTotal,
  domainEventsTotal,
  logger,
  metricsAuthorized,
  metricsMiddleware,
  refreshTripMetrics,
  register,
  reportDuration,
  reportsTotal,
  requestLogger,
} from "./observability.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors({ exposedHeaders: ["X-Request-ID"] }));
app.use(requestLogger);
app.use(metricsMiddleware);
app.use(express.json());

// Unambiguous alphabet for the YOLO code (no 0/O/1/I)
const genCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

function tripByCode(code) {
  return db.prepare("SELECT * FROM trips WHERE code = ?").get(code?.toUpperCase());
}

function requireTrip(req, res, next) {
  const trip = tripByCode(req.params.code);
  if (!trip) return res.status(404).json({ error: "No trip found for that YOLO code." });
  req.trip = trip;
  next();
}

function requireActiveTrip(req, res, next) {
  if (req.trip.completed_at) {
    return res.status(409).json({ error: "This trip is complete and its records are locked." });
  }
  next();
}

function requireMember(req, res, next) {
  const token = req.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  const member = token ? db.prepare(`
    SELECT m.id, m.trip_id, m.name FROM member_sessions s
    JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ? AND m.trip_id = ?
  `).get(createHash("sha256").update(token).digest("hex"), req.trip.id) : null;
  if (!member) {
    return res.status(403).json({ error: "Join this trip as a member before making changes." });
  }
  req.member = member;
  next();
}

function issueMemberToken(memberId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO member_sessions (member_id, token_hash) VALUES (?, ?)")
    .run(memberId, createHash("sha256").update(token).digest("hex"));
  return token;
}

function validPin(pin) {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

const MAX_CATEGORIES = 20;
function categoryName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function listCategories(tripId) {
  return db.prepare(`
    SELECT c.id, c.name, c.is_default,
      (SELECT COUNT(*) FROM expenses e WHERE e.trip_id = c.trip_id AND e.category = c.name COLLATE NOCASE) AS expense_count
    FROM trip_categories c WHERE c.trip_id = ? ORDER BY c.is_default DESC, c.id
  `).all(tripId);
}

function saveMemberPin(memberId, pin) {
  const salt = randomBytes(16).toString("hex");
  const pinHash = scryptSync(pin, salt, 64).toString("hex");
  db.prepare(`
    INSERT INTO member_pins (member_id, salt, pin_hash) VALUES (?, ?, ?)
    ON CONFLICT(member_id) DO UPDATE SET
      salt = excluded.salt, pin_hash = excluded.pin_hash,
      failed_attempts = 0, locked_until = 0
  `).run(memberId, salt, pinHash);
}

function verifyMemberPin(memberId, pin) {
  const record = db.prepare("SELECT * FROM member_pins WHERE member_id = ?").get(memberId);
  if (!record) return { ok: false, status: 403, error: "No PIN is set for this member. Set one from a browser where you're already signed in." };

  const now = Date.now();
  if (record.locked_until > now) {
    return { ok: false, status: 429, error: "Too many PIN attempts. Try again in 15 minutes." };
  }

  const submitted = scryptSync(String(pin ?? ""), record.salt, 64);
  const correct = timingSafeEqual(submitted, Buffer.from(record.pin_hash, "hex"));
  if (!correct) {
    const attempts = record.locked_until ? 1 : record.failed_attempts + 1;
    const lockedUntil = attempts >= 5 ? now + 15 * 60 * 1000 : 0;
    db.prepare("UPDATE member_pins SET failed_attempts = ?, locked_until = ? WHERE member_id = ?")
      .run(attempts, lockedUntil, memberId);
    return { ok: false, status: lockedUntil ? 429 : 403,
      error: lockedUntil ? "Too many PIN attempts. Try again in 15 minutes." : "Name or PIN is incorrect." };
  }

  db.prepare("UPDATE member_pins SET failed_attempts = 0, locked_until = 0 WHERE member_id = ?")
    .run(memberId);
  return { ok: true };
}

function completionStatus(trip) {
  const members = db.prepare("SELECT id, name FROM members WHERE trip_id = ? ORDER BY joined_at").all(trip.id);
  const votes = db.prepare(`
    SELECT v.member_id, v.created_at, m.name AS member_name
    FROM completion_votes v JOIN members m ON m.id = v.member_id
    WHERE v.trip_id = ? ORDER BY v.created_at
  `).all(trip.id);
  return {
    completed: Boolean(trip.completed_at),
    completedAt: trip.completed_at,
    memberCount: members.length,
    yesVotes: votes.length,
    requiredVotes: Math.ceil(members.length / 2),
    voters: votes,
    reportUrl: trip.completed_at ? `/api/trips/${trip.code}/report.pdf` : null,
  };
}

function getSummary(trip) {
  const members = db.prepare("SELECT * FROM members WHERE trip_id = ?").all(trip.id);
  const totalCollected = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total FROM contributions WHERE trip_id = ?"
  ).get(trip.id).total;
  const totalSpent = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE trip_id = ?"
  ).get(trip.id).total;
  const byCategory = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) AS total
    FROM expenses WHERE trip_id = ? GROUP BY category ORDER BY total DESC
  `).all(trip.id);
  const contributed = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total FROM contributions WHERE trip_id = ? AND member_id = ?"
  );
  const spent = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE trip_id = ? AND paid_by = ?"
  );
  const perMember = members.map((member) => {
    const memberContributed = contributed.get(trip.id, member.id).total;
    const memberSpent = spent.get(trip.id, member.id).total;
    return {
      id: member.id,
      name: member.name,
      contributed: memberContributed,
      spent: memberSpent,
      owed: Math.max(0, (trip.target_amount || 0) - memberContributed),
      paidInFull: trip.target_amount ? memberContributed >= trip.target_amount : memberContributed > 0,
    };
  });
  return {
    trip,
    memberCount: members.length,
    targetTotal: (trip.target_amount || 0) * members.length,
    totalCollected,
    totalSpent,
    balance: totalCollected - totalSpent,
    byCategory,
    perMember,
  };
}

// ---------- Trips ----------

app.post("/api/trips", (req, res) => {
  const { name, currency, targetAmount, creatorName, creatorPin, categories = [] } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Trip name is required." });
  if (!creatorName || !String(creatorName).trim()) return res.status(400).json({ error: "Your name is required." });
  if (!validPin(creatorPin)) return res.status(400).json({ error: "Use a 4-digit member PIN." });
  if (!Array.isArray(categories)) return res.status(400).json({ error: "Categories must be a list." });
  const customCategories = categories.map(categoryName);
  if (customCategories.some((value) => !value || value.length > 40)) {
    return res.status(400).json({ error: "Category names must be 1–40 characters." });
  }
  const categoryKeys = [...DEFAULT_CATEGORIES, ...customCategories].map((value) => value.toLowerCase());
  if (new Set(categoryKeys).size !== categoryKeys.length) {
    return res.status(409).json({ error: "Category names must be unique." });
  }
  if (categoryKeys.length > MAX_CATEGORIES) {
    return res.status(400).json({ error: "A trip can have up to 20 categories, including the defaults." });
  }

  let code;
  do { code = genCode(); } while (tripByCode(code));

  const insertTrip = db.prepare(
    "INSERT INTO trips (code, name, currency, target_amount) VALUES (?, ?, ?, ?)"
  );
  const created = db.transaction(() => {
    const info = insertTrip.run(code, name.trim(), currency || "LKR", Number(targetAmount) || 0);
    const insertCategory = db.prepare("INSERT INTO trip_categories (trip_id, name, is_default) VALUES (?, ?, ?)");
    for (const category of DEFAULT_CATEGORIES) insertCategory.run(info.lastInsertRowid, category, 1);
    for (const category of customCategories) insertCategory.run(info.lastInsertRowid, category, 0);
    const memberInfo = db.prepare("INSERT INTO members (trip_id, name) VALUES (?, ?)").run(info.lastInsertRowid, creatorName.trim());
    const creatorToken = issueMemberToken(memberInfo.lastInsertRowid);
    saveMemberPin(memberInfo.lastInsertRowid, creatorPin);
    return { tripId: Number(info.lastInsertRowid), memberId: Number(memberInfo.lastInsertRowid), creatorToken };
  })();

  domainEventsTotal.inc({ entity: "trip", operation: "created" });
  audit(req, "trip.created", { tripId: created.tripId, creatorMemberId: created.memberId });
  res.status(201).json({ ...tripByCode(code), creatorMemberId: created.memberId, creatorToken: created.creatorToken });
});

app.get("/api/trips/:code", requireTrip, (req, res) => {
  res.json(req.trip);
});

// ---------- Categories ----------

app.get("/api/trips/:code/categories", requireTrip, (req, res) => {
  res.json(listCategories(req.trip.id));
});

app.post("/api/trips/:code/categories", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const name = categoryName(req.body?.name);
  if (!name || name.length > 40) return res.status(400).json({ error: "Category names must be 1–40 characters." });
  const result = db.prepare(`
    INSERT OR IGNORE INTO trip_categories (trip_id, name)
    SELECT ?, ? WHERE (SELECT COUNT(*) FROM trip_categories WHERE trip_id = ?) < ?
  `).run(req.trip.id, name, req.trip.id, MAX_CATEGORIES);
  if (!result.changes) {
    const exists = db.prepare("SELECT 1 FROM trip_categories WHERE trip_id = ? AND name = ?").get(req.trip.id, name);
    return res.status(409).json({ error: exists ? "That category already exists." : "This trip already has 20 categories." });
  }
  audit(req, "category.created", { tripId: req.trip.id, categoryId: Number(result.lastInsertRowid) });
  res.status(201).json(db.prepare("SELECT * FROM trip_categories WHERE id = ?").get(result.lastInsertRowid));
});

app.delete("/api/trips/:code/categories/:id", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const category = db.prepare("SELECT id, name, is_default FROM trip_categories WHERE id = ? AND trip_id = ?")
    .get(req.params.id, req.trip.id);
  if (!category) return res.status(404).json({ error: "Category not found." });
  if (category.is_default) return res.status(409).json({ error: "Default categories cannot be removed." });
  const used = db.prepare("SELECT 1 FROM expenses WHERE trip_id = ? AND category = ? COLLATE NOCASE LIMIT 1")
    .get(req.trip.id, category.name);
  if (used) return res.status(409).json({ error: "A category used by expenses cannot be removed." });
  db.prepare("DELETE FROM trip_categories WHERE id = ? AND trip_id = ?").run(category.id, req.trip.id);
  audit(req, "category.removed", { tripId: req.trip.id, categoryId: category.id });
  res.status(204).end();
});

// ---------- Members ----------

app.get("/api/trips/:code/members", requireTrip, (req, res) => {
  const members = db.prepare("SELECT * FROM members WHERE trip_id = ? ORDER BY joined_at").all(req.trip.id);
  res.json(members);
});

app.get("/api/trips/:code/me", requireTrip, requireMember, (req, res) => {
  res.json(req.member);
});

app.get("/api/trips/:code/me/access", requireTrip, requireMember, (req, res) => {
  const hasPin = Boolean(db.prepare("SELECT 1 FROM member_pins WHERE member_id = ?").get(req.member.id));
  const sessions = db.prepare("SELECT COUNT(*) AS count FROM member_sessions WHERE member_id = ?").get(req.member.id).count;
  res.json({ hasPin, sessions });
});

app.put("/api/trips/:code/me/pin", requireTrip, requireMember, (req, res) => {
  const { pin, currentPin } = req.body || {};
  if (!validPin(pin)) return res.status(400).json({ error: "Use a 4-digit member PIN." });
  const existing = db.prepare("SELECT 1 FROM member_pins WHERE member_id = ?").get(req.member.id);
  if (existing) {
    const checked = verifyMemberPin(req.member.id, currentPin);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  }
  saveMemberPin(req.member.id, pin);
  audit(req, "member.pin_updated", { tripId: req.trip.id, memberId: req.member.id });
  res.status(204).end();
});

app.post("/api/trips/:code/me/sessions/reset", requireTrip, requireMember, (req, res) => {
  const checked = verifyMemberPin(req.member.id, req.body?.pin);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  const token = db.transaction(() => {
    db.prepare("DELETE FROM member_sessions WHERE member_id = ?").run(req.member.id);
    return issueMemberToken(req.member.id);
  })();
  audit(req, "member.sessions_reset", { tripId: req.trip.id, memberId: req.member.id });
  res.json({ token });
});

app.post("/api/trips/:code/login", requireTrip, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const pin = req.body?.pin;
  if (!name || !validPin(pin)) return res.status(400).json({ error: "Enter your name and 4-digit PIN." });
  const member = db.prepare("SELECT id, name FROM members WHERE trip_id = ? AND name = ? COLLATE NOCASE")
    .get(req.trip.id, name);
  if (!member) return res.status(403).json({ error: "Name or PIN is incorrect." });
  const checked = verifyMemberPin(member.id, pin);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  const token = issueMemberToken(member.id);
  audit(req, "member.signed_in", { tripId: req.trip.id, memberId: member.id });
  res.json({ ...member, token });
});

app.post("/api/trips/:code/members", requireTrip, requireActiveTrip, (req, res) => {
  const { name, pin } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "A name is required." });
  if (String(name).trim().length > 80) return res.status(400).json({ error: "Names can be up to 80 characters." });
  if (!validPin(pin)) return res.status(400).json({ error: "Use a 4-digit member PIN." });
  const existing = db.prepare("SELECT id FROM members WHERE trip_id = ? AND name = ? COLLATE NOCASE")
    .get(req.trip.id, String(name).trim());
  if (existing) return res.status(409).json({ error: "That name is already on this trip. Sign in with your PIN instead." });
  const joined = db.transaction(() => {
    const info = db.prepare("INSERT INTO members (trip_id, name) VALUES (?, ?)").run(req.trip.id, name.trim());
    const token = issueMemberToken(info.lastInsertRowid);
    saveMemberPin(info.lastInsertRowid, pin);
    return { memberId: Number(info.lastInsertRowid), token };
  })();
  domainEventsTotal.inc({ entity: "member", operation: "added" });
  audit(req, "member.added", { tripId: req.trip.id, memberId: joined.memberId });
  res.status(201).json({ ...db.prepare("SELECT * FROM members WHERE id = ?").get(joined.memberId), token: joined.token });
});

app.delete("/api/trips/:code/members/:id", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const result = db.prepare("DELETE FROM members WHERE id = ? AND trip_id = ?").run(req.params.id, req.trip.id);
  if (result.changes) {
    domainEventsTotal.inc({ entity: "member", operation: "removed" });
    audit(req, "member.removed", { tripId: req.trip.id, memberId: Number(req.params.id) });
  }
  res.status(204).end();
});

// ---------- Contributions ----------

app.get("/api/trips/:code/contributions", requireTrip, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, m.name AS member_name
    FROM contributions c JOIN members m ON m.id = c.member_id
    WHERE c.trip_id = ? ORDER BY c.created_at DESC
  `).all(req.trip.id);
  res.json(rows);
});

app.post("/api/trips/:code/contributions", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const { memberId, amount, note } = req.body;
  if (!memberId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "A member and a positive amount are required." });
  }
  const member = db.prepare("SELECT * FROM members WHERE id = ? AND trip_id = ?").get(memberId, req.trip.id);
  if (!member) return res.status(404).json({ error: "That member isn't part of this trip." });

  const info = db.prepare(
    "INSERT INTO contributions (trip_id, member_id, amount, note) VALUES (?, ?, ?, ?)"
  ).run(req.trip.id, memberId, Number(amount), note || null);

  domainEventsTotal.inc({ entity: "contribution", operation: "created" });
  audit(req, "contribution.created", { tripId: req.trip.id, contributionId: Number(info.lastInsertRowid), memberId: Number(memberId) });
  res.status(201).json(db.prepare("SELECT * FROM contributions WHERE id = ?").get(info.lastInsertRowid));
});

app.delete("/api/trips/:code/contributions/:id", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const result = db.prepare("DELETE FROM contributions WHERE id = ? AND trip_id = ?").run(req.params.id, req.trip.id);
  if (result.changes) {
    domainEventsTotal.inc({ entity: "contribution", operation: "removed" });
    audit(req, "contribution.removed", { tripId: req.trip.id, contributionId: Number(req.params.id) });
  }
  res.status(204).end();
});

// ---------- Expenses ----------

app.get("/api/trips/:code/expenses", requireTrip, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, m.name AS paid_by_name
    FROM expenses e LEFT JOIN members m ON m.id = e.paid_by
    WHERE e.trip_id = ? ORDER BY e.created_at DESC
  `).all(req.trip.id);
  res.json(rows);
});

app.post("/api/trips/:code/expenses", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const { description, category, amount, paidBy } = req.body;
  if (!description || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "A description and a positive amount are required." });
  }
  const selectedCategory = db.prepare("SELECT name FROM trip_categories WHERE trip_id = ? AND name = ?")
    .get(req.trip.id, categoryName(category || "General"));
  if (!selectedCategory) return res.status(400).json({ error: "Choose a category from this trip." });
  if (paidBy) {
    const member = db.prepare("SELECT id FROM members WHERE id = ? AND trip_id = ?").get(paidBy, req.trip.id);
    if (!member) return res.status(404).json({ error: "That member isn't part of this trip." });
  }
  const info = db.prepare(
    "INSERT INTO expenses (trip_id, paid_by, description, category, amount) VALUES (?, ?, ?, ?, ?)"
  ).run(req.trip.id, paidBy || null, description.trim(), selectedCategory.name, Number(amount));

  domainEventsTotal.inc({ entity: "expense", operation: "created" });
  audit(req, "expense.created", { tripId: req.trip.id, expenseId: Number(info.lastInsertRowid), paidByMemberId: paidBy ? Number(paidBy) : null });
  res.status(201).json(db.prepare("SELECT * FROM expenses WHERE id = ?").get(info.lastInsertRowid));
});

app.delete("/api/trips/:code/expenses/:id", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const result = db.prepare("DELETE FROM expenses WHERE id = ? AND trip_id = ?").run(req.params.id, req.trip.id);
  if (result.changes) {
    domainEventsTotal.inc({ entity: "expense", operation: "removed" });
    audit(req, "expense.removed", { tripId: req.trip.id, expenseId: Number(req.params.id) });
  }
  res.status(204).end();
});

// ---------- Budget breakdown ----------

app.get("/api/trips/:code/summary", requireTrip, (req, res) => {
  res.json(getSummary(req.trip));
});

// ---------- Shared notes ----------

app.get("/api/trips/:code/notes", requireTrip, (req, res) => {
  const notes = db.prepare(`
    SELECT id, trip_id, author_member_id, author_name, content, is_priority, created_at
    FROM notes WHERE trip_id = ? ORDER BY created_at DESC, id DESC
  `).all(req.trip.id);
  res.json(notes);
});

app.post("/api/trips/:code/notes", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const content = String(req.body?.content || "").trim();
  const isPriority = req.body?.priority === true ? 1 : 0;
  if (!content) return res.status(400).json({ error: "Note text is required." });
  if (content.length > 500) return res.status(400).json({ error: "Notes can be up to 500 characters." });

  const info = db.prepare(`
    INSERT INTO notes (trip_id, author_member_id, author_name, content, is_priority)
    SELECT ?, ?, ?, ?, ?
    WHERE ? = 0 OR (
      SELECT COUNT(*) FROM notes WHERE trip_id = ? AND is_priority = 1
    ) < 10
  `).run(req.trip.id, req.member.id, req.member.name, content, isPriority, isPriority, req.trip.id);
  if (!info.changes) return res.status(409).json({ error: "This trip already has 10 priority notes." });
  domainEventsTotal.inc({ entity: "note", operation: "created" });
  audit(req, "note.created", { tripId: req.trip.id, noteId: Number(info.lastInsertRowid), memberId: req.member.id, isPriority: Boolean(isPriority) });
  res.status(201).json(db.prepare("SELECT * FROM notes WHERE id = ?").get(info.lastInsertRowid));
});

app.delete("/api/trips/:code/notes/:id", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const note = db.prepare("SELECT author_member_id FROM notes WHERE id = ? AND trip_id = ?")
    .get(req.params.id, req.trip.id);
  if (!note) return res.status(404).json({ error: "Note not found." });
  if (note.author_member_id !== req.member.id) {
    return res.status(403).json({ error: "You can only remove your own notes." });
  }
  const result = db.prepare("DELETE FROM notes WHERE id = ? AND trip_id = ?").run(req.params.id, req.trip.id);
  if (result.changes) {
    domainEventsTotal.inc({ entity: "note", operation: "removed" });
    audit(req, "note.removed", { tripId: req.trip.id, noteId: Number(req.params.id), memberId: req.member.id });
  }
  res.status(204).end();
});

// ---------- Completion voting and final report ----------

app.get("/api/trips/:code/completion", requireTrip, (req, res) => {
  res.json(completionStatus(req.trip));
});

app.put("/api/trips/:code/completion/vote", requireTrip, requireActiveTrip, requireMember, (req, res) => {
  const memberId = Number(req.body.memberId);
  const vote = req.body.vote !== false;
  if (memberId !== req.member.id) return res.status(403).json({ error: "You can only submit your own completion vote." });
  const member = db.prepare("SELECT id FROM members WHERE id = ? AND trip_id = ?").get(memberId, req.trip.id);
  if (!member) return res.status(404).json({ error: "Choose a current trip member before voting." });

  const applyVote = db.transaction(() => {
    let changed = false;
    if (vote) {
      changed = Boolean(db.prepare("INSERT OR IGNORE INTO completion_votes (trip_id, member_id) VALUES (?, ?)").run(req.trip.id, memberId).changes);
    } else {
      changed = Boolean(db.prepare("DELETE FROM completion_votes WHERE trip_id = ? AND member_id = ?").run(req.trip.id, memberId).changes);
    }
    const memberCount = db.prepare("SELECT COUNT(*) AS count FROM members WHERE trip_id = ?").get(req.trip.id).count;
    const yesVotes = db.prepare("SELECT COUNT(*) AS count FROM completion_votes WHERE trip_id = ?").get(req.trip.id).count;
    const completed = memberCount > 0 && yesVotes >= Math.ceil(memberCount / 2);
    if (completed) db.prepare("UPDATE trips SET completed_at = datetime('now') WHERE id = ? AND completed_at IS NULL").run(req.trip.id);
    return { changed, memberCount, yesVotes, completed };
  });
  const result = applyVote();
  const action = vote ? "cast" : "withdrawn";
  const voteResult = result.completed ? "completed" : result.changed ? "pending" : "unchanged";
  completionVotesTotal.inc({ action, result: voteResult });
  domainEventsTotal.inc({ entity: "completion_vote", operation: action });
  if (result.completed) domainEventsTotal.inc({ entity: "trip", operation: "completed" });
  audit(req, vote ? "completion_vote.cast" : "completion_vote.withdrawn", {
    tripId: req.trip.id,
    memberId,
    changed: result.changed,
    yesVotes: result.yesVotes,
    requiredVotes: Math.ceil(result.memberCount / 2),
    completed: result.completed,
  });
  res.json(completionStatus(tripByCode(req.trip.code)));
});

app.get("/api/trips/:code/report.pdf", requireTrip, (req, res) => {
  if (!req.trip.completed_at) {
    return res.status(409).json({ error: "The report is available after the completion vote passes." });
  }
  const members = db.prepare("SELECT * FROM members WHERE trip_id = ? ORDER BY joined_at").all(req.trip.id);
  const contributions = db.prepare(`
    SELECT c.*, m.name AS member_name FROM contributions c
    JOIN members m ON m.id = c.member_id WHERE c.trip_id = ? ORDER BY c.created_at, c.id
  `).all(req.trip.id);
  const expenses = db.prepare(`
    SELECT e.*, m.name AS paid_by_name FROM expenses e
    LEFT JOIN members m ON m.id = e.paid_by WHERE e.trip_id = ? ORDER BY e.created_at, e.id
  `).all(req.trip.id);
  const votes = completionStatus(req.trip).voters;
  const filename = `${req.trip.code}-${req.trip.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-report.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const started = process.hrtime.bigint();
  const report = createTripReport({ trip: req.trip, members, contributions, expenses, summary: getSummary(req.trip), votes });
  report.once("error", (error) => {
    req.log.error({ err: error, event: "report.failed", tripId: req.trip.id }, "report.failed");
    if (!res.headersSent) res.status(500).json({ error: "The PDF report could not be generated.", requestId: req.id });
    else res.destroy(error);
  });
  res.once("finish", () => {
    const outcome = res.statusCode < 400 ? "success" : "error";
    reportsTotal.inc({ outcome });
    reportDuration.observe({ outcome }, Number(process.hrtime.bigint() - started) / 1e9);
    audit(req, "report.downloaded", { tripId: req.trip.id, outcome });
  });
  report.pipe(res);
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/metrics", (req, res) => {
  if (!metricsAuthorized(req)) return res.status(401).json({ error: "Metrics authentication required." });
  refreshTripMetrics(db);
  res.setHeader("Content-Type", register.contentType);
  register.metrics().then((metrics) => res.end(metrics)).catch((error) => {
    req.log.error({ err: error, event: "metrics.failed" }, "metrics.failed");
    res.status(500).json({ error: "Metrics could not be collected.", requestId: req.id });
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found.", requestId: req.id });
});

app.use((error, req, res, _next) => {
  const status = Number(error.status) >= 400 && Number(error.status) < 500 ? Number(error.status) : 500;
  const log = status >= 500 ? req.log.error.bind(req.log) : req.log.warn.bind(req.log);
  log({ err: error, event: "request.failed", statusCode: status }, "request.failed");
  if (res.headersSent) return res.end();
  res.status(status).json({
    error: status === 400 ? "The request body is not valid JSON." : "An unexpected server error occurred.",
    requestId: req.id,
  });
});

// ---------- Serve the built frontend (single-process deployment) ----------
// Run `npm run build` in ../frontend first. If frontend/dist doesn't exist,
// this is a no-op and the API-only server behaves as before (useful in dev,
// where the Vite dev server handles the frontend on its own port instead).
const distDir = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  logger.info({ event: "frontend.enabled", distDir }, "frontend.enabled");
}

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => logger.info({ event: "server.started", port: Number(PORT) }, "server.started"));
server.on("error", (error) => logger.fatal({ err: error, event: "server.failed" }, "server.failed"));

function shutdown(signal) {
  logger.info({ event: "server.shutdown_started", signal }, "server.shutdown_started");
  server.close((error) => {
    if (error) {
      logger.error({ err: error, event: "server.shutdown_failed" }, "server.shutdown_failed");
      process.exitCode = 1;
    } else {
      logger.info({ event: "server.shutdown_completed" }, "server.shutdown_completed");
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
