import { describe, it, expect } from "vitest";
import { NAV_SECTIONS, NAV_ITEMS } from "./registry";

describe("NavRegistry", () => {
  it("every item references a valid section", () => {
    const sectionIds = new Set(NAV_SECTIONS.map((s) => s.id));
    for (const item of NAV_ITEMS) {
      expect(sectionIds.has(item.section), `item "${item.id}" references unknown section "${item.section}"`).toBe(true);
    }
  });

  it("every section has at least one item", () => {
    for (const section of NAV_SECTIONS) {
      const items = NAV_ITEMS.filter((i) => i.section === section.id);
      expect(items.length, `section "${section.id}" has no items`).toBeGreaterThan(0);
    }
  });

  it("all item ids are unique", () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all item routes are unique", () => {
    const routes = NAV_ITEMS.map((i) => i.to);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("all item routes start with /", () => {
    for (const item of NAV_ITEMS) {
      expect(item.to.startsWith("/"), `item "${item.id}" route "${item.to}" must start with /`).toBe(true);
    }
  });

  it("section ids are unique", () => {
    const ids = NAV_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("permission strings use valid format (category:action)", () => {
    const permPattern = /^[a-z_]+:[a-z_]+$/;
    for (const item of NAV_ITEMS) {
      if (item.permission) {
        expect(item.permission).toMatch(permPattern);
      }
    }
    for (const section of NAV_SECTIONS) {
      if (section.permission) {
        expect(section.permission).toMatch(permPattern);
      }
    }
  });

  it("has exactly 6 sections", () => {
    expect(NAV_SECTIONS).toHaveLength(6);
  });
});
