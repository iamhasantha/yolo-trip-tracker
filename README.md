# YOLO — Trip Budget Tracker

Vue 3 + Node/Express + SQLite. One person creates a trip and collects a fixed
amount from each traveler; everyone joins with a **YOLO code** (no accounts,
no passwords) to log contributions, log expenses, and see a live budget
breakdown.

## Structure

```
yolo-trip-tracker/
├── backend/        Express API + SQLite (better-sqlite3)
│   ├── server.js
│   ├── db.js       schema, auto-created on first run
│   └── yolo.db      created at runtime (gitignored)
└── frontend/       Vue 3 + Vite SPA
    └── src/
```

## Run it locally

**Backend** (port 4000):
```bash
cd backend
npm install
npm run dev
```

**Frontend** (port 5173, proxies /api to the backend):
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — create a trip, copy the YOLO code, open it in
another browser/incognito tab and join as a different member to see it update.

## How the YOLO code works

- On trip creation the server generates a 6-character code (excludes
  ambiguous characters like `0/O`, `1/I`) and stores it as the trip's unique
  key.
- Anyone with the code can `GET /api/trips/:code`, add themselves as a
  member, and post contributions/expenses. There's no password — the code
  *is* the access control, by design (matches "just putting the name, no
  sign in").
- If you want a bit more privacy, you can trivially extend `trips.code` to
  a longer nanoid (e.g. 10 chars) — see `genCode` in `backend/server.js`.

## Data model

- `trips` — name, currency, fixed target amount per person, YOLO code
- `members` — name only, tied to a trip
- `contributions` — money a member has paid into the pot
- `expenses` — money spent from the pot, optionally attributed to whoever
  paid for it, with a category
- `/api/trips/:code/summary` computes the whole breakdown server-side:
  total collected vs. target, total spent, balance, per-member paid/owed
  status, and spend by category — the frontend just renders it.

## Environment variables (backend)

| Variable  | Default              | Purpose                                   |
|-----------|----------------------|--------------------------------------------|
| `PORT`    | `4000`               | API port                                   |
| `DB_PATH` | `./yolo.db`          | Where the SQLite file lives — **point this at a persistent volume in production** |

See `DEPLOYMENT.md` for hosting options at minimal/zero cost.
