# YOLO — Trip Budget Tracker

Vue 3 + Node/Express + SQLite. One person creates a trip and collects a fixed
amount from each traveler; everyone joins with a **YOLO code** and a member
PIN to log contributions, log expenses, share sticky notes, and see a
live budget breakdown. Visitors with a code can read the trip without joining.

The dashboard also shows signed-in members who currently have the trip open.
Members can use the Chat tab to send messages that are saved in the trip database,
so existing and offline members can read them later. When browsers establish a
WebRTC data channel, they also deliver new messages directly for quicker display;
the chat still works if that connection cannot be made. The API exchanges WebRTC
signals and tracks presence in memory. Presence expires about 45 seconds after
a browser stops checking in. WebRTC needs HTTPS or localhost, and some networks
may need a TURN server for direct connections; the server-backed chat works
without one. Completed trips keep chat history read-only. Use one backend
process for presence and signaling, as in the single-process deployment below.

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
├── shared/         Currency-safe expense split calculations
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

## Production checks

Install dependencies and run the suite from the repository root:

```bash
npm --prefix backend ci
npm --prefix frontend ci
npm test
```

The test command builds the
frontend, runs HTTP integration tests against a real backend with a temporary
SQLite database, and runs a headless Chrome test of existing-member sign-in,
online presence, WebRTC peer connection, chat, and the dashboard workflow. The
suite checks trip creation, member access and
PIN lockout, leadership, categories, contributions, expenses, notes, saved
messages, WebRTC signaling, completion locking, PDF reports, metrics, and API
errors. It never writes to `backend/yolo.db`.

The browser test needs Chrome or Chromium; set `CHROME_BIN` if it is not on your `PATH`.
Use `npm run test:api` or `npm run test:browser` to run one part of the suite.

## How the YOLO code works

- On trip creation the server generates a 6-character code (excludes
  ambiguous characters like `0/O`, `1/I`) and stores it as the trip's unique
  key.
- Anyone with the code can read trip data. Creating or joining a trip issues a
  private member token saved in that browser; API writes require that token.
  New members set a 4-digit PIN. To use another browser, choose **Existing
  member** on the join page and enter the trip code, name, and PIN. Each
  browser receives its own token.
- Members who joined before PIN support can open the gear icon in the trip
  navigation, go to **Settings**, and set a PIN from their signed-in browser.
  **Reset access tokens** there revokes
  that member's old browser tokens and gives the current browser a fresh one;
  it does not delete the trip or any trip records. Five failed PIN attempts
  lock sign-in for 15 minutes.
- If a member loses their last signed-in browser before setting a PIN, there is
  no secure self-service recovery with the current data model.
- If you want a bit more privacy, you can trivially extend `trips.code` to
  a longer nanoid (e.g. 10 chars) — see `genCode` in `backend/server.js`.

## Data model

- `trips` — name, currency, fixed target amount per person, YOLO code
- `members` — display name, tied to a trip
- `contributions` — money a member has paid into the pot
- `expenses` — categorized spending paid from the common pot or by one or more
  members. `allocations_json` stores the selected payers and beneficiaries,
  their amounts, split methods, and entered percentages.
- `trip_categories` — six starting categories plus custom categories per trip,
  capped at 20 total. Members can manage unused custom categories in the
  Categories tab; guests can view them. Existing expense categories are kept
  when older databases are upgraded.
- `completion_votes` — one completion vote per trip member
- `notes` — shared sticky notes with author names, timestamps, and an optional
  priority flag that features them in the dashboard hero slideshow. Notes are
  limited to 500 characters, with at most 10 priority notes per trip.
- `member_sessions` — hashed tokens for each signed-in browser
- `trip_messages` — saved member chat messages for each trip
- `member_pins` — salted PIN hashes and failed-attempt lockout state
- `/api/trips/:code/summary` computes the whole breakdown server-side:
  total collected vs. target, total spent, balance, per-member paid/owed
  status, direct payments, expense shares, net balances, and spend by category.
  Pot balance deducts only common-pot expenses; direct payments are tracked separately.

## Expense splits

In Expenses, choose **Common pot** or **One or more members**, then select the
members under **Paid by** and **Split between**. Each group independently supports
equal splits, exact amounts, or percentages. Exact amounts must total the expense;
percentages must total 100%. Amounts support two decimal places, and rounding cents
are distributed so the allocations always match the total.

Member contribution progress counts money paid into the pot plus their direct
expense payments. Each payer receives credit for their own payment allocation;
beneficiaries do not receive contribution credit just for sharing an expense.
Removing an expense also removes its direct-payment credit. Direct payments do
not create pot deposits or duplicate contribution ledger entries.

Expenses and Breakdown include a spending chart with views for who paid most,
spending by category, and the five largest expenses. The final PDF includes all
three charts and contribution target progress using the same calculations.

Net balance is contributions plus direct payments minus allocated expense shares.
A positive balance means money back; a negative balance means money due. The final
PDF includes these balances and each expense's full payment and share details.

Older expenses are migrated automatically: their original payer is retained, and
their costs are shared equally among the members present at upgrade time. Member
selections are saved with the expense, so later joins do not change past shares.
Members included in expense allocations cannot be removed until those expenses
are removed. Keep `shared/` alongside `backend/` when deploying the API.

Run expense calculation and API regression checks with `npm test --prefix backend`.

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
