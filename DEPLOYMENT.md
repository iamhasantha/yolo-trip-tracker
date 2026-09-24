# Deploying YOLO for (close to) free

The only real constraint: **SQLite is a file on disk**, so wherever you run
the backend needs a *persistent* disk — not a stateless/serverless function
that wipes its filesystem on every request (rules out plain Vercel/Netlify
functions for the API). Three ways to get that, cheapest first.

---

## Option A — Free forever: Oracle Cloud "Always Free" VM (recommended)

Oracle's Always Free tier includes a small ARM VM (1 OCPU / 6GB RAM is
comfortably enough) that never expires and costs **$0/month**. You run the
whole app — frontend + backend — as one Node process on one port.

1. **Create the VM**: sign up at oracle.com/cloud/free, launch an
   "Always Free" Ampere A1 instance (Ubuntu 22.04), open port 80/443 (and
   optionally 22 for SSH) in the VM's security list.
2. **Install Node** on the VM:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
   sudo apt-get install -y nodejs
   ```
3. **Ship your code** (git clone, or `scp` the folder) to `/opt/yolo`.
4. **Build once**:
   ```bash
   cd /opt/yolo/frontend && npm install && npm run build
   cd /opt/yolo/backend && npm install
   ```
5. **Point SQLite at a real path and run it**:
   ```bash
   export DB_PATH=/opt/yolo/data/yolo.db
   mkdir -p /opt/yolo/data
   PORT=80 node server.js
   ```
   Because `backend/server.js` serves `frontend/dist` automatically when it
   exists, this single process is the entire app.
6. **Keep it alive** with a tiny systemd unit (or `pm2 start server.js`):
   ```ini
   # /etc/systemd/system/yolo.service
   [Service]
   WorkingDirectory=/opt/yolo/backend
   Environment=PORT=80 DB_PATH=/opt/yolo/data/yolo.db
   ExecStart=/usr/bin/node server.js
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
7. **HTTPS**: put [Caddy](https://caddyserver.com/) in front (it gets you a
   free Let's Encrypt certificate automatically) — install it, point it at
   your domain, and set `reverse_proxy localhost:80` (move the app to
   another port like 4000 and let Caddy own 80/443).
8. **Back up `yolo.db` occasionally** (it's one file — `cp` it or sync it to
   object storage) since it's the only thing that isn't reproducible.

**Cost: $0/month.** Trade-off: you're managing a VM (updates, restarts).

---

## Option B — Fly.io (a few dollars a month, less setup)

Fly.io runs your container close to users and supports small persistent
**volumes**, which is exactly what SQLite needs.

1. `flyctl launch` from the repo root (it detects the Dockerfile below).
2. Add a 1GB volume: `flyctl volumes create yolo_data --size 1`.
3. In `fly.toml`, mount it and point `DB_PATH` at it:
   ```toml
   [mounts]
     source = "yolo_data"
     destination = "/data"

   [env]
     DB_PATH = "/data/yolo.db"
   ```
4. `flyctl deploy`.

A minimal `Dockerfile` (add at the repo root):
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY frontend ./frontend
RUN cd frontend && npm install && npm run build
COPY backend ./backend
RUN cd backend && npm install --omit=dev
WORKDIR /app/backend
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]
```

**Cost:** roughly $1.50–$3/month (a shared-cpu-1x machine plus a small
volume) once you're past the trial credit — cheapest managed option if you'd
rather not run a VM yourself.

---

## Option C — Split hosting (frontend free, backend cheap)

If you'd like the frontend on a CDN for free:
- Deploy `frontend/dist` to **Cloudflare Pages** or **Netlify** (free tier,
  static hosting).
- Deploy just `backend/` to **Railway** or **Fly.io** with a persistent
  volume for `yolo.db` (Railway's hobby plan is $5/month usage credit).
- In `frontend/vite.config.js`, the dev proxy only applies locally — for a
  split deployment, change `src/api.js`'s `BASE` to your backend's public
  URL (e.g. `https://yolo-api.fly.dev/api`) and enable CORS for your
  frontend's origin (already permissive here via the `cors` package; lock
  it down to your domain with `cors({ origin: "https://yourapp.pages.dev" })`
  before going live).

This adds moving parts for not much savings over Option A, so it's mainly
useful if you want the frontend on a custom CDN domain independent of the
backend.

---

## Recommendation

For a trip-planning tool used by a group of friends: **Option A (Oracle Free
VM)** — it's genuinely free indefinitely and the whole app is one Node
process, one SQLite file, one systemd unit. Reach for Fly.io only if you'd
rather not manage a VM at all.

## Before going live, either way

- Change `cors()` to restrict `origin` to your real domain.
- Consider lengthening the YOLO code (`genCode` in `backend/server.js`) from
  6 to 8–10 characters if you're worried about someone guessing a live
  trip's code.
- Take a backup of `yolo.db` before any redeploy that touches the volume/VM.
