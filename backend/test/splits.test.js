import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, minorUnits } from "../../shared/splits.js";

const members = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Cara" }];
const entries = members.map((m) => ({ memberId: m.id }));

test("equal splits distribute cents and retain only selected members", () => {
  assert.deepEqual(allocate(10, entries, "equal", members).map((r) => r.amount), [3.34, 3.33, 3.33]);
  assert.deepEqual(allocate(10, entries.slice(1), "equal", members).map((r) => r.memberId), [2, 3]);
  for (let cents = 1; cents < 400; cents++) {
    const rows = allocate(cents / 100, entries, "equal", members);
    assert.equal(rows.reduce((sum, row) => sum + minorUnits(row.amount), 0), cents);
    assert.ok(Math.max(...rows.map((r) => minorUnits(r.amount))) - Math.min(...rows.map((r) => minorUnits(r.amount))) <= 1);
  }
});

test("percentage and exact splits conserve cents", () => {
  const rows = allocate(10.01, [{ memberId: 1, value: 33.33 }, { memberId: 2, value: 66.67 }], "percentages", members);
  assert.deepEqual(rows.map((r) => r.amount), [3.34, 6.67]);
  assert.equal(rows[0].percentage, 33.33);
  assert.deepEqual(allocate(10.01, [{ memberId: 1, value: 2 }, { memberId: 3, value: 8.01 }], "amounts", members).map((r) => r.amount), [2, 8.01]);
});

test("reject invalid totals, duplicates, foreign members, and invalid amounts", () => {
  for (const amount of [NaN, Infinity, -1, 0, "", null, true, 1.001]) assert.throws(() => allocate(amount, entries, "equal", members));
  assert.throws(() => allocate(10, [], "equal", members));
  assert.throws(() => allocate(10, [{ memberId: 1 }, { memberId: 1 }], "equal", members));
  assert.throws(() => allocate(10, [{ memberId: 9 }], "equal", members));
  assert.throws(() => allocate(10, [{ memberId: 1, value: 99.99 }], "percentages", members));
  assert.throws(() => allocate(10, [{ memberId: 1, value: 9.99 }], "amounts", members));
  assert.throws(() => allocate(10, [{ memberId: 1, value: "" }], "amounts", members));
  assert.throws(() => allocate(10, entries, "unknown", members));
});
