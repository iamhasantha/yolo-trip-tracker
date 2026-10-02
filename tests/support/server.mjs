import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backendDir = path.join(root, "backend");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function startServer({ directory: existingDirectory } = {}) {
  const directory = existingDirectory || await mkdtemp(path.join(os.tmpdir(), "yolo-test-"));
  const dbPath = path.join(directory, "trip.db");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, LOG_LEVEL: "error", METRICS_TOKEN: "test-metrics-token" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => { output = (output + chunk.toString()).slice(-8000); });
  }

  async function close({ preserveFiles = false } = {}) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    if (!preserveFiles) await rm(directory, { recursive: true, force: true });
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) });
        if (response.ok) { ready = true; break; }
      } catch { /* Wait for startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`Backend did not start. ${output}`);
  } catch (error) {
    await close();
    throw error;
  }

  async function request(route, { method = "GET", token, json, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}/api${route}`, {
      method,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const contentType = response.headers.get("content-type") || "";
    const body = response.status === 204 ? null
      : contentType.includes("application/json") ? await response.json()
      : contentType.includes("application/pdf") ? Buffer.from(await response.arrayBuffer())
      : await response.text();
    return { status: response.status, body, headers: response.headers };
  }

  return { baseUrl, dbPath, directory, child, close, request };
}

export async function createTrip(request, overrides = {}) {
  const result = await request("/trips", {
    method: "POST",
    json: { name: "Test trip", currency: "LKR", targetAmount: 100, creatorName: "Ada", creatorPin: "1234", ...overrides },
  });
  if (result.status !== 201) throw new Error(`Could not create test trip: ${JSON.stringify(result.body)}`);
  return result.body;
}

export async function addMember(request, code, name, pin = "5678") {
  const result = await request(`/trips/${code}/members`, { method: "POST", json: { name, pin } });
  if (result.status !== 201) throw new Error(`Could not add test member: ${JSON.stringify(result.body)}`);
  return result.body;
}
