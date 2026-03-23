import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, resolveActionPermission } from "../../src/iam/permissions.js";
import { PERMISSIONS } from "../../src/iam/types.js";

const P = PERMISSIONS;

describe("Analytics & Query Console permissions", () => {
  describe("permission existence", () => {
    it("ADMIN_ANALYTICS exists in PERMISSIONS", () => {
      assert.equal(P.ADMIN_ANALYTICS, "admin:analytics");
    });
    it("ADMIN_ADHOC_QUERY exists in PERMISSIONS", () => {
      assert.equal(P.ADMIN_ADHOC_QUERY, "admin:adhoc_query");
    });
  });

  describe("role grants", () => {
    it("platform_operator has admin:analytics", () => {
      assert.ok(hasPermission(["platform_operator"], P.ADMIN_ANALYTICS));
    });
    it("supervisor does NOT have admin:analytics", () => {
      assert.ok(!hasPermission(["supervisor"], P.ADMIN_ANALYTICS));
    });
    it("administrator inherits admin:analytics", () => {
      assert.ok(hasPermission(["administrator"], P.ADMIN_ANALYTICS));
    });
    it("super_admin has admin:adhoc_query", () => {
      assert.ok(hasPermission(["super_admin"], P.ADMIN_ADHOC_QUERY));
    });
    it("platform_operator does NOT have admin:adhoc_query", () => {
      assert.ok(!hasPermission(["platform_operator"], P.ADMIN_ADHOC_QUERY));
    });
    it("administrator does NOT have admin:adhoc_query", () => {
      assert.ok(!hasPermission(["administrator"], P.ADMIN_ADHOC_QUERY));
    });
    it("pipeline_td does NOT have admin:analytics", () => {
      assert.ok(!hasPermission(["pipeline_td"], P.ADMIN_ANALYTICS));
    });
  });

  describe("route action mappings", () => {
    it("GET /analytics/assets resolves to admin:analytics", () => {
      const mapping = resolveActionPermission("GET", "/api/v1/analytics/assets");
      assert.ok(mapping);
      assert.equal(mapping.permission, P.ADMIN_ANALYTICS);
    });
    it("GET /analytics/pipeline resolves to admin:analytics", () => {
      const mapping = resolveActionPermission("GET", "/api/v1/analytics/pipeline");
      assert.ok(mapping);
      assert.equal(mapping.permission, P.ADMIN_ANALYTICS);
    });
    it("GET /analytics/storage resolves to admin:analytics", () => {
      const mapping = resolveActionPermission("GET", "/api/v1/analytics/storage");
      assert.ok(mapping);
      assert.equal(mapping.permission, P.ADMIN_ANALYTICS);
    });
    it("GET /analytics/render resolves to admin:analytics", () => {
      const mapping = resolveActionPermission("GET", "/api/v1/analytics/render");
      assert.ok(mapping);
      assert.equal(mapping.permission, P.ADMIN_ANALYTICS);
    });
    it("POST /query/execute resolves to admin:adhoc_query", () => {
      const mapping = resolveActionPermission("POST", "/api/v1/query/execute");
      assert.ok(mapping);
      assert.equal(mapping.permission, P.ADMIN_ADHOC_QUERY);
    });
    it("GET /query/history resolves to admin:adhoc_query", () => {
      const mapping = resolveActionPermission("GET", "/api/v1/query/history");
      assert.ok(mapping);
      assert.equal(mapping.permission, P.ADMIN_ADHOC_QUERY);
    });
    it("DELETE /query/:queryId resolves to admin:adhoc_query", () => {
      const mapping = resolveActionPermission("DELETE", "/api/v1/query/abc-123");
      assert.ok(mapping);
      assert.equal(mapping.permission, P.ADMIN_ADHOC_QUERY);
    });
  });
});
