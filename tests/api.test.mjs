import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { addMember, createTrip, startServer } from "./support/server.mjs";

let fixture;
before(async () => { fixture = await startServer(); });
after(async () => { await fixture?.close(); });

function expect(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
function tripPath(code, suffix = "") { return `/trips/${code}${suffix}`; }

test("health, request IDs, metrics protection, and API errors", async () => {
  const { request, baseUrl } = fixture;
  const health = await request("/health", { headers: { "X-Request-ID": "release-check" } });
  assert.deepEqual(expect(health, 200), { ok: true });
  assert.equal(health.headers.get("x-request-id"), "release-check");
  expect(await request("/metrics"), 401);
  const metrics = await request("/metrics", { headers: { "X-Metrics-Token": "test-metrics-token" } });
  assert.equal(metrics.status, 200);
  assert.match(metrics.body, /yolo_http_requests_total/);
  assert.match(metrics.body, /yolo_trips/);
  expect(await request("/no-such-route"), 404);
  expect(await request("/trips/ZZZZZZ"), 404);
  const invalidJson = await fetch(`${baseUrl}/api/trips`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  assert.equal(invalidJson.status, 400);
  assert.match((await invalidJson.json()).error, /not valid JSON/);
});

test("trip creation, code lookup, and input limits", async () => {
  const { request } = fixture;
  expect(await request("/trips", { method: "POST", json: { creatorName: "Ada", creatorPin: "1234" } }), 400);
  expect(await request("/trips", { method: "POST", json: { name: "Trip", creatorName: "Ada", creatorPin: "12" } }), 400);
  expect(await request("/trips", { method: "POST", json: { name: "Trip", creatorName: "Ada", creatorPin: "1234", categories: ["food"] } }), 409);
  expect(await request("/trips", { method: "POST", json: { name: "Trip", creatorName: "Ada", creatorPin: "1234", categories: Array.from({ length: 15 }, (_, i) => `Custom ${i}`) } }), 400);
  const trip = await createTrip(request, { name: "  Weekend  ", categories: ["Tickets"] });
  assert.match(trip.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(trip.name, "Weekend");
  assert.equal(expect(await request(tripPath(trip.code.toLowerCase())), 200).id, trip.id);
  const categories = expect(await request(tripPath(trip.code, "/categories")), 200);
  assert.equal(categories.length, 7);
  assert(categories.some((category) => category.name === "Tickets"));
});

test("member sign-in, PIN changes, session reset, and lockout", async () => {
  const { request } = fixture;
  const trip = await createTrip(request);
  const path = tripPath(trip.code);
  const ben = await addMember(request, trip.code, "Ben");
  expect(await request(`${path}/me`), 403);
  expect(await request(`${path}/members`, { method: "POST", json: { name: "ben", pin: "5678" } }), 409);
  expect(await request(`${path}/login`, { method: "POST", json: { name: "Ben", pin: "0000" } }), 403);
  const login = expect(await request(`${path}/login`, { method: "POST", json: { name: "ben", pin: "5678" } }), 200);
  assert.equal(login.id, ben.id);
  assert.equal(expect(await request(`${path}/me`, { token: login.token }), 200).name, "Ben");
  const access = expect(await request(`${path}/me/access`, { token: ben.token }), 200);
  assert.equal(access.hasPin, true);
  assert.equal(access.sessions, 2);
  expect(await request(`${path}/me/pin`, { method: "PUT", token: ben.token, json: { currentPin: "0000", pin: "9999" } }), 403);
  expect(await request(`${path}/me/pin`, { method: "PUT", token: ben.token, json: { currentPin: "5678", pin: "9999" } }), 204);
  expect(await request(`${path}/login`, { method: "POST", json: { name: "Ben", pin: "5678" } }), 403);
  expect(await request(`${path}/login`, { method: "POST", json: { name: "Ben", pin: "9999" } }), 200);
  const reset = expect(await request(`${path}/me/sessions/reset`, { method: "POST", token: ben.token, json: { pin: "9999" } }), 200);
  assert.match(reset.token, /^[a-f0-9]{64}$/);
  expect(await request(`${path}/me`, { token: ben.token }), 403);
  expect(await request(`${path}/me`, { token: login.token }), 403);
  expect(await request(`${path}/me`, { token: reset.token }), 200);
  const cara = await addMember(request, trip.code, "Cara", "2468");
  for (let attempt = 1; attempt <= 5; attempt++) {
    expect(await request(`${path}/login`, { method: "POST", json: { name: cara.name, pin: "0000" } }), attempt === 5 ? 429 : 403);
  }
  expect(await request(`${path}/login`, { method: "POST", json: { name: cara.name, pin: "2468" } }), 429);
});

test("leadership election, leader PIN reset, and member removal", async () => {
  const { request } = fixture;
  const trip = await createTrip(request);
  const path = tripPath(trip.code);
  const ben = await addMember(request, trip.code, "Ben");
  const cara = await addMember(request, trip.code, "Cara", "2468");
  let status = expect(await request(`${path}/leadership`), 200);
  assert.equal(status.leader, null);
  assert.equal(status.requiredVotes, 2);
  expect(await request(`${path}/leadership/candidacy`, { method: "POST", token: trip.creatorToken }), 201);
  expect(await request(`${path}/leadership/candidacy`, { method: "POST", token: trip.creatorToken }), 409);
  expect(await request(`${path}/leadership/candidacy`, { method: "DELETE", token: trip.creatorToken }), 200);
  expect(await request(`${path}/leadership/candidacy`, { method: "POST", token: trip.creatorToken }), 201);
  expect(await request(`${path}/leadership/vote`, { method: "PUT", token: ben.token, json: { candidateId: 999999 } }), 404);
  status = expect(await request(`${path}/leadership/vote`, { method: "PUT", token: ben.token, json: { candidateId: trip.creatorMemberId } }), 200);
  assert.equal(status.leader, null);
  status = expect(await request(`${path}/leadership/vote`, { method: "PUT", token: trip.creatorToken, json: { candidateId: trip.creatorMemberId } }), 200);
  assert.equal(status.leader.member_id, trip.creatorMemberId);
  expect(await request(`${path}/members/${ben.id}/pin`, { method: "PUT", token: cara.token, json: { pin: "8888" } }), 403);
  expect(await request(`${path}/members/${ben.id}/pin`, { method: "PUT", token: trip.creatorToken, json: { pin: "8888" } }), 204);
  expect(await request(`${path}/login`, { method: "POST", json: { name: "Ben", pin: "8888" } }), 200);
  expect(await request(`${path}/members/${cara.id}`, { method: "DELETE", token: trip.creatorToken }), 204);
  assert.equal(expect(await request(`${path}/members`), 200).length, 2);
  expect(await request(`${path}/me`, { token: cara.token }), 403);
});

test("category management and category use in expenses", async () => {
  const { request } = fixture;
  const trip = await createTrip(request, { categories: ["Tickets"] });
  const path = tripPath(trip.code);
  const defaults = expect(await request(`${path}/categories`), 200);
  expect(await request(`${path}/categories/${defaults[0].id}`, { method: "DELETE", token: trip.creatorToken }), 409);
  expect(await request(`${path}/categories`, { method: "POST", json: { name: "Fuel" } }), 403);
  const fuel = expect(await request(`${path}/categories`, { method: "POST", token: trip.creatorToken, json: { name: "Fuel" } }), 201);
  expect(await request(`${path}/categories`, { method: "POST", token: trip.creatorToken, json: { name: "fuel" } }), 409);
  expect(await request(`${path}/expenses`, { method: "POST", token: trip.creatorToken, json: { description: "Petrol", amount: 12, category: "Fuel" } }), 201);
  expect(await request(`${path}/categories/${fuel.id}`, { method: "DELETE", token: trip.creatorToken }), 409);
  const tickets = defaults.find((category) => category.name === "Tickets");
  expect(await request(`${path}/categories/${tickets.id}`, { method: "DELETE", token: trip.creatorToken }), 204);
  for (let i = 0; i < 13; i++) expect(await request(`${path}/categories`, { method: "POST", token: trip.creatorToken, json: { name: `Extra ${i}` } }), 201);
  expect(await request(`${path}/categories`, { method: "POST", token: trip.creatorToken, json: { name: "Too many" } }), 409);
});

test("contributions, expenses, list views, and financial summary", async () => {
  const { request } = fixture;
  const trip = await createTrip(request);
  const ben = await addMember(request, trip.code, "Ben");
  const path = tripPath(trip.code);
  expect(await request(`${path}/contributions`, { method: "POST", json: { memberId: trip.creatorMemberId, amount: 100 } }), 403);
  expect(await request(`${path}/contributions`, { method: "POST", token: trip.creatorToken, json: { memberId: trip.creatorMemberId, amount: -1 } }), 400);
  expect(await request(`${path}/contributions`, { method: "POST", token: trip.creatorToken, json: { memberId: 999999, amount: 10 } }), 404);
  const adaPaid = expect(await request(`${path}/contributions`, { method: "POST", token: trip.creatorToken, json: { memberId: trip.creatorMemberId, amount: 100, note: "Deposit" } }), 201);
  const benPaid = expect(await request(`${path}/contributions`, { method: "POST", token: ben.token, json: { memberId: ben.id, amount: 50 } }), 201);
  expect(await request(`${path}/expenses`, { method: "POST", token: trip.creatorToken, json: { description: "Meal", amount: 30, category: "Missing" } }), 400);
  const expense = expect(await request(`${path}/expenses`, { method: "POST", token: trip.creatorToken, json: { description: "Meal", amount: 30, category: "Food", paidBy: trip.creatorMemberId } }), 201);
  assert.equal(expect(await request(`${path}/contributions`), 200).length, 2);
  assert.equal(expect(await request(`${path}/expenses`), 200)[0].paid_by_name, "Ada");
  const summary = expect(await request(`${path}/summary`), 200);
  assert.equal(summary.targetTotal, 200);
  assert.equal(summary.totalCollected, 150);
  assert.equal(summary.totalSpent, 30);
  assert.equal(summary.balance, 120);
  assert.equal(summary.perMember.find((member) => member.id === ben.id).owed, 50);
  expect(await request(`${path}/expenses/${expense.id}`, { method: "DELETE", token: trip.creatorToken }), 204);
  expect(await request(`${path}/contributions/${benPaid.id}`, { method: "DELETE", token: ben.token }), 204);
  assert.equal(expect(await request(`${path}/summary`), 200).balance, 100);
  expect(await request(`${path}/contributions/${adaPaid.id}`, { method: "DELETE", token: trip.creatorToken }), 204);
});

test("notes, priority limit, and author ownership", async () => {
  const { request } = fixture;
  const trip = await createTrip(request);
  const ben = await addMember(request, trip.code, "Ben");
  const path = tripPath(trip.code);
  expect(await request(`${path}/notes`, { method: "POST", token: trip.creatorToken, json: { content: " " } }), 400);
  const note = expect(await request(`${path}/notes`, { method: "POST", token: trip.creatorToken, json: { content: "  Bring a map  " } }), 201);
  assert.equal(note.content, "Bring a map");
  expect(await request(`${path}/notes/${note.id}`, { method: "DELETE", token: ben.token }), 403);
  for (let i = 0; i < 10; i++) expect(await request(`${path}/notes`, { method: "POST", token: ben.token, json: { content: `Priority ${i}`, priority: true } }), 201);
  expect(await request(`${path}/notes`, { method: "POST", token: ben.token, json: { content: "Eleventh", priority: true } }), 409);
  assert.equal(expect(await request(`${path}/notes`), 200).filter((item) => item.is_priority).length, 10);
  expect(await request(`${path}/notes/${note.id}`, { method: "DELETE", token: trip.creatorToken }), 204);
});

test("saved chat, authorization, validation, and message cursors", async () => {
  const { request } = fixture;
  const trip = await createTrip(request);
  const ben = await addMember(request, trip.code, "Ben");
  const path = tripPath(trip.code, "/messages");
  expect(await request(path), 403);
  expect(await request(path, { method: "POST", json: { text: "Guest" } }), 403);
  expect(await request(path, { method: "POST", token: trip.creatorToken, json: { text: " " } }), 400);
  expect(await request(path, { method: "POST", token: trip.creatorToken, json: { text: "x".repeat(1001) } }), 400);
  const first = expect(await request(path, { method: "POST", token: trip.creatorToken, json: { text: "  Hello crew  " } }), 201);
  assert.equal(first.text, "Hello crew");
  assert.equal(expect(await request(path, { token: ben.token }), 200)[0].text, "Hello crew");
  for (let i = 0; i < 104; i++) expect(await request(path, { method: "POST", token: ben.token, json: { text: `Update ${i}` } }), 201);
  const latest = expect(await request(path, { token: trip.creatorToken }), 200);
  assert.equal(latest.length, 100);
  assert.equal(latest[0].text, "Update 4");
  const older = expect(await request(`${path}?before=${latest[0].id}`, { token: trip.creatorToken }), 200);
  assert.equal(older.length, 5);
  assert.equal(older[0].id, first.id);
  assert.equal(expect(await request(`${path}?after=${latest.at(-1).id}`, { token: trip.creatorToken }), 200).length, 0);
  expect(await request(`${path}?before=3&after=4`, { token: trip.creatorToken }), 400);
});

test("members and saved messages survive a backend restart", async () => {
  const first = await startServer();
  let second;
  try {
    const trip = await createTrip(first.request);
    const ben = await addMember(first.request, trip.code, "Ben");
    expect(await first.request(tripPath(trip.code, "/messages"), {
      method: "POST", token: ben.token, json: { text: "See you tomorrow" },
    }), 201);
    await first.close({ preserveFiles: true });
    second = await startServer({ directory: first.directory });
    const login = expect(await second.request(tripPath(trip.code, "/login"), {
      method: "POST", json: { name: "Ben", pin: "5678" },
    }), 200);
    assert.equal(login.id, ben.id);
    assert.equal(expect(await second.request(tripPath(trip.code, "/messages"), { token: login.token }), 200)[0].text, "See you tomorrow");
    assert.equal(expect(await second.request(tripPath(trip.code, "/live")), 200).members.length, 0);
  } finally {
    if (second) await second.close();
    else await first.close();
  }
});

test("online roster, WebRTC signaling, and leave", async () => {
  const { request } = fixture;
  const trip = await createTrip(request);
  const ben = await addMember(request, trip.code, "Ben");
  const path = tripPath(trip.code, "/live");
  const adaPeer = randomUUID();
  const benPeer = randomUUID();
  expect(await request(path, { method: "POST", json: { peerId: adaPeer } }), 403);
  expect(await request(path, { method: "POST", token: trip.creatorToken, json: { peerId: "bad" } }), 400);
  assert.equal(expect(await request(path, { method: "POST", token: trip.creatorToken, json: { peerId: adaPeer } }), 200).members.length, 1);
  assert.equal(expect(await request(path, { method: "POST", token: ben.token, json: { peerId: benPeer } }), 200).members.length, 2);
  expect(await request(path, { method: "POST", token: ben.token, json: { peerId: adaPeer } }), 409);
  assert.equal(expect(await request(path), 200).members.length, 2);
  const signal = { from: adaPeer, to: benPeer, type: "offer", data: { type: "offer", sdp: "test" } };
  expect(await request(`${path}/signal`, { method: "POST", token: ben.token, json: signal }), 403);
  expect(await request(`${path}/signal`, { method: "POST", token: trip.creatorToken, json: { ...signal, type: "invalid" } }), 400);
  expect(await request(`${path}/signal`, { method: "POST", token: trip.creatorToken, json: signal }), 204);
  assert.equal(expect(await request(path, { method: "POST", token: ben.token, json: { peerId: benPeer } }), 200).signals.length, 1);
  assert.equal(expect(await request(path, { method: "POST", token: ben.token, json: { peerId: benPeer } }), 200).signals.length, 0);
  expect(await request(`${path}/${adaPeer}`, { method: "DELETE", token: trip.creatorToken }), 204);
  assert.equal(expect(await request(path), 200).members.length, 1);
});

test("completion vote locks writes and produces a PDF report", async () => {
  const { request } = fixture;
  const trip = await createTrip(request);
  const ben = await addMember(request, trip.code, "Ben");
  await addMember(request, trip.code, "Cara", "2468");
  const path = tripPath(trip.code);
  expect(await request(`${path}/report.pdf`), 409);
  const category = expect(await request(`${path}/categories`, { method: "POST", token: trip.creatorToken, json: { name: "Tickets" } }), 201);
  const note = expect(await request(`${path}/notes`, { method: "POST", token: trip.creatorToken, json: { content: "Go early" } }), 201);
  const contribution = expect(await request(`${path}/contributions`, { method: "POST", token: trip.creatorToken, json: { memberId: trip.creatorMemberId, amount: 100 } }), 201);
  const expense = expect(await request(`${path}/expenses`, { method: "POST", token: trip.creatorToken, json: { description: "Bus", amount: 10, category: "Transport" } }), 201);
  expect(await request(`${path}/completion/vote`, { method: "PUT", token: ben.token, json: { memberId: trip.creatorMemberId, vote: true } }), 403);
  let vote = expect(await request(`${path}/completion/vote`, { method: "PUT", token: trip.creatorToken, json: { memberId: trip.creatorMemberId, vote: true } }), 200);
  assert.equal(vote.completed, false);
  vote = expect(await request(`${path}/completion/vote`, { method: "PUT", token: trip.creatorToken, json: { memberId: trip.creatorMemberId, vote: false } }), 200);
  assert.equal(vote.yesVotes, 0);
  expect(await request(`${path}/completion/vote`, { method: "PUT", token: ben.token, json: { memberId: ben.id, vote: true } }), 200);
  vote = expect(await request(`${path}/completion/vote`, { method: "PUT", token: trip.creatorToken, json: { memberId: trip.creatorMemberId, vote: true } }), 200);
  assert.equal(vote.completed, true);
  assert.equal(expect(await request(`${path}/completion`), 200).yesVotes, 2);
  const report = await request(`${path}/report.pdf`);
  assert.equal(report.status, 200);
  assert.equal(report.headers.get("content-type"), "application/pdf");
  assert.equal(report.body.subarray(0, 4).toString(), "%PDF");
  assert(report.body.length > 1000);
  const blockedWrites = [
    ["POST", "/members", { name: "Dan", pin: "1357" }],
    ["POST", "/categories", { name: "New" }],
    ["POST", "/contributions", { memberId: trip.creatorMemberId, amount: 1 }],
    ["POST", "/expenses", { description: "New", amount: 1, category: "Food" }],
    ["POST", "/notes", { content: "New" }],
    ["POST", "/messages", { text: "New" }],
    ["POST", "/leadership/candidacy", {}],
    ["PUT", "/completion/vote", { memberId: trip.creatorMemberId, vote: false }],
  ];
  for (const [method, suffix, json] of blockedWrites) {
    expect(await request(`${path}${suffix}`, { method, token: trip.creatorToken, json }), 409);
  }
  for (const suffix of [`/categories/${category.id}`, `/contributions/${contribution.id}`, `/expenses/${expense.id}`, `/notes/${note.id}`]) {
    expect(await request(`${path}${suffix}`, { method: "DELETE", token: trip.creatorToken }), 409);
  }
  assert.equal(expect(await request(`${path}/messages`, { token: trip.creatorToken }), 200).length, 0);
});
