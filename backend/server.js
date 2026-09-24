import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { customAlphabet } from "nanoid";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
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

  db.prepare("INSERT INTO members (trip_id, name) VALUES (?, ?)").run(info.lastInsertRowid, creatorName.trim());

  res.status(201).json(tripByCode(code));
});

app.get("/api/trips/:code", requireTrip, (req, res) => {
  res.json(req.trip);
});

// ---------- Members ----------

app.get("/api/trips/:code/members", requireTrip, (req, res) => {
  const members = db.prepare("SELECT * FROM members WHERE trip_id = ? ORDER BY joined_at").all(req.trip.id);
  res.json(members);
});

app.post("/api/trips/:code/members", requireTrip, (req, res) => {
  const { name } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "A name is required." });
  const info = db.prepare("INSERT INTO members (trip_id, name) VALUES (?, ?)").run(req.trip.id, name.trim());
  res.status(201).json(db.prepare("SELECT * FROM members WHERE id = ?").get(info.lastInsertRowid));
});

app.delete("/api/trips/:code/members/:id", requireTrip, (req, res) => {
  db.prepare("DELETE FROM members WHERE id = ? AND trip_id = ?").run(req.params.id, req.trip.id);
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

app.post("/api/trips/:code/contributions", requireTrip, (req, res) => {
  const { memberId, amount, note } = req.body;
  if (!memberId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "A member and a positive amount are required." });
  }
  const member = db.prepare("SELECT * FROM members WHERE id = ? AND trip_id = ?").get(memberId, req.trip.id);
  if (!member) return res.status(404).json({ error: "That member isn't part of this trip." });

  const info = db.prepare(
    "INSERT INTO contributions (trip_id, member_id, amount, note) VALUES (?, ?, ?, ?)"
  ).run(req.trip.id, memberId, Number(amount), note || null);

  res.status(201).json(db.prepare("SELECT * FROM contributions WHERE id = ?").get(info.lastInsertRowid));
});

app.delete("/api/trips/:code/contributions/:id", requireTrip, (req, res) => {
  db.prepare("DELETE FROM contributions WHERE id = ? AND trip_id = ?").run(req.params.id, req.trip.id);
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

app.post("/api/trips/:code/expenses", requireTrip, (req, res) => {
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

  res.status(201).json(db.prepare("SELECT * FROM expenses WHERE id = ?").get(info.lastInsertRowid));
});

app.delete("/api/trips/:code/expenses/:id", requireTrip, (req, res) => {
  db.prepare("DELETE FROM expenses WHERE id = ? AND trip_id = ?").run(req.params.id, req.trip.id);
  res.status(204).end();
});

// ---------- Budget breakdown ----------

app.get("/api/trips/:code/summary", requireTrip, (req, res) => {
  const trip = req.trip;
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

  const perMember = members.map((m) => {
    const contributed = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM contributions WHERE trip_id = ? AND member_id = ?"
    ).get(trip.id, m.id).total;
    const spent = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE trip_id = ? AND paid_by = ?"
    ).get(trip.id, m.id).total;
    return {
      id: m.id,
      name: m.name,
      contributed,
      spent,
      owed: Math.max(0, (trip.target_amount || 0) - contributed),
      paidInFull: trip.target_amount ? contributed >= trip.target_amount : contributed > 0,
    };
  });

  res.json({
    trip,
    memberCount: members.length,
    targetTotal: (trip.target_amount || 0) * members.length,
    totalCollected,
    totalSpent,
    balance: totalCollected - totalSpent,
    byCategory,
    perMember,
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- Serve the built frontend (single-process deployment) ----------
// Run `npm run build` in ../frontend first. If frontend/dist doesn't exist,
// this is a no-op and the API-only server behaves as before (useful in dev,
// where the Vite dev server handles the frontend on its own port instead).
const distDir = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  console.log("Serving frontend build from", distDir);
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`YOLO API listening on port ${PORT}`));
