// Use integer minor units so every split adds up to the expense exactly.
export function minorUnits(value, label = "Amount") {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new Error(`${label} is required.`);
  }
  const number = Number(value);
  const units = Math.round(number * 100);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(units) || units > 1e12 || Math.abs(number * 100 - units) > 0.0001) {
    throw new Error(`${label} must be a non-negative number with at most two decimal places.`);
  }
  return units;
}

export function allocate(total, entries, mode, members) {
  const cents = minorUnits(total);
  if (!cents) throw new Error("Enter a positive expense amount.");
  if (!["equal", "amounts", "percentages"].includes(mode)) throw new Error("Choose a valid split method.");
  if (!Array.isArray(entries) || !entries.length) throw new Error("Select at least one member.");
  const seen = new Set();
  const rows = entries.map((entry) => {
    const member = members.find((m) => m.id === Number(entry?.memberId));
    if (!member || seen.has(member.id)) throw new Error("Select distinct members from this trip.");
    seen.add(member.id);
    return { memberId: member.id, name: member.name, value: entry.value };
  });
  let amounts;
  if (mode === "amounts") {
    amounts = rows.map((row) => minorUnits(row.value, `${row.name}'s amount`));
    if (amounts.reduce((a, b) => a + b, 0) !== cents) throw new Error("Member amounts must add up to the expense total.");
  } else {
    const weights = mode === "equal" ? rows.map(() => 1) : rows.map((row) => minorUnits(row.value, `${row.name}'s percentage`));
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    if (mode === "percentages" && weightTotal !== 10000) throw new Error("Member percentages must add up to 100%.");
    const exact = weights.map((weight) => cents * (weight / weightTotal));
    amounts = exact.map(Math.floor);
    const order = exact.map((value, index) => ({ index, remainder: value - amounts[index] }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    const left = cents - amounts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < left; i++) amounts[order[i].index]++;
  }
  return rows.map((row, index) => ({ memberId: row.memberId, name: row.name, amount: amounts[index] / 100,
    ...(mode === "percentages" ? { percentage: Number(row.value) } : {}) }));
}
