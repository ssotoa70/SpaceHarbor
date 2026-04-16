import http from "k6/http";
import { check, sleep } from "k6";

// List-assets baseline — exercises DB read + pagination + JSON serialization.
// The limit=500 tripwire is hardened via the preValidation hook, so any
// ?limit=big request silently caps.

const BASE = __ENV.SPACEHARBOR_URL || "http://localhost:8080";
const TOKEN = __ENV.SPACEHARBOR_TOKEN || "";

export const options = {
  stages: [
    { duration: "10s", target: 5 },
    { duration: "30s", target: 25 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const headers = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};

export default function () {
  // First page
  let res = http.get(`${BASE}/api/v1/assets?limit=50`, { headers });
  check(res, {
    "assets status 200": (r) => r.status === 200,
    "has nextCursor field": (r) => {
      try {
        return "nextCursor" in JSON.parse(r.body);
      } catch { return false; }
    },
  });

  // Follow the cursor if present (exercises cursor pagination path)
  try {
    const body = JSON.parse(res.body);
    if (body.nextCursor) {
      res = http.get(`${BASE}/api/v1/assets?cursor=${encodeURIComponent(body.nextCursor)}&limit=50`, { headers });
      check(res, { "page 2 status 200": (r) => r.status === 200 });
    }
  } catch { /* ignore */ }

  sleep(0.2);
}
