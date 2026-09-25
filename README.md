# YOLO — Trip Budget Tracker

Vue 3 + Node/Express + SQLite. One person creates a trip and collects a fixed
amount from each traveler; everyone joins with a **YOLO code** (no accounts,
no passwords) to log contributions, log expenses, share sticky notes, and see a
live budget breakdown. Visitors with a code can read the trip without joining.

Trips are completed by member vote. Each current member can vote once, and the
trip is automatically locked when at least 50% of members have voted to finish.
The completed dashboard provides a downloadable A4 PDF with totals, contribution
and category charts, member settlement figures, and full contribution/expense ledgers.

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
- Anyone with the code can read trip data. Creating or joining a trip issues a
  private member token saved in that browser; API writes require that token.
  Guests can join with a new name to start contributing. This is a lightweight
  member session, not a password based account: access from another device
  requires joining there with a different name.
- Members created before this token based change do not have a saved token.
  They will see the guest view and need to join again under a new name.
- If you want a bit more privacy, you can trivially extend `trips.code` to
  a longer nanoid (e.g. 10 chars) — see `genCode` in `backend/server.js`.

## Data model

- `trips` — name, currency, fixed target amount per person, YOLO code
- `members` — name only, tied to a trip
- `contributions` — money a member has paid into the pot
- `expenses` — money spent from the pot, optionally attributed to whoever
  paid for it, with a category
- `completion_votes` — one completion vote per trip member
- `notes` — shared sticky notes with author names, timestamps, and an optional
  priority flag that features them in the dashboard hero slideshow. Notes are
  limited to 500 characters, with at most 10 priority notes per trip.
- `member_sessions` — hashed member tokens used to protect writes
- `/api/trips/:code/summary` computes the whole breakdown server-side:
  total collected vs. target, total spent, balance, per-member paid/owed
  status, and spend by category — the frontend just renders it.

## Environment variables (backend)

| Variable  | Default              | Purpose                                   |
|-----------|----------------------|--------------------------------------------|
| `PORT`    | `4000`               | API port                                   |
| `DB_PATH` | `./yolo.db`          | Where the SQLite file lives — **point this at a persistent volume in production** |
| `LOG_LEVEL` | `info`             | Structured JSON log level (`debug`, `info`, `warn`, or `error`) |
| `METRICS_TOKEN` | unset          | Optional bearer or `X-Metrics-Token` value protecting `/api/metrics` |

## Observability

- Every request receives an `X-Request-ID`; callers may supply their own value to
  correlate frontend, proxy, and backend logs.
- HTTP and business audit logs are emitted as structured JSON. Authentication
  headers, cookies, metrics tokens, and request bodies are not logged.
- Prometheus metrics are exposed at `GET /api/metrics`, including request counts,
  latency histograms, in-flight requests, domain mutations, completion votes,
  report outcomes, report generation latency, process metrics, and trip status.
- Set `METRICS_TOKEN` in production and scrape with either
  `Authorization: Bearer <token>` or `X-Metrics-Token: <token>`.

See `DEPLOYMENT.md` for hosting options at minimal/zero cost.
