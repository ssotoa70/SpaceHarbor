import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PLUGIN_BUNDLE_SCHEMA_VERSION,
  appendRecord,
  emptyReport,
  renameForImport,
  stripCustomField,
  stripNamingTemplate,
  stripTrigger,
  stripWebhook,
  stripWorkflow,
  validatePluginBundle,
  type PluginBundle,
} from "../src/domain/plugin-bundle.js";

const validBundle: PluginBundle = {
  schemaVersion: 1,
  name: "test",
  version: "1.0.0",
  exportedAt: "2026-04-16T10:00:00Z",
  resources: {
    namingTemplates: [
      { name: "n1", scope: "asset_filename", template: "{x}", description: null, sampleContext: null, enabled: true },
    ],
  },
};

describe("validatePluginBundle", () => {
  it("accepts the canonical envelope", () => {
    const r = validatePluginBundle(validBundle);
    assert.equal(r.ok, true);
  });

  it("rejects non-object payload", () => {
    assert.equal(validatePluginBundle("string").ok, false);
    assert.equal(validatePluginBundle(null).ok, false);
    assert.equal(validatePluginBundle([1, 2]).ok, false);
  });

  it("rejects mismatched schema version", () => {
    const bad = { ...validBundle, schemaVersion: 2 };
    const r = validatePluginBundle(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join("; "), /schemaVersion/);
  });

  it("rejects missing name/version", () => {
    assert.equal(validatePluginBundle({ ...validBundle, name: "" }).ok, false);
    assert.equal(validatePluginBundle({ ...validBundle, version: "" }).ok, false);
  });

  it("rejects unknown resource types", () => {
    const r = validatePluginBundle({ ...validBundle, resources: { junk: [] } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join("; "), /unknown resource type/);
  });

  it("rejects non-array resource lists", () => {
    const r = validatePluginBundle({ ...validBundle, resources: { namingTemplates: {} } });
    assert.equal(r.ok, false);
  });

  it("rejects naming template without name/scope/template", () => {
    const r = validatePluginBundle({
      ...validBundle,
      resources: { namingTemplates: [{ scope: "x", template: "y" }] },
    });
    assert.equal(r.ok, false);
  });

  it("rejects custom field without entityType+name+displayLabel+dataType", () => {
    const r = validatePluginBundle({
      ...validBundle,
      resources: { customFields: [{ entityType: "asset" }] },
    });
    assert.equal(r.ok, false);
  });

  it("rejects webhook with bad direction", () => {
    const r = validatePluginBundle({
      ...validBundle,
      resources: { webhooks: [{ name: "w", direction: "bidirectional" }] },
    });
    assert.equal(r.ok, false);
  });

  it("accepts an empty resources object", () => {
    const r = validatePluginBundle({ ...validBundle, resources: {} });
    assert.equal(r.ok, true);
  });
});

describe("strip helpers", () => {
  it("namingTemplate parses sampleContextJson", () => {
    const out = stripNamingTemplate({
      name: "n", scope: "asset_filename", template: "{x}",
      description: "d", sampleContextJson: '{"a":1}', enabled: true,
    });
    assert.deepEqual(out.sampleContext, { a: 1 });
  });

  it("namingTemplate returns null sampleContext when JSON is invalid", () => {
    const out = stripNamingTemplate({
      name: "n", scope: "asset_filename", template: "{x}",
      description: null, sampleContextJson: "not json", enabled: true,
    });
    assert.equal(out.sampleContext, null);
  });

  it("customField parses validationJson and displayConfigJson", () => {
    const out = stripCustomField({
      entityType: "asset", name: "x", displayLabel: "X", dataType: "string",
      required: false, validationJson: '{"max_length":10}', displayConfigJson: '{"section":"main"}',
      description: null,
    });
    assert.deepEqual(out.validation, { max_length: 10 });
    assert.deepEqual(out.displayConfig, { section: "main" });
  });

  it("trigger parses both condition and actionConfig JSON", () => {
    const out = stripTrigger({
      name: "t", description: null, eventSelector: "*",
      conditionJson: '{"equals":1}', actionKind: "http_call",
      actionConfigJson: '{"url":"http://x"}', enabled: true,
    });
    assert.deepEqual(out.condition, { equals: 1 });
    assert.deepEqual(out.actionConfig, { url: "http://x" });
  });

  it("trigger emits empty actionConfig when JSON is malformed", () => {
    const out = stripTrigger({
      name: "t", description: null, eventSelector: "*",
      conditionJson: null, actionKind: "http_call",
      actionConfigJson: "garbage", enabled: true,
    });
    assert.deepEqual(out.actionConfig, {});
  });

  it("workflow parses dsl from dslJson", () => {
    const out = stripWorkflow({
      name: "w", description: null,
      dslJson: '{"nodes":[{"id":"start","kind":"start"}],"edges":[]}',
      enabled: true,
    });
    assert.equal(out.dsl.nodes.length, 1);
    assert.equal(out.dsl.edges.length, 0);
  });

  it("workflow falls back to empty dsl when JSON is malformed", () => {
    const out = stripWorkflow({
      name: "w", description: null, dslJson: "not-json", enabled: false,
    });
    assert.deepEqual(out.dsl, { nodes: [], edges: [] });
  });

  it("webhook excludes any secret material by virtue of input shape", () => {
    const out = stripWebhook({
      name: "wh", direction: "outbound", url: "https://example",
      signingAlgorithm: "hmac-sha256", allowedEventTypes: ["x"], description: null,
    });
    // The returned object literally has no secretHash/secretPrefix keys.
    const opaque = out as unknown as Record<string, unknown>;
    assert.equal(opaque.secretHash, undefined);
    assert.equal(opaque.secretPrefix, undefined);
  });
});

describe("renameForImport", () => {
  it("appends a deterministic stamp from exportedAt", () => {
    const r = renameForImport("studio_default", "2026-04-16T10:00:00Z");
    assert.match(r, /^studio_default__imported_/);
  });

  it("uses fallback when exportedAt has no digits", () => {
    const r = renameForImport("foo", "abc");
    assert.equal(r, "foo__imported_import");
  });

  it("is stable for the same inputs", () => {
    assert.equal(
      renameForImport("foo", "2026-04-16T10:00:00Z"),
      renameForImport("foo", "2026-04-16T10:00:00Z"),
    );
  });
});

describe("emptyReport / appendRecord", () => {
  it("starts with zero totals", () => {
    const r = emptyReport("skip", true, validBundle);
    assert.deepEqual(r.totals, { created: 0, skipped: 0, renamed: 0, failed: 0 });
    assert.equal(r.bundleName, "test");
    assert.equal(r.dryRun, true);
  });

  it("increments the right totals for each outcome", () => {
    const r = emptyReport("skip", false, validBundle);
    appendRecord(r, { resourceType: "triggers", key: "a", outcome: "created", finalName: "a" });
    appendRecord(r, { resourceType: "triggers", key: "b", outcome: "skipped", finalName: "b" });
    appendRecord(r, { resourceType: "triggers", key: "c", outcome: "renamed", originalName: "c", finalName: "c__imported_x" });
    appendRecord(r, { resourceType: "triggers", key: "d", outcome: "failed", finalName: "d", message: "boom" });
    assert.deepEqual(r.totals, { created: 1, skipped: 1, renamed: 1, failed: 1 });
    assert.equal(r.records.length, 4);
  });
});

describe("schema constants", () => {
  it("PLUGIN_BUNDLE_SCHEMA_VERSION is 1", () => {
    assert.equal(PLUGIN_BUNDLE_SCHEMA_VERSION, 1);
  });
});
