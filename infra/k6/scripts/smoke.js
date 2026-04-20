// Smoke test: 1 VU, short — verifies all core GET routes return 2xx.
// Run: docker compose ... run --rm k6 run /scripts/smoke.js
import http from "k6/http";
import { check, group } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:4000";

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
    checks: ["rate==1.0"],
  },
};

const GET_ROUTES = [
  "/health",
  "/api/stats",
  "/api/satellites?limit=10",
  "/api/conjunctions?limit=10",
  "/api/findings",
  "/api/cycles",
  "/api/autonomy/status",
  "/api/sweep/mission/status",
  "/api/sources/advisory",
  "/api/sources/rss",
  "/api/ingestion/jobs",
];

export default function () {
  for (const path of GET_ROUTES) {
    group(`GET ${path}`, () => {
      const res = http.get(`${BASE}${path}`, { tags: { route: path } });
      check(res, {
        "status is 2xx": (r) => r.status >= 200 && r.status < 300,
        "body is non-empty": (r) => r.body && r.body.length > 0,
      });
    });
  }
}
