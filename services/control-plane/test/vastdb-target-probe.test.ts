import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createVastdbTargetProbe } from "../src/data-engine/vastdb-target-probe.js";

type ProxyResult = { ok: boolean; status: number; data: unknown };

/** Build a stub proxy that always returns the given result. */
function stubProxy(result: ProxyResult): (path: string) => Promise<ProxyResult> {
  return async () => result;
}

describe("createVastdbTargetProbe", () => {
  it("returns ok when proxy responds with 200", async () => {
    const proxy = stubProxy({
      ok: true,
      status: 200,
      data: { rows: [], count: 0, matched_by: "file_path" },
    });
    const probe = createVastdbTargetProbe(proxy);
    const result = await probe.check("frame_metadata", "files");
    assert.equal(result.status, "ok");
    assert.equal(result.detail, undefined);
  });

  it("returns target-not-found when proxy responds 503 with Python-dict detail", async () => {
    const detailStr = "{'bucket': 'sergio-db', 'schema': 'bogus_schema', 'table': 'files'}";
    const proxy = stubProxy({
      ok: false,
      status: 503,
      data: { detail: detailStr },
    });
    const probe = createVastdbTargetProbe(proxy);
    const result = await probe.check("bogus_schema", "files");
    assert.equal(result.status, "target-not-found");
    assert.match(result.detail ?? "", /bogus_schema/);
    assert.match(result.detail ?? "", /Schema\/table not found/);
  });

  it("returns target-unreachable when proxy responds 503 with plain-text detail", async () => {
    const proxy = stubProxy({
      ok: false,
      status: 503,
      data: { detail: "fetch failed: connect ECONNREFUSED 127.0.0.1:8070" },
    });
    const probe = createVastdbTargetProbe(proxy);
    const result = await probe.check("frame_metadata", "files");
    assert.equal(result.status, "target-unreachable");
    assert.match(result.detail ?? "", /ECONNREFUSED/);
    assert.match(result.detail ?? "", /vastdb-query unreachable/);
  });

  it("returns target-unreachable when proxy responds with non-503 error status", async () => {
    const proxy = stubProxy({ ok: false, status: 500, data: { detail: "internal error" } });
    const probe = createVastdbTargetProbe(proxy);
    const result = await probe.check("frame_metadata", "files");
    assert.equal(result.status, "target-unreachable");
  });

  it("builds the correct query string with schema and table params", async () => {
    let capturedPath = "";
    const proxy = async (path: string): Promise<ProxyResult> => {
      capturedPath = path;
      return { ok: true, status: 200, data: { rows: [], count: 0 } };
    };
    const probe = createVastdbTargetProbe(proxy);
    await probe.check("my_schema", "my_table");
    assert.match(capturedPath, /schema=my_schema/);
    assert.match(capturedPath, /table=my_table/);
    assert.match(capturedPath, /path=__probe__/);
    assert.match(capturedPath, /\/api\/v1\/metadata\/lookup/);
  });
});
