import http from "k6/http";
import { check, sleep } from "k6";

// Health-endpoint baseline — exercises just the Fastify router + JSON response.
// Any result slower than p95 < 20ms here means Fastify or the host is
// seriously wrong.

const BASE = __ENV.SPACEHARBOR_URL || "http://localhost:8080";

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "30s", target: 50 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<50"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get(`${BASE}/health`);
  check(res, {
    "status is 200": (r) => r.status === 200,
    "has backgroundWorker": (r) => JSON.parse(r.body).backgroundWorker !== undefined,
  });
  sleep(0.1);
}
