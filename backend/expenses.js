import { db } from "./db.js";

export function listExpenses(tripId) {
  return db.prepare(`SELECT e.*, m.name AS paid_by_name FROM expenses e
    LEFT JOIN members m ON m.id = e.paid_by
    WHERE e.trip_id = ? ORDER BY e.created_at DESC, e.id DESC`).all(tripId).map((row) => {
    const { allocations_json, ...expense } = row;
    return { ...expense, ...JSON.parse(allocations_json) };
  });
}
