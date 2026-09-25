import { randomUUID } from "crypto";
import pino from "pino";
import pinoHttp from "pino-http";
import client from "prom-client";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    service: "yolo-trip-tracker",
    environment: process.env.NODE_ENV || "development",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-metrics-token']",
      "err.body",
      "body",
      "password",
      "token",
    ],
    censor: "[REDACTED]",
  },
});

export const requestLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const suppliedId = req.headers["x-request-id"];
    const requestId = typeof suppliedId === "string" && suppliedId.length <= 128
      ? suppliedId
      : randomUUID();
    res.setHeader("X-Request-ID", requestId);
    return requestId;
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        // Trip codes act as access credentials, so keep them out of logs.
        url: req.url?.replace(/(\/api\/trips\/)[^/?]+/i, "$1:code"),
        remoteAddress: req.remoteAddress,
        userAgent: req.headers?.["user-agent"],
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
  customLogLevel(_req, res, error) {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  autoLogging: {
    ignore: (req) => req.url === "/api/health" || req.url === "/api/metrics",
  },
});

export const register = new client.Registry();
register.setDefaultLabels({ service: "yolo-trip-tracker" });
client.collectDefaultMetrics({ register, prefix: "yolo_process_" });

export const httpRequestsTotal = new client.Counter({
  name: "yolo_http_requests_total",
  help: "Total HTTP requests handled by the service.",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: "yolo_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const httpRequestsInFlight = new client.Gauge({
  name: "yolo_http_requests_in_flight",
  help: "Number of HTTP requests currently being processed.",
  registers: [register],
});

export const domainEventsTotal = new client.Counter({
  name: "yolo_domain_events_total",
  help: "Business-domain changes performed by the application.",
  labelNames: ["entity", "operation"],
  registers: [register],
});

export const completionVotesTotal = new client.Counter({
  name: "yolo_completion_votes_total",
  help: "Completion voting actions and their resulting state.",
  labelNames: ["action", "result"],
  registers: [register],
});

export const reportsTotal = new client.Counter({
  name: "yolo_reports_total",
  help: "Final trip PDF report requests by outcome.",
  labelNames: ["outcome"],
  registers: [register],
});

export const reportDuration = new client.Histogram({
  name: "yolo_report_duration_seconds",
  help: "Time spent streaming final trip PDF reports.",
  labelNames: ["outcome"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const tripsGauge = new client.Gauge({
  name: "yolo_trips",
  help: "Current number of trips by lifecycle status.",
  labelNames: ["status"],
  registers: [register],
});

function routeLabel(req) {
  return req.route?.path || "unmatched";
}

export function metricsMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  httpRequestsInFlight.inc();
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    httpRequestsInFlight.dec();
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
  };
  res.once("finish", record);
  res.once("close", record);
  next();
}

export function audit(req, event, details = {}) {
  req.log.info({ audit: true, event, ...details }, event);
}

export function refreshTripMetrics(db) {
  const counts = db.prepare(`
    SELECT CASE WHEN completed_at IS NULL THEN 'active' ELSE 'completed' END AS status,
           COUNT(*) AS count
    FROM trips GROUP BY status
  `).all();
  tripsGauge.reset();
  tripsGauge.set({ status: "active" }, 0);
  tripsGauge.set({ status: "completed" }, 0);
  for (const row of counts) tripsGauge.set({ status: row.status }, row.count);
}

export function metricsAuthorized(req) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return true;
  const authorization = req.headers.authorization;
  return req.headers["x-metrics-token"] === expected || authorization === `Bearer ${expected}`;
}
