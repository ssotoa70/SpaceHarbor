import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseTemplate,
  renderTemplate,
  validateTemplate,
  tokenNames,
} from "../src/domain/naming-template.js";

describe("naming-template parser", () => {
  it("splits literals and tokens", () => {
    const t = parseTemplate("{project}_{shot}.exr");
    assert.deepEqual(t.parts, [
      { kind: "token", name: "project", format: undefined },
      { kind: "literal", text: "_" },
      { kind: "token", name: "shot", format: undefined },
      { kind: "literal", text: ".exr" },
    ]);
  });

  it("captures format spec", () => {
    const t = parseTemplate("{version:03d}");
    assert.deepEqual(t.parts, [{ kind: "token", name: "version", format: "03d" }]);
  });

  it("escapes doubled braces", () => {
    const t = parseTemplate("literal {{ and }} braces, {x}");
    assert.deepEqual(t.parts, [
      { kind: "literal", text: "literal { and } braces, " },
      { kind: "token", name: "x", format: undefined },
    ]);
  });

  it("treats unmatched { as literal", () => {
    const t = parseTemplate("unmatched { open");
    assert.deepEqual(t.parts, [{ kind: "literal", text: "unmatched { open" }]);
  });
});

describe("naming-template validator", () => {
  it("accepts a valid template", () => {
    assert.deepEqual(validateTemplate("{project}_{version:03d}"), { ok: true });
  });

  it("rejects empty template", () => {
    const r = validateTemplate("");
    assert.equal(r.ok, false);
  });

  it("rejects invalid token name", () => {
    const r = validateTemplate("{1bad}");
    assert.equal(r.ok, false);
  });

  it("rejects unmatched closing brace", () => {
    const r = validateTemplate("oops}");
    assert.equal(r.ok, false);
  });

  it("rejects unmatched opening brace", () => {
    const r = validateTemplate("oops {x");
    assert.equal(r.ok, false);
  });

  it("rejects empty format spec", () => {
    const r = validateTemplate("{x:}");
    assert.equal(r.ok, false);
  });

  it("accepts dot-path token names", () => {
    assert.deepEqual(validateTemplate("{shot.code}_{version:03d}"), { ok: true });
  });
});

describe("naming-template tokenNames", () => {
  it("returns unique token names in template order", () => {
    assert.deepEqual(
      tokenNames("{project}_{shot}_v{version:03d}_{shot}_{date:YYYYMMDD}"),
      ["project", "shot", "version", "date"],
    );
  });

  it("returns empty array for templates with no tokens", () => {
    assert.deepEqual(tokenNames("static_filename.exr"), []);
  });
});

describe("naming-template renderer", () => {
  it("substitutes simple tokens", () => {
    const r = renderTemplate("{project}_{shot}", { project: "BTH", shot: "010" });
    assert.equal(r.rendered, "BTH_010");
    assert.deepEqual(r.errors, []);
  });

  it("zero-pads numbers with NNd format", () => {
    const r = renderTemplate("v{version:03d}", { version: 7 });
    assert.equal(r.rendered, "v007");
  });

  it("zero-pads negative numbers preserving sign", () => {
    const r = renderTemplate("{n:04d}", { n: -3 });
    assert.equal(r.rendered, "-0003");
  });

  it("handles numeric strings as numbers", () => {
    const r = renderTemplate("v{version:03d}", { version: "12" });
    assert.equal(r.rendered, "v012");
  });

  it("formats dates with YYYYMMDD", () => {
    const r = renderTemplate("{date:YYYYMMDD}", { date: "2026-04-16T00:00:00Z" });
    assert.equal(r.rendered, "20260416");
  });

  it("formats dates with mixed tokens and literals", () => {
    const r = renderTemplate("{date:YYYY-MM-DD_HHmmss}", { date: "2026-04-16T14:30:12Z" });
    assert.equal(r.rendered, "2026-04-16_143012");
  });

  it("upper/lower/slug case helpers", () => {
    assert.equal(renderTemplate("{n:upper}", { n: "abc" }).rendered, "ABC");
    assert.equal(renderTemplate("{n:lower}", { n: "ABC" }).rendered, "abc");
    assert.equal(renderTemplate("{n:slug}", { n: "Black Theta!" }).rendered, "black-theta");
  });

  it("joins arrays with separator", () => {
    const r = renderTemplate("{users:join:,}", { users: ["alice", "bob"] });
    assert.equal(r.rendered, "alice,bob");
  });

  it("string pad right and left", () => {
    assert.equal(renderTemplate("[{x:pad:5}]", { x: "ab" }).rendered, "[ab   ]");
    assert.equal(renderTemplate("[{x:padleft:5}]", { x: "ab" }).rendered, "[   ab]");
  });

  it("resolves dot-paths against nested context", () => {
    const r = renderTemplate("{shot.code}", { shot: { code: "010" } });
    assert.equal(r.rendered, "010");
  });

  it("reports unknown token without throwing", () => {
    const r = renderTemplate("{missing}", {});
    assert.equal(r.rendered, "<missing?>");
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].token, "missing");
  });

  it("reports format-type mismatch", () => {
    const r = renderTemplate("{x:03d}", { x: "not-a-number" });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, /numeric format/);
  });

  it("renders the canonical studio template", () => {
    const r = renderTemplate(
      "{project}_{shot}_v{version:03d}_{date:YYYYMMDD}.exr",
      { project: "BTH", shot: "010", version: 7, date: "2026-04-16T12:00:00Z" },
    );
    assert.equal(r.rendered, "BTH_010_v007_20260416.exr");
    assert.deepEqual(r.errors, []);
  });

  it("preserves escaped braces in output", () => {
    const r = renderTemplate("literal {{ {name} }}", { name: "BTH" });
    assert.equal(r.rendered, "literal { BTH }");
  });
});
