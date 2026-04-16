import http from "k6/http";
import { check, sleep } from "k6";
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";

// Checkin baseline — reserve-only (no actual part uploads). Measures the
// S3 CreateMultipartUpload + presigned-URL generation + DB writes.
//
// Real commits require large binary PUTs that don't fit a clean k6 pattern;
// test those separately with the bash E2E scripts.

const BASE = __ENV.SPACEHARBOR_URL || "http://localhost:8080";
const TOKEN = __ENV.SPACEHARBOR_TOKEN || "";
const SHOT_ID = __ENV.SHOT_ID || "";
const PROJECT_ID = __ENV.PROJECT_ID || "";
const SEQ_ID = __ENV.SEQ_ID || "";

export const options = {
  stages: [
    { duration: "10s", target: 2 },
    { duration: "20s", target: 5 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.05"],
  },
};

const headers = TOKEN
  ? { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }
  : { "content-type": "application/json" };

export default function () {
  if (!SHOT_ID || !PROJECT_ID || !SEQ_ID) {
    console.error("Set SHOT_ID, PROJECT_ID, SEQ_ID env vars before running this script.");
    return;
  }

  const payload = JSON.stringify({
    shotId: SHOT_ID,
    projectId: PROJECT_ID,
    sequenceId: SEQ_ID,
    versionLabel: `load_v${randomIntBetween(1, 1_000_000)}`,
    filename: `load_${randomIntBetween(1, 1_000_000)}.mov`,
    fileSizeBytes: 8_388_608,       // 8 MB
    preferredPartSizeBytes: 5_242_880,
  });

  const res = http.post(`${BASE}/api/v1/assets/checkin`, payload, { headers });
  const ok = check(res, {
    "reserve status 201": (r) => r.status === 201,
    "has checkinId": (r) => {
      try {
        return Boolean(JSON.parse(r.body).checkinId);
      } catch { return false; }
    },
  });

  if (ok) {
    // Abort the reservation so we don't leak open multipart uploads.
    // This also exercises the abort path + S3 compensation log.
    try {
      const body = JSON.parse(res.body);
      http.post(`${BASE}/api/v1/assets/checkin/${body.checkinId}/abort`, null, { headers });
    } catch { /* ignore */ }
  }

  sleep(0.5);
}
