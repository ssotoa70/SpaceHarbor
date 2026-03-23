import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyStatement, referencesBlockedTable, ensureLimit, validateLength } from "../../src/query/sql-classifier.js";

describe("SQL Classifier", () => {
  describe("classifyStatement", () => {
    it("allows SELECT", () => {
      assert.ok(classifyStatement("SELECT * FROM assets").allowed);
    });
    it("allows SHOW", () => {
      assert.ok(classifyStatement("SHOW TABLES").allowed);
    });
    it("allows DESCRIBE", () => {
      assert.ok(classifyStatement("DESCRIBE assets").allowed);
    });
    it("allows EXPLAIN", () => {
      assert.ok(classifyStatement("EXPLAIN SELECT 1").allowed);
    });
    it("denies INSERT", () => {
      assert.ok(!classifyStatement("INSERT INTO assets VALUES (1)").allowed);
    });
    it("denies UPDATE", () => {
      assert.ok(!classifyStatement("UPDATE assets SET name='x'").allowed);
    });
    it("denies DELETE", () => {
      assert.ok(!classifyStatement("DELETE FROM assets").allowed);
    });
    it("denies DROP", () => {
      assert.ok(!classifyStatement("DROP TABLE assets").allowed);
    });
    it("denies CREATE", () => {
      assert.ok(!classifyStatement("CREATE TABLE x (id INT)").allowed);
    });
    it("denies ALTER", () => {
      assert.ok(!classifyStatement("ALTER TABLE assets ADD COLUMN x INT").allowed);
    });
    it("handles case variations", () => {
      assert.ok(classifyStatement("select * from assets").allowed);
      assert.ok(!classifyStatement("insert into assets values (1)").allowed);
    });
    it("strips leading line comments", () => {
      assert.ok(classifyStatement("-- this is a comment\nSELECT 1").allowed);
    });
    it("strips leading block comments", () => {
      assert.ok(classifyStatement("/* comment */SELECT 1").allowed);
    });
    it("detects multi-statement", () => {
      const result = classifyStatement("SELECT 1; DROP TABLE assets");
      assert.ok(!result.allowed);
      assert.ok(result.reason?.includes("Multi-statement"));
    });
    it("rejects empty statement", () => {
      assert.ok(!classifyStatement("").allowed);
      assert.ok(!classifyStatement("   ").allowed);
    });
  });

  describe("referencesBlockedTable", () => {
    it("blocks iam_users", () => {
      assert.ok(!referencesBlockedTable("SELECT * FROM iam_users").allowed);
    });
    it("blocks iam_api_keys", () => {
      assert.ok(!referencesBlockedTable("SELECT * FROM iam_api_keys").allowed);
    });
    it("blocks iam_global_roles", () => {
      assert.ok(!referencesBlockedTable("SELECT * FROM iam_global_roles").allowed);
    });
    it("blocks iam_project_memberships", () => {
      assert.ok(!referencesBlockedTable("SELECT * FROM iam_project_memberships").allowed);
    });
    it("blocks iam_refresh_tokens", () => {
      assert.ok(!referencesBlockedTable("SELECT * FROM iam_refresh_tokens").allowed);
    });
    it("blocks schema_version", () => {
      assert.ok(!referencesBlockedTable("SELECT * FROM schema_version").allowed);
    });
    it("blocks in subquery", () => {
      assert.ok(!referencesBlockedTable("SELECT * FROM assets WHERE id IN (SELECT user_id FROM iam_users)").allowed);
    });
    it("blocks in JOIN", () => {
      assert.ok(!referencesBlockedTable("SELECT a.* FROM assets a JOIN iam_users u ON a.user_id = u.id").allowed);
    });
    it("blocks in CTE", () => {
      assert.ok(!referencesBlockedTable("WITH cte AS (SELECT * FROM iam_users) SELECT * FROM cte").allowed);
    });
    it("allows non-blocked tables", () => {
      assert.ok(referencesBlockedTable("SELECT * FROM assets").allowed);
    });
    it("allows tables with similar prefixes", () => {
      assert.ok(referencesBlockedTable("SELECT * FROM iam_users_log").allowed);
    });
  });

  describe("ensureLimit", () => {
    it("injects LIMIT when missing", () => {
      const result = ensureLimit("SELECT * FROM assets");
      assert.ok(result.endsWith("LIMIT 10000"));
    });
    it("keeps existing LIMIT if under max", () => {
      const result = ensureLimit("SELECT * FROM assets LIMIT 100");
      assert.ok(result.endsWith("LIMIT 100"));
    });
    it("caps LIMIT if over max", () => {
      const result = ensureLimit("SELECT * FROM assets LIMIT 50000");
      assert.ok(result.endsWith("LIMIT 10000"));
    });
    it("strips trailing semicolons", () => {
      const result = ensureLimit("SELECT * FROM assets;");
      assert.ok(result.endsWith("LIMIT 10000"));
      assert.ok(!result.includes(";"));
    });
  });

  describe("validateLength", () => {
    it("allows short queries", () => {
      assert.ok(validateLength("SELECT 1").allowed);
    });
    it("rejects queries over 10KB", () => {
      const longQuery = "SELECT " + "x".repeat(11000);
      assert.ok(!validateLength(longQuery).allowed);
    });
  });
});
