// Stress test: push past expected peak to find the breakpoint.
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:4000";

export const options = {
  scenarios: {
    stress: {
      executor: "ramping-arrival-rate",
      startRate: 20,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "2m", target: 200 },
        { duration: "2m", target: 500 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    // intentionally loose — goal is to observe, not pass/fail on perf alone.
    http_req_failed: ["rate<0.10"],
    http_req_duration: ["p(99)<5000"],
  },
};

export default function () {
  const r = http.get(`${BASE}/api/satellites?limit=100`, {
    tags: { route: "/api/satellites" },
  });
  check(r, { ok: (res) => res.status === 200 });
}
