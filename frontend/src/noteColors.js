const colors = ["yellow", "pink", "blue", "green", "lavender"];

function preferredColor(key) {
  let hash = 2166136261;
  for (const character of String(key)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % colors.length;
}

export function colorNotes(notes, columns, tripCode) {
  const width = Math.max(1, columns);
  const assigned = [];

  return notes.map((note, index) => {
    const row = Math.floor(index / width);
    const column = index % width;
    const neighbors = [];
    if (column > 0) neighbors.push(index - 1);
    if (row > 0) {
      if (column > 0) neighbors.push(index - width - 1);
      neighbors.push(index - width);
      if (column < width - 1) neighbors.push(index - width + 1);
    }
    const used = new Set(neighbors.map((neighbor) => assigned[neighbor]));
    const preferred = preferredColor(`${tripCode}:${note.id}`);
    const chosen = Array.from({ length: colors.length }, (_, offset) => colors[(preferred + offset) % colors.length])
      .find((candidate) => !used.has(candidate));
    assigned.push(chosen);
    return { ...note, color: chosen };
  });
}

export function layoutNotesInColumns(notes, columnCount, tripCode, columnWidth = 230) {
  const palettes = [
    ["yellow", "pink"],
    ["blue", "green"],
    ["lavender", "peach"],
  ];
  const count = Math.max(1, Math.min(palettes.length, columnCount));
  const columns = Array.from({ length: count }, () => ({ notes: [], estimatedHeight: 0, startColor: 0 }));
  const charactersPerLine = Math.max(20, Math.floor(columnWidth / 8.5));

  for (const note of notes) {
    const shortest = columns.reduce((best, column, index) =>
      column.estimatedHeight < columns[best].estimatedHeight ? index : best, 0);
    const column = columns[shortest];
    if (column.notes.length === 0) column.startColor = preferredColor(`${tripCode}:${note.id}`) % 2;
    const color = palettes[shortest][(column.startColor + column.notes.length) % 2];
    column.notes.push({ ...note, color });

    const lines = String(note.content).split("\n").reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0
    );
    column.estimatedHeight += Math.max(135, 76 + lines * 24 + (note.is_priority ? 26 : 0)) + 18;
  }

  return columns.map((column) => column.notes);
}
