// Load test: steady ramp, realistic read traffic on the console-api.
// Simulates the UI polling satellites/stats/findings.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:4000";

const latencySats = new Trend("latency_satellites");
const latencyStats = new Trend("latency_stats");
const latencyFindings = new Trend("latency_findings");

export const options = {
  scenarios: {
    read_mix: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "1m", target: 25 },
        { duration: "2m", target: 50 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{route:/api/satellites}": ["p(95)<800"],
    "http_req_duration{route:/api/stats}": ["p(95)<500"],
    "http_req_duration{route:/api/findings}": ["p(95)<800"],
  },
};

export default function () {
  const sats = http.get(`${BASE}/api/satellites?limit=50`, {
    tags: { route: "/api/satellites" },
  });
  latencySats.add(sats.timings.duration);
  check(sats, { "satellites 200": (r) => r.status === 200 });

  const stats = http.get(`${BASE}/api/stats`, {
    tags: { route: "/api/stats" },
  });
  latencyStats.add(stats.timings.duration);
  check(stats, { "stats 200": (r) => r.status === 200 });

  const findings = http.get(`${BASE}/api/findings`, {
    tags: { route: "/api/findings" },
  });
  latencyFindings.add(findings.timings.duration);
  check(findings, { "findings 200": (r) => r.status === 200 });

  sleep(Math.random() * 2 + 0.5);
}
