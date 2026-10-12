import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import Database from "better-sqlite3";

const backend = fileURLToPath(new URL("..", import.meta.url));

test("legacy expense migration freezes shares and preserves payer", () => {
  const dir = mkdtempSync(join(tmpdir(), "yolo-migration-"));
  const path = join(dir, "legacy.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE trips (id INTEGER PRIMARY KEY, code TEXT, name TEXT, currency TEXT, target_amount REAL, created_at TEXT);
    CREATE TABLE members (id INTEGER PRIMARY KEY, trip_id INTEGER, name TEXT, joined_at TEXT);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY, trip_id INTEGER, paid_by INTEGER, description TEXT, category TEXT, amount REAL, created_at TEXT);
    INSERT INTO trips VALUES (1, 'LEGACY', 'Old trip', 'LKR', 0, datetime('now'));
    INSERT INTO members VALUES (1, 1, 'Alice', datetime('now')), (2, 1, 'Bob', datetime('now'));
    INSERT INTO expenses VALUES (1, 1, 1, 'Old dinner', 'Food', 10.01, datetime('now'));
    INSERT INTO expenses VALUES (2, 1, NULL, 'Old pot expense', 'General', 20, datetime('now'));
    INSERT INTO expenses VALUES (3, 1, NULL, 'Extra decimal legacy amount', 'General', 1.234, datetime('now'));
    INSERT INTO expenses VALUES (4, 1, NULL, 'Tiny legacy amount', 'General', 0.001, datetime('now'));`);
  db.close();
  try {
    const script = `import { db } from './db.js'; console.log(JSON.stringify(db.prepare('SELECT allocations_json FROM expenses ORDER BY id').all())); db.close();`;
    const run = () => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: backend, env: { ...process.env, DB_PATH: path } }).toString());
    const first = run();
    const allocations = JSON.parse(first[0].allocations_json);
    assert.deepEqual(allocations.shares.map((p) => p.amount), [5.01, 5]);
    assert.equal(allocations.payers[0].name, "Alice");
    assert.equal(JSON.parse(first[1].allocations_json).paymentSource, "pot");
    assert.deepEqual(JSON.parse(first[2].allocations_json).shares.map((p) => p.amount), [0.62, 0.61]);
    assert.deepEqual(JSON.parse(first[3].allocations_json).shares.map((p) => p.amount), [0, 0]);
    const updated = new Database(path);
    updated.prepare("INSERT INTO members VALUES (3, 1, 'Cara', datetime('now'))").run();
    updated.close();
    assert.deepEqual(run(), first);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("expense API validates allocations, balances, permissions, and final PDF", { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "yolo-expenses-"));
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const server = spawn(process.execPath, ["server.js"], { cwd: backend, env: { ...process.env, DB_PATH: join(dir, "test.db"), PORT: String(port), LOG_LEVEL: "error" }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  server.stdout.on("data", (data) => { logs += data; });
  server.stderr.on("data", (data) => { logs += data; });
  t.after(async () => {
    server.kill("SIGTERM");
    if (server.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { await fetch(`${base}/trips/NONE`); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  assert.ok(ready, logs);
  async function request(path, method = "GET", body, token, expected = 200) {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = response.status === 204 ? null : await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    return data;
  }
  const trip = await request("/trips", "POST", { name: "Split expense QA", creatorName: "Alice", creatorPin: "1234", currency: "LKR", targetAmount: 100 }, null, 201);
  const root = `/trips/${trip.code}`, token = trip.creatorToken, alice = trip.creatorMemberId;
  const bob = await request(root + "/members", "POST", { name: "Bob", pin: "1234" }, null, 201);
  const cara = await request(root + "/members", "POST", { name: "Cara", pin: "1234" }, null, 201);
  await request(root + "/contributions", "POST", { memberId: alice, amount: 100 }, token, 201);
  const body = { description: "Dinner for Alice and Cara", category: "Food", amount: 100,
    paymentSource: "members", payerMode: "amounts", payers: [{ memberId: alice, value: 70 }, { memberId: bob.id, value: 30 }],
    shareMode: "percentages", shares: [{ memberId: alice, value: 25 }, { memberId: cara.id, value: 75 }] };
  await request(root + "/expenses", "POST", body, null, 403);
  const expense = await request(root + "/expenses", "POST", body, token, 201);
  assert.deepEqual(expense.payers.map((p) => p.amount), [70, 30]);
  assert.deepEqual(expense.shares.map((p) => p.amount), [25, 75]);
  await request(root + "/expenses", "POST", { ...body, shares: [] }, token, 400);
  await request(root + "/expenses", "POST", { ...body, payers: [{ memberId: alice, value: 99 }] }, token, 400);
  await request(root + "/expenses", "POST", { ...body, amount: "Infinity" }, token, 400);
  await request(root + "/expenses", "POST", { ...body, shares: [{ memberId: alice, value: 101 }] }, token, 400);
  await request(root + "/expenses", "POST", { ...body, shares: [{ memberId: alice, value: 50 }, { memberId: alice, value: 50 }] }, token, 400);
  const other = await request("/trips", "POST", { name: "Other trip", creatorName: "Outsider", creatorPin: "1234" }, null, 201);
  await request(root + "/expenses", "POST", { ...body, shares: [{ memberId: other.creatorMemberId, value: 100 }] }, token, 400);
  const pot = await request(root + "/expenses", "POST", { description: "Transport for Alice and Bob", category: "Transport", amount: 20.01, paymentSource: "pot", shares: [{ memberId: alice }, { memberId: bob.id }] }, token, 201);
  assert.deepEqual(pot.shares.map((p) => p.amount), [10.01, 10]);
  await request(root + `/members/${bob.id}`, "DELETE", null, token, 409);
  let summary = await request(root + "/summary");
  assert.equal(summary.totalSpent, 120.01);
  assert.equal(summary.balance, 79.99);
  assert.equal(summary.totalCollected, 100);
  assert.equal(summary.totalDirectPaid, 100);
  assert.equal(summary.totalPaid, 200);
  assert.deepEqual(summary.perMember.map((m) => [m.totalPaid, m.owed, m.paidInFull]), [[170, 0, true], [30, 70, false], [0, 100, false]]);
  assert.deepEqual(summary.spendingByPayer.map((p) => [p.name, p.total]), [["Alice", 70], ["Bob", 30], ["Common pot", 20.01]]);
  assert.deepEqual(summary.largestExpenses.map((e) => e.total), [100, 20.01]);
  assert.deepEqual(summary.byCategory.map((c) => [c.category, c.total]), [["Food", 100], ["Transport", 20.01]]);
  assert.deepEqual(summary.perMember.map((m) => [m.spent, m.expenseShare, m.netBalance]), [[70, 35.01, 134.99], [30, 10, 20], [0, 75, -75]]);
  const targetPayment = await request(root + "/expenses", "POST", { description: "Bob pays for Cara", category: "Food", amount: 70,
    paymentSource: "members", payers: [{ memberId: bob.id }], shares: [{ memberId: cara.id }] }, token, 201);
  summary = await request(root + "/summary");
  assert.equal(summary.perMember[1].paidInFull, true);
  assert.equal(summary.perMember[1].totalPaid, 100);
  assert.equal(summary.perMember[1].owed, 0);
  assert.equal(summary.perMember[2].totalPaid, 0);
  assert.equal(summary.balance, 79.99);
  assert.equal((await request(root + "/contributions")).length, 1);
  await request(root + `/expenses/${targetPayment.id}`, "DELETE", null, token, 204);
  summary = await request(root + "/summary");
  assert.equal(summary.perMember[1].paidInFull, false);
  assert.equal(summary.perMember[1].owed, 70);
  assert.equal(summary.totalPaid, 200);
  await request(root + `/expenses/${pot.id}`, "DELETE", null, token, 204);
  summary = await request(root + "/summary");
  assert.equal(summary.balance, 100);
  assert.equal(summary.perMember[0].expenseShare, 25);
  assert.equal(summary.spendingByPayer.length, 2);
  assert.equal(summary.largestExpenses.length, 1);
  // Common-pot costs never create member credit, and only the top five expenses are ranked.
  const otherRoot = `/trips/${other.code}`;
  for (let amount = 1; amount <= 6; amount++) {
    await request(otherRoot + "/expenses", "POST", { description: `Pot expense ${amount}`, category: "General", amount }, other.creatorToken, 201);
  }
  let otherSummary = await request(otherRoot + "/summary");
  assert.deepEqual(otherSummary.largestExpenses.map((e) => e.total), [6, 5, 4, 3, 2]);
  assert.equal(otherSummary.perMember[0].totalPaid, 0);
  assert.equal(otherSummary.perMember[0].paidInFull, false);
  const tinyPayment = await request(otherRoot + "/expenses", "POST", { description: "Direct payment without a target", category: "General", amount: 0.01,
    paymentSource: "members", payers: [{ memberId: other.creatorMemberId }] }, other.creatorToken, 201);
  otherSummary = await request(otherRoot + "/summary");
  assert.equal(otherSummary.perMember[0].totalPaid, 0.01);
  assert.equal(otherSummary.perMember[0].paidInFull, true);
  assert.equal(otherSummary.totalCollected, 0);
  assert.equal(otherSummary.balance, -21);
  await request(otherRoot + `/expenses/${tinyPayment.id}`, "DELETE", null, other.creatorToken, 204);
  // Legacy clients still get all-member shares and their single payer.
  const legacy = await request(root + "/expenses", "POST", { description: "Legacy payment", category: "General", amount: 9, paidBy: bob.id }, token, 201);
  assert.equal(legacy.payers[0].memberId, bob.id);
  assert.equal(legacy.shares.length, 3);
  await request(root + `/expenses/${legacy.id}`, "DELETE", null, token, 204);
  assert.equal((await request(root + "/expenses")).length, 1);
  await request(root + "/completion/vote", "PUT", { memberId: alice }, token);
  await request(root + "/completion/vote", "PUT", { memberId: bob.id }, bob.token);
  const report = await fetch(base + root + "/report.pdf");
  assert.equal(report.status, 200);
  const pdf = Buffer.from(await report.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  if (process.env.REPORT_QA_PATH) writeFileSync(process.env.REPORT_QA_PATH, pdf);
  await request(root + "/expenses", "POST", body, token, 409);
  await request(root + `/expenses/${expense.id}`, "DELETE", null, token, 409);
});
