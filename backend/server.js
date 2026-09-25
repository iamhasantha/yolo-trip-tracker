import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { customAlphabet } from "nanoid";
import { db } from "./db.js";
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
  const { name, currency, targetAmount, creatorName } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Trip name is required." });
  if (!creatorName || !String(creatorName).trim()) return res.status(400).json({ error: "Your name is required." });

  let code;
  do { code = genCode(); } while (tripByCode(code));

  const insertTrip = db.prepare(
    "INSERT INTO trips (code, name, currency, target_amount) VALUES (?, ?, ?, ?)"
  );
  const info = insertTrip.run(code, name.trim(), currency || "LKR", Number(targetAmount) || 0);

  const memberInfo = db.prepare("INSERT INTO members (trip_id, name) VALUES (?, ?)").run(info.lastInsertRowid, creatorName.trim());

  domainEventsTotal.inc({ entity: "trip", operation: "created" });
  audit(req, "trip.created", { tripId: Number(info.lastInsertRowid), creatorMemberId: Number(memberInfo.lastInsertRowid) });
  res.status(201).json({ ...tripByCode(code), creatorMemberId: Number(memberInfo.lastInsertRowid) });
});

app.get("/api/trips/:code", requireTrip, (req, res) => {
  res.json(req.trip);
});

// ---------- Members ----------

app.get("/api/trips/:code/members", requireTrip, (req, res) => {
  const members = db.prepare("SELECT * FROM members WHERE trip_id = ? ORDER BY joined_at").all(req.trip.id);
  res.json(members);
});

app.post("/api/trips/:code/members", requireTrip, requireActiveTrip, (req, res) => {
  const { name } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "A name is required." });
  const info = db.prepare("INSERT INTO members (trip_id, name) VALUES (?, ?)").run(req.trip.id, name.trim());
  domainEventsTotal.inc({ entity: "member", operation: "added" });
  audit(req, "member.added", { tripId: req.trip.id, memberId: Number(info.lastInsertRowid) });
  res.status(201).json(db.prepare("SELECT * FROM members WHERE id = ?").get(info.lastInsertRowid));
});

app.delete("/api/trips/:code/members/:id", requireTrip, requireActiveTrip, (req, res) => {
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

app.post("/api/trips/:code/contributions", requireTrip, requireActiveTrip, (req, res) => {
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

app.delete("/api/trips/:code/contributions/:id", requireTrip, requireActiveTrip, (req, res) => {
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

app.post("/api/trips/:code/expenses", requireTrip, requireActiveTrip, (req, res) => {
  const { description, category, amount, paidBy } = req.body;
  if (!description || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "A description and a positive amount are required." });
  }
  if (paidBy) {
    const member = db.prepare("SELECT id FROM members WHERE id = ? AND trip_id = ?").get(paidBy, req.trip.id);
    if (!member) return res.status(404).json({ error: "That member isn't part of this trip." });
  }
  const info = db.prepare(
    "INSERT INTO expenses (trip_id, paid_by, description, category, amount) VALUES (?, ?, ?, ?, ?)"
  ).run(req.trip.id, paidBy || null, description.trim(), category || "General", Number(amount));

  domainEventsTotal.inc({ entity: "expense", operation: "created" });
  audit(req, "expense.created", { tripId: req.trip.id, expenseId: Number(info.lastInsertRowid), paidByMemberId: paidBy ? Number(paidBy) : null });
  res.status(201).json(db.prepare("SELECT * FROM expenses WHERE id = ?").get(info.lastInsertRowid));
});

app.delete("/api/trips/:code/expenses/:id", requireTrip, requireActiveTrip, (req, res) => {
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

// ---------- Completion voting and final report ----------

app.get("/api/trips/:code/completion", requireTrip, (req, res) => {
  res.json(completionStatus(req.trip));
});

app.put("/api/trips/:code/completion/vote", requireTrip, requireActiveTrip, (req, res) => {
  const memberId = Number(req.body.memberId);
  const vote = req.body.vote !== false;
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
