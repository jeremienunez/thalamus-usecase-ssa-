// Scenario targeting the write/streaming path: sweep-chat POST.
// Keeps VUs low because this exercises LLM-bound work in cloud mode.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:4000";
const SAT_ID = __ENV.SAT_ID || "25544"; // ISS as a default sanity target

export const options = {
  vus: 3,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<8000"],
  },
};

export default function () {
  const payload = JSON.stringify({ message: "What is the orbital regime?" });
  const res = http.post(`${BASE}/${SAT_ID}/sweep-chat`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { route: "/sweep-chat" },
  });
  check(res, { "status 2xx": (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}
