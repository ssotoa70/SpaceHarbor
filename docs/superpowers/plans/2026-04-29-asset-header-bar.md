# AssetHeaderBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 6 asset-detail header bar — a self-contained component rendering frame counter + timecode + clickable AOV pill row, mounted both in `AssetDetailPanel` (above its TabBar, with pills filtering the AOVS-tab table) and in `MediaPreview` viewer chrome (read-only display).

**Architecture:** One `<AssetHeaderBar>` component, two render modes selected by callback presence (`onAovChange` defined → interactive pills with `role="button"` and `aria-pressed`; absent → non-interactive pills with `tabIndex={-1}`). Bar takes a fully-fetched `metadata` prop from each parent. Color-dot consistency with `AovLayerMapTable` is by construction — both call `buildLayerRows(metadata)` and index into the same `LAYER_COLORS` array. `AovLayerMapTable` gains a new optional `activeAov` prop that filters its rendered rows.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind v4 (with `@container` queries), Vitest + Testing Library, existing custom `useAssetMetadata` hook.

**Spec:** `docs/superpowers/specs/2026-04-29-asset-header-bar-design.md`

**Branch:** `feat/asset-header-bar-and-cleanup` (stacked on PR #17 base; cleanup phase already shipped at `deb137e`).

---

## File Map

| File | Action | Purpose |
| --- | --- | --- |
| `services/web-ui/src/components/AssetHeaderBar.tsx` | CREATE | The bar component. Reads `extractFrameFields` + `buildLayerRows`. |
| `services/web-ui/src/components/AssetHeaderBar.test.tsx` | CREATE | Unit tests for rendering, empty-state, interactivity, a11y. |
| `services/web-ui/src/components/AovLayerMapTable.tsx` | MODIFY | Accept `activeAov?: string \| null` prop; filter rows when present. |
| `services/web-ui/src/components/AovLayerMapTable.test.tsx` | EXTEND | Add tests for `activeAov` filter behavior. |
| `services/web-ui/src/components/AssetDetailPanel.tsx` | MODIFY | Replace static `<ChannelPills>` row at lines 940–950 with `<AssetHeaderBar>`; add `activeAov` state with reset on `asset.id` change; pass `activeAov` to `<AovLayerMapTable>` at line 960. |
| `services/web-ui/src/components/AssetDetailPanel.aov-filter.test.tsx` | CREATE | Integration tests for pill click → table filter; reset on asset switch. (No pre-existing `AssetDetailPanel.test.tsx`; mirror the `integrity-tab.test.tsx` pattern.) |
| `services/web-ui/src/pages/AssetBrowser.tsx` | MODIFY | `MediaPreview` fetches metadata via `useAssetMetadata`; mounts `<AssetHeaderBar>` between the existing top bar (lines 474–505) and the media viewport (line 508), with no callback props. |

**Out of scope (explicit follow-up, not in this plan):**
- Frame range "of N" rendering (needs `frame_first` / `frame_last` from extractor)
- Pill click swapping the embedded preview
- Multi-select pill filtering
- A pill mount in any third surface

---

## Phase A — `AovLayerMapTable` accepts `activeAov` filter

The bar will pass an active layer name down through `AssetDetailPanel`. The table needs to know how to filter on it before the bar even exists, so we land this first.

### Task A1: Add filter tests to `AovLayerMapTable.test.tsx`

**Files:**
- Modify: `services/web-ui/src/components/AovLayerMapTable.test.tsx` (currently 170 lines, ends at line 170)

- [ ] **Step 1: Append new test cases at end of the existing `describe("<AovLayerMapTable />")` block**

In `services/web-ui/src/components/AovLayerMapTable.test.tsx`, before the closing `});` of `describe("<AovLayerMapTable />", () => { ... })` (line 170), insert:

```tsx
  it("filters rows to only the matching layer when activeAov is set", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "G", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "B", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Y", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Z", layer_name: "normals", channel_type: "FLOAT" },
        ],
      },
    });
    render(<AovLayerMapTable asset={exrAsset} activeAov="diffuse" />);
    await screen.findByTestId("aov-layer-map");
    expect(screen.getAllByText("diffuse").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("normals")).toBeNull();
    // Header still reflects the filtered count
    expect(screen.getByText(/1 LAYER/)).toBeInTheDocument();
  });

  it("renders all rows when activeAov is null (regression guard)", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
        ],
      },
    });
    render(<AovLayerMapTable asset={exrAsset} activeAov={null} />);
    await screen.findByTestId("aov-layer-map");
    expect(screen.getAllByText("diffuse").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("normals").length).toBeGreaterThanOrEqual(1);
  });

  it("renders an empty state when activeAov does not match any row", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
        ],
      },
    });
    render(<AovLayerMapTable asset={exrAsset} activeAov="not-a-real-layer" />);
    await screen.findByTestId("aov-empty");
  });
```

- [ ] **Step 2: Run the new tests; expect them to fail**

```bash
cd services/web-ui
npx vitest run src/components/AovLayerMapTable.test.tsx 2>&1 | tail -30
```

Expected: TypeScript error or runtime failure — `activeAov` is not a known prop on `AovLayerMapTable`.

### Task A2: Implement `activeAov` filter on `AovLayerMapTable`

**Files:**
- Modify: `services/web-ui/src/components/AovLayerMapTable.tsx`

- [ ] **Step 1: Add `activeAov` to props interface (line 44–46)**

In `AovLayerMapTable.tsx`, replace:

```tsx
interface AovLayerMapTableProps {
  asset: AssetRow;
}
```

with:

```tsx
interface AovLayerMapTableProps {
  asset: AssetRow;
  /** Filter the rendered rows to only the row whose `name` matches.
   *  When `null` or `undefined`, all rows render. */
  activeAov?: string | null;
}
```

- [ ] **Step 2: Apply the filter to `rows` and update destructuring (line 48–52)**

Replace:

```tsx
export function AovLayerMapTable({ asset }: AovLayerMapTableProps): ReactNode {
  const result = useAssetMetadata(asset.id);
  const metadata = result.status === "ready" ? result.data : null;

  const rows = useMemo(() => buildLayerRows(metadata), [metadata]);
```

with:

```tsx
export function AovLayerMapTable({ asset, activeAov }: AovLayerMapTableProps): ReactNode {
  const result = useAssetMetadata(asset.id);
  const metadata = result.status === "ready" ? result.data : null;

  const rows = useMemo(() => {
    const all = buildLayerRows(metadata);
    if (!activeAov) return all;
    return all.filter((r) => r.name === activeAov);
  }, [metadata, activeAov]);
```

- [ ] **Step 3: Re-run the tests; expect all (existing + new) to pass**

```bash
npx vitest run src/components/AovLayerMapTable.test.tsx 2>&1 | tail -10
```

Expected: all tests pass (existing 8 + new 3 = 11 in the file).

- [ ] **Step 4: Quick TypeScript check on the modified file**

```bash
npx tsc --noEmit 2>&1 | grep "AovLayerMapTable" || echo "no errors in AovLayerMapTable"
```

Expected: `no errors in AovLayerMapTable`. (Pre-existing TS errors elsewhere in the codebase are unrelated and not introduced by this change.)

- [ ] **Step 5: Commit**

```bash
git add services/web-ui/src/components/AovLayerMapTable.tsx \
        services/web-ui/src/components/AovLayerMapTable.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-ui): AovLayerMapTable accepts activeAov filter prop

When activeAov is provided, the table filters its rendered rows
to the matching layer name. When null/undefined, existing behavior
is preserved (all rows render). Sets up the prop the AssetHeaderBar
will drive in the next phase.

Tests: 3 new cases covering filter, null pass-through, and
no-match empty state.
EOF
)"
```

---

## Phase B — `AssetHeaderBar` component

Build the bar in three TDD passes: empty-state collapse → slot rendering → pill interactivity. Each pass adds tests, makes them fail, implements, and verifies — ending with a single commit at the end of the phase since the component is one cohesive unit.

### Task B1: Empty-state — bar collapses entirely when nothing to show

**Files:**
- Create: `services/web-ui/src/components/AssetHeaderBar.test.tsx`
- Create: `services/web-ui/src/components/AssetHeaderBar.tsx`

- [ ] **Step 1: Create the test file with the empty-state cases**

```tsx
// services/web-ui/src/components/AssetHeaderBar.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetHeaderBar } from "./AssetHeaderBar";
import type { AssetMetadataResponse } from "../api";

const baseMetadata: AssetMetadataResponse = {
  assetId: "asset-1",
  sourceUri: "s3://bucket/01_beauty.exr",
  fileKind: "image",
  pipeline: null,
  sources: { db: "ok", sidecar: "missing" },
  dbRows: [{}],
  sidecar: null,
};

describe("<AssetHeaderBar /> empty-state", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when metadata is null", () => {
    const { container } = render(<AssetHeaderBar metadata={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when frame_number, timecode, and AOV rows are all empty", () => {
    const { container } = render(<AssetHeaderBar metadata={baseMetadata} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests; expect them to fail (component does not exist)**

```bash
cd services/web-ui
npx vitest run src/components/AssetHeaderBar.test.tsx 2>&1 | tail -15
```

Expected: failure — module `./AssetHeaderBar` not found.

- [ ] **Step 3: Create `AssetHeaderBar.tsx` with the minimal implementation that passes the empty-state tests**

```tsx
// services/web-ui/src/components/AssetHeaderBar.tsx
/**
 * AssetHeaderBar — Phase 6 asset-detail header.
 *
 * Three independent slots (each hides when its data is missing):
 *   - Frame counter ("Frame 1001")
 *   - Timecode ("01:00:04:01")
 *   - AOV pill row, with deterministic per-layer color dots
 *
 * Two render modes selected by callback presence:
 *   - `onAovChange` provided → pills are clickable; `activeAov` drives
 *     the pressed-state styling. Single-select toggle.
 *   - `onAovChange` absent → pills are non-interactive (no role/button,
 *     `tabIndex={-1}`). Used in the full-screen viewer where there is
 *     no AOV table to filter.
 *
 * When all three slots are empty, the bar returns `null` (zero DOM).
 *
 * Color-dot consistency with `AovLayerMapTable`: both call
 * `buildLayerRows(metadata)` and index into the same `LAYER_COLORS`
 * tuple. Kept in lockstep by construction.
 */

import type { AssetMetadataResponse } from "../api";
import { buildLayerRows } from "./AovLayerMapTable";
import { extractFrameFields } from "./metadata/frame-fields-extractor";

const LAYER_COLORS = [
  "#a855f7", "#06b6d4", "#f59e0b", "#22c55e", "#ec4899", "#3b82f6", "#ef4444", "#8b5cf6",
];

interface AssetHeaderBarProps {
  metadata: AssetMetadataResponse | null;
  activeAov?: string | null;
  onAovChange?: (aov: string | null) => void;
}

export function AssetHeaderBar({ metadata, activeAov, onAovChange }: AssetHeaderBarProps) {
  if (metadata == null) return null;

  const fields = extractFrameFields(metadata);
  const frameNumber = fields.frame_number;
  const timecode = fields.timecode_value;
  const rows = buildLayerRows(metadata);

  const showFrame = frameNumber !== undefined;
  const showTimecode = typeof timecode === "string" && timecode.length > 0;
  const showPills = rows.length > 0;

  if (!showFrame && !showTimecode && !showPills) return null;

  return null; // slot rendering lands in B2
}
```

- [ ] **Step 4: Re-run the empty-state tests; expect pass**

```bash
npx vitest run src/components/AssetHeaderBar.test.tsx 2>&1 | tail -10
```

Expected: 2 tests pass.

### Task B2: Slot rendering — frame counter, timecode, AOV pills

**Files:**
- Modify: `services/web-ui/src/components/AssetHeaderBar.test.tsx`
- Modify: `services/web-ui/src/components/AssetHeaderBar.tsx`

- [ ] **Step 1: Add slot-rendering test cases**

Append to `AssetHeaderBar.test.tsx` after the empty-state describe block:

```tsx
describe("<AssetHeaderBar /> slot rendering", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the frame counter when frame_number is set", () => {
    render(
      <AssetHeaderBar
        metadata={{ ...baseMetadata, dbRows: [{ frame_number: 1001 }] }}
      />,
    );
    expect(screen.getByText(/Frame 1001/)).toBeInTheDocument();
  });

  it("renders frame 0 (zero is a valid frame, not a missing value)", () => {
    render(
      <AssetHeaderBar
        metadata={{ ...baseMetadata, dbRows: [{ frame_number: 0 }] }}
      />,
    );
    expect(screen.getByText(/Frame 0/)).toBeInTheDocument();
  });

  it("renders the timecode when timecode_value is present (via dbExtras.timecode)", () => {
    render(
      <AssetHeaderBar
        metadata={{
          ...baseMetadata,
          dbRows: [{}],
          dbExtras: { timecode: [{ value: "01:00:04:01", rate: 24 }] },
        }}
      />,
    );
    expect(screen.getByText("01:00:04:01")).toBeInTheDocument();
  });

  it("renders one pill per AOV layer with a color dot", () => {
    const { container } = render(
      <AssetHeaderBar
        metadata={{
          ...baseMetadata,
          dbRows: [{}],
          dbExtras: {
            channels: [
              { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
              { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("diffuse")).toBeInTheDocument();
    expect(screen.getByText("normals")).toBeInTheDocument();
    // 2 pills × 1 dot each
    expect(container.querySelectorAll("[data-testid='asset-header-bar-pill-dot']")).toHaveLength(2);
  });

  it("hides the frame counter slot when frame_number is undefined but timecode is present", () => {
    render(
      <AssetHeaderBar
        metadata={{
          ...baseMetadata,
          dbExtras: { timecode: [{ value: "01:00:04:01" }] },
        }}
      />,
    );
    expect(screen.queryByText(/Frame /)).toBeNull();
    expect(screen.getByText("01:00:04:01")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the new tests; expect them to fail (no rendering yet)**

```bash
npx vitest run src/components/AssetHeaderBar.test.tsx 2>&1 | tail -15
```

Expected: 5 failures — text not found, container empty.

- [ ] **Step 3: Replace the `return null` placeholder with the rendered bar**

In `AssetHeaderBar.tsx`, replace the line:

```tsx
  return null; // slot rendering lands in B2
```

with:

```tsx
  return (
    <div
      className="flex items-center gap-3 flex-wrap px-4 py-2 border-b border-[var(--color-ah-border-muted)]"
      data-testid="asset-header-bar"
    >
      {showFrame && (
        <span className="font-[var(--font-ah-mono)] text-[11px] text-[var(--color-ah-text-muted)] whitespace-nowrap">
          Frame {frameNumber}
        </span>
      )}
      {showTimecode && (
        <span className="font-[var(--font-ah-mono)] text-[11px] text-[var(--color-ah-text-muted)] whitespace-nowrap">
          {timecode}
        </span>
      )}
      {showPills && (
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {rows.map((row, i) => (
            <span
              key={row.name}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] bg-[var(--color-ah-bg)]"
            >
              <span
                aria-hidden="true"
                data-testid="asset-header-bar-pill-dot"
                className="w-1.5 h-1.5 rounded-sm shrink-0"
                style={{ backgroundColor: LAYER_COLORS[i % LAYER_COLORS.length] }}
              />
              {row.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
```

- [ ] **Step 4: Re-run the tests; expect all pass**

```bash
npx vitest run src/components/AssetHeaderBar.test.tsx 2>&1 | tail -10
```

Expected: 7 tests pass (2 empty-state + 5 slot rendering).

### Task B3: Pill interactivity — clickable + a11y

**Files:**
- Modify: `services/web-ui/src/components/AssetHeaderBar.test.tsx`
- Modify: `services/web-ui/src/components/AssetHeaderBar.tsx`

- [ ] **Step 1: Add interactivity test cases**

Append to `AssetHeaderBar.test.tsx`:

```tsx
describe("<AssetHeaderBar /> pill interactivity", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const aovMetadata: AssetMetadataResponse = {
    ...baseMetadata,
    dbRows: [{}],
    dbExtras: {
      channels: [
        { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
        { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
      ],
    },
  };

  it("renders pills as non-interactive when onAovChange is not provided", () => {
    render(<AssetHeaderBar metadata={aovMetadata} />);
    const pills = screen.getAllByText(/diffuse|normals/);
    for (const pill of pills) {
      const closestRole = pill.closest("[role='button']");
      expect(closestRole).toBeNull();
    }
  });

  it("renders pills as buttons when onAovChange is provided", () => {
    render(<AssetHeaderBar metadata={aovMetadata} onAovChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("calls onAovChange with the layer name on click", () => {
    const onAovChange = vi.fn();
    render(<AssetHeaderBar metadata={aovMetadata} onAovChange={onAovChange} />);
    fireEvent.click(screen.getByRole("button", { name: /diffuse/ }));
    expect(onAovChange).toHaveBeenCalledWith("diffuse");
  });

  it("clicking the active pill calls onAovChange(null) (single-select toggle)", () => {
    const onAovChange = vi.fn();
    render(
      <AssetHeaderBar
        metadata={aovMetadata}
        activeAov="diffuse"
        onAovChange={onAovChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /diffuse/ }));
    expect(onAovChange).toHaveBeenCalledWith(null);
  });

  it("the active pill has aria-pressed='true'; others have aria-pressed='false'", () => {
    render(
      <AssetHeaderBar
        metadata={aovMetadata}
        activeAov="diffuse"
        onAovChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /diffuse/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /normals/ })).toHaveAttribute("aria-pressed", "false");
  });
});
```

- [ ] **Step 2: Run; expect failures (pills are not buttons yet)**

```bash
npx vitest run src/components/AssetHeaderBar.test.tsx 2>&1 | tail -15
```

Expected: 5 failures in the interactivity describe block.

- [ ] **Step 3: Update the pill rendering to branch on `onAovChange`**

In `AssetHeaderBar.tsx`, replace the entire `{showPills && ( ... )}` block with:

```tsx
      {showPills && (
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {rows.map((row, i) => {
            const color = LAYER_COLORS[i % LAYER_COLORS.length];
            const isActive = activeAov === row.name;
            const interactive = typeof onAovChange === "function";
            const baseClass =
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border";
            const stateClass = isActive
              ? "border-[var(--color-ah-accent)] text-[var(--color-ah-text)] bg-[var(--color-ah-bg-raised)]"
              : "border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] bg-[var(--color-ah-bg)]";
            const interactiveClass = interactive
              ? "cursor-pointer hover:text-[var(--color-ah-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ah-accent)]"
              : "";

            const dot = (
              <span
                aria-hidden="true"
                data-testid="asset-header-bar-pill-dot"
                className="w-1.5 h-1.5 rounded-sm shrink-0"
                style={{ backgroundColor: color }}
              />
            );

            if (!interactive) {
              return (
                <span
                  key={row.name}
                  className={`${baseClass} ${stateClass}`}
                  tabIndex={-1}
                >
                  {dot}
                  {row.name}
                </span>
              );
            }

            return (
              <button
                key={row.name}
                type="button"
                aria-pressed={isActive}
                className={`${baseClass} ${stateClass} ${interactiveClass}`}
                onClick={() => onAovChange!(isActive ? null : row.name)}
              >
                {dot}
                {row.name}
              </button>
            );
          })}
        </div>
      )}
```

- [ ] **Step 4: Re-run; expect all 12 tests pass**

```bash
npx vitest run src/components/AssetHeaderBar.test.tsx 2>&1 | tail -10
```

Expected: 12 tests pass (2 empty + 5 slot + 5 interactivity).

- [ ] **Step 5: Commit Phase B**

```bash
git add services/web-ui/src/components/AssetHeaderBar.tsx \
        services/web-ui/src/components/AssetHeaderBar.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-ui): AssetHeaderBar component — frame / timecode / AOV pills

Self-contained metadata-summary bar with three independent slots.
Bar collapses to null when all three slots are empty (most assets
in cluster today have no frame_number/timecode/aovs yet, so this
prevents an empty bar showing on those rows).

Two render modes by callback presence:
  - onAovChange provided  → pills are <button>, aria-pressed reflects
    active state, click toggles single-select on the active layer.
  - onAovChange absent     → pills are <span tabIndex=-1>, no role,
    no hover/focus state. Used in the full-screen viewer.

Color-dot consistency with AovLayerMapTable is by construction —
both modules call buildLayerRows(metadata) and index into the same
LAYER_COLORS palette.

Tests: 12 cases covering empty-state collapse, slot independence
(frame 0 is valid, timecode-only, etc.), interactive vs read-only
rendering, click-toggle behavior, and aria-pressed.
EOF
)"
```

---

## Phase C — `AssetDetailPanel` mounts the bar + filters its AOVS table

Wire the bar into the side-panel. State lives here.

### Task C1: Add `activeAov` state with reset on `asset.id` change

**Files:**
- Modify: `services/web-ui/src/components/AssetDetailPanel.tsx`

- [ ] **Step 1: Add `activeAov` state and reset effect**

In `AssetDetailPanel.tsx`, locate the existing `useEffect` block at lines 925–929 (the one that resets `setActiveTab("info")` on `asset.id` change). Immediately AFTER that block (before line 931's `return (`), insert:

```tsx
  // Phase 6 — AOV pill filter state, owned at this panel level so it
  // survives tab switches but resets when the user picks a different
  // asset (otherwise Asset B's AOVS tab would render filtered by a
  // layer name that may not exist on it).
  const [activeAov, setActiveAov] = useState<string | null>(null);
  useEffect(() => { setActiveAov(null); }, [asset.id]);
```

If `useState` and/or `useEffect` are not already imported on line 1's React import, add them. Check the existing import at the top of the file and amend if needed (e.g., `import { useState, useEffect, useMemo, useRef } from "react";` — keep whatever is already imported, add what's missing).

- [ ] **Step 2: TypeScript check**

```bash
cd services/web-ui
npx tsc --noEmit 2>&1 | grep "AssetDetailPanel.tsx" || echo "no AssetDetailPanel errors"
```

Expected: `no AssetDetailPanel errors`.

### Task C2: Replace the static `<ChannelPills>` row with `<AssetHeaderBar>`

**Files:**
- Modify: `services/web-ui/src/components/AssetDetailPanel.tsx`

- [ ] **Step 1: Add import for AssetHeaderBar near the existing component imports**

Find the existing `import { AovLayerMapTable } from "./AovLayerMapTable";` line (line 27 per current file) and add:

```tsx
import { AssetHeaderBar } from "./AssetHeaderBar";
```

- [ ] **Step 2: Replace the ChannelPills block (lines 939–950)**

In `AssetDetailPanel.tsx`, replace:

```tsx
      {/* AOV tag pills — show channel layers from EXR metadata (images only) */}
      {mediaType === "image" && Array.isArray(panelMetadata.data?.sidecar?.channels) &&
       (panelMetadata.data?.sidecar?.channels as unknown[]).length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--color-ah-border-muted)]">
          <ChannelPills
            channels={panelMetadata.data!.sidecar!.channels}
            mode="dedup-by-layer"
            containerClassName="flex flex-wrap gap-1.5"
            pillClassName="px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] bg-[var(--color-ah-bg)]"
          />
        </div>
      )}
```

with:

```tsx
      <AssetHeaderBar
        metadata={panelMetadata.data ?? null}
        activeAov={activeAov}
        onAovChange={setActiveAov}
      />
```

- [ ] **Step 3: Remove the now-unused `ChannelPills` import if no other call site remains in this file**

```bash
grep -n "ChannelPills" services/web-ui/src/components/AssetDetailPanel.tsx
```

If the only line is the `import { ChannelPills } ...` declaration, remove that import. If other call sites exist, leave it.

- [ ] **Step 4: Pass `activeAov` to `<AovLayerMapTable>` (line 960)**

Replace:

```tsx
            <AovLayerMapTable asset={asset} />
```

with:

```tsx
            <AovLayerMapTable asset={asset} activeAov={activeAov} />
```

- [ ] **Step 5: Sanity-check by running the existing AssetDetailPanel-area tests**

```bash
npx vitest run src/components/AssetDetailPanel.integrity-tab.test.tsx 2>&1 | tail -10
```

Expected: tests pass (no regressions). The integrity-tab tests don't exercise the AOV pill row, but they do mount the full `<AssetDetailPanel>` which now contains `<AssetHeaderBar>`. The bar will return null in those tests because the stubbed metadata has empty `dbRows` and no `dbExtras.aovs/channels`. No regression.

### Task C3: Integration test — pill click filters the AOVS-tab table

**Files:**
- Create: `services/web-ui/src/components/AssetDetailPanel.aov-filter.test.tsx`

- [ ] **Step 1: Create the new test file mirroring the integrity-tab pattern**

```tsx
// services/web-ui/src/components/AssetDetailPanel.aov-filter.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { __resetAssetIntegrityCacheForTests } from "../hooks/useAssetIntegrity";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";
import { __resetPipelineCacheForTests } from "../hooks/useDataEnginePipelines";
import type { AssetRow } from "../types";

const exrAsset: AssetRow = {
  id: "asset-exr-1",
  jobId: null,
  title: "01_beauty.exr",
  sourceUri: "s3://sergio-spaceharbor/uploads/01_beauty.exr",
  status: "pending",
};

const exrAssetTwo: AssetRow = {
  ...exrAsset,
  id: "asset-exr-2",
  title: "02_no_aovs.exr",
  sourceUri: "s3://sergio-spaceharbor/uploads/02_no_aovs.exr",
};

function stubCommonApis() {
  vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: [] });
  vi.spyOn(api, "fetchAssetIntegrity").mockResolvedValue({
    assetId: exrAsset.id,
    sources: { hashes: "empty", keyframes: "n/a" },
    hashes: null,
    keyframes: null,
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
}

describe("AssetDetailPanel AOV pill filter", () => {
  beforeEach(() => {
    __resetAssetIntegrityCacheForTests();
    __resetAssetMetadataCacheForTests();
    __resetPipelineCacheForTests();
    stubCommonApis();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clicking an AOV pill filters the AOVS-tab table to the matching layer", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "G", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "B", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Y", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Z", layer_name: "normals", channel_type: "FLOAT" },
        ],
      },
    });

    render(<AssetDetailPanel asset={exrAsset} onClose={() => {}} />);

    // Wait for the bar to mount with pills
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /diffuse/ })).toBeInTheDocument();
    });

    // Switch to AOVS tab to make the table visible
    fireEvent.click(screen.getByRole("tab", { name: /AOVS/i }));

    // Both layers visible in the table initially
    await screen.findByTestId("aov-layer-map");
    expect(screen.getAllByText("diffuse").length).toBeGreaterThanOrEqual(2); // pill + table row
    expect(screen.getAllByText("normals").length).toBeGreaterThanOrEqual(2);

    // Click the diffuse pill in the bar
    fireEvent.click(screen.getByRole("button", { name: /diffuse/ }));

    // Table now scopes to diffuse only — normals row disappears
    await waitFor(() => {
      expect(screen.queryByText("normals")).toBeNull();
    });
    // Pill itself still shows (in the bar)
    expect(screen.getByRole("button", { name: /diffuse/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("activeAov resets to null when the asset prop changes", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockImplementation(async (id: string) => {
      if (id === exrAsset.id) {
        return {
          assetId: exrAsset.id,
          sourceUri: exrAsset.sourceUri,
          fileKind: "image",
          pipeline: null,
          sources: { db: "ok", sidecar: "missing" },
          dbRows: [{ file_id: "a" }],
          sidecar: null,
          dbExtras: {
            channels: [
              { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
              { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
            ],
          },
        };
      }
      return {
        assetId: exrAssetTwo.id,
        sourceUri: exrAssetTwo.sourceUri,
        fileKind: "image",
        pipeline: null,
        sources: { db: "ok", sidecar: "missing" },
        dbRows: [{ file_id: "b" }],
        sidecar: null,
      };
    });

    const { rerender } = render(<AssetDetailPanel asset={exrAsset} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /diffuse/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /diffuse/ }));
    expect(screen.getByRole("button", { name: /diffuse/ })).toHaveAttribute("aria-pressed", "true");

    // Switch to a different asset — the bar should disappear (no aovs in
    // exrAssetTwo) AND when we switch BACK to exrAsset, activeAov is null.
    rerender(<AssetDetailPanel asset={exrAssetTwo} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /diffuse/ })).toBeNull();
    });

    rerender(<AssetDetailPanel asset={exrAsset} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /diffuse/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /diffuse/ })).toHaveAttribute("aria-pressed", "false");
  });
});
```

- [ ] **Step 2: Run the new test file**

```bash
npx vitest run src/components/AssetDetailPanel.aov-filter.test.tsx 2>&1 | tail -15
```

Expected: 2 tests pass.

- [ ] **Step 3: Run the broader components test set to confirm no regressions**

```bash
npx vitest run src/components 2>&1 | tail -10
```

Expected: pass count ≥ baseline pass count for components, fail count = baseline (5 known pre-existing IngestModal/IngestPanel failures).

- [ ] **Step 4: Commit Phase C**

```bash
git add services/web-ui/src/components/AssetDetailPanel.tsx \
        services/web-ui/src/components/AssetDetailPanel.aov-filter.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-ui): AssetDetailPanel mounts AssetHeaderBar with pill filter

Replaces the static <ChannelPills> row above the TabBar with
<AssetHeaderBar>, which adds frame counter + timecode and makes
the AOV pill row clickable. activeAov state lives on the panel
and is passed through to <AovLayerMapTable> in the AOVS tab; it
resets to null when asset.id changes so a stale layer filter
cannot leak across asset selections.

Tests: 2 integration cases covering pill click → table filter
and activeAov reset on asset switch.
EOF
)"
```

---

## Phase D — `MediaPreview` mounts the bar in viewer chrome

Full-screen mount, read-only (no `onAovChange`).

### Task D1: Fetch metadata in `MediaPreview` and mount the bar

**Files:**
- Modify: `services/web-ui/src/pages/AssetBrowser.tsx`

- [ ] **Step 1: Add imports near the top of `AssetBrowser.tsx`**

Locate the existing import block and add (or amend) these imports:

```tsx
import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { AssetHeaderBar } from "../components/AssetHeaderBar";
```

(Check whether `useAssetMetadata` is already imported in the file — if so, just add `AssetHeaderBar`.)

- [ ] **Step 2: Add the metadata fetch inside `MediaPreview`**

Inside `MediaPreview` (function starts at line 410), after the existing `useState` declarations (lines 411–414) and before the `currentIndex = ...` line (416), insert:

```tsx
  const previewMetadata = useAssetMetadata(asset.id);
```

- [ ] **Step 3: Mount `<AssetHeaderBar>` between the top bar and the media viewport**

Locate the closing `</div>` of the top-bar block — this is the `</div>` on line 505 (the one that closes the `<div className="flex items-center justify-between px-5 py-3 ...">` opened at line 474). Immediately AFTER that closing `</div>` (between the top bar and the media viewport block opening at line 508), insert:

```tsx
        <AssetHeaderBar
          metadata={previewMetadata.status === "ready" ? previewMetadata.data : null}
        />
```

Note: no `activeAov` / `onAovChange` props — pills render as non-interactive `<span>`s in this mount.

- [ ] **Step 4: Run AssetBrowser tests to confirm no regressions**

```bash
cd services/web-ui
npx vitest run src/pages/AssetBrowser.test.tsx 2>&1 | tail -10
```

Expected: pre-existing pass/fail counts hold (no new failures introduced by this change). The bar will return null in tests that stub `fetchAssetMetadata` with empty data.

- [ ] **Step 5: Commit Phase D**

```bash
git add services/web-ui/src/pages/AssetBrowser.tsx
git commit -m "$(cat <<'EOF'
feat(web-ui): MediaPreview mounts AssetHeaderBar (read-only)

Full-screen viewer gains the same frame counter / timecode / AOV
pill row as the side panel, mounted in the viewer chrome between
the breadcrumb top bar and the media viewport. No callback wiring —
pills render as non-interactive spans (display value only; there is
no AOVS table to filter in full-screen mode).

Metadata is fetched via useAssetMetadata; the hook dedupes against
the side-panel's prior fetch when a user opens the same asset in
full-screen.
EOF
)"
```

---

## Phase E — Verification

### Task E1: Full web-ui test run vs baseline

**Files:** none (verification only)

- [ ] **Step 1: Capture baseline expectations from the cleanup commit**

Per the cleanup commit verification at `deb137e`: 635 passing / 15 failing (the 15 fails are pre-existing in `IngestModal` and `IngestPanel`, unrelated to this work). The plan adds 12 (Phase B) + 3 (Phase A) + 2 (Phase C) = **17 new passing tests**. Expected new total: **652 passing / 15 failing**.

- [ ] **Step 2: Run the full suite**

```bash
cd services/web-ui
npx vitest run 2>&1 | tail -10
```

- [ ] **Step 3: Verify counts**

Expected: `652 passed | 15 failed` (or thereabouts — exact total may shift by 1–2 if any of the pre-existing failing tests happen to interact with code paths the bar mounts in). The failing tests must remain the SAME set (`IngestModal`, `IngestPanel`); zero new failures from this work.

If a NEW test file is failing, stop and investigate before proceeding. Do not move on with regressions.

### Task E2: TypeScript check

- [ ] **Step 1: Run `tsc --noEmit`**

```bash
cd services/web-ui
npx tsc --noEmit 2>&1 | grep -E "(AssetHeaderBar|AovLayerMapTable|AssetDetailPanel|AssetBrowser)" || echo "no errors in changed files"
```

Expected: `no errors in changed files`. (Pre-existing errors in `MetadataPipelinesPage`, `PipelinesTab`, `TimelinePage`, `setup.ts`, etc. are unrelated and predate this work.)

### Task E3: Push the branch

- [ ] **Step 1: Push**

```bash
git push -u origin feat/asset-header-bar-and-cleanup
```

- [ ] **Step 2: Capture the tip SHA + remote validation**

```bash
git rev-parse HEAD
git rev-parse origin/feat/asset-header-bar-and-cleanup
```

Both should match. Print the SHA in chat per the user's commit-validation rule.

### Task E4: Cluster smoke test

The cluster at `10.143.2.102` is on PR #17's tip, not this stacked branch. Smoke testing requires deploying this branch first. The user controls cluster deploys.

- [ ] **Step 1: Tell the user the branch is ready and ask whether they want a cluster deploy now or after PR #17 merges**

Suggest: "Phase 6 is committed locally and pushed. Cluster smoke test requires deploying this branch (it's stacked on PR #17 which isn't merged yet). Want me to deploy `feat/asset-header-bar-and-cleanup` to the cluster now, or wait until PR #17 merges and this branch lands on top?"

Do not deploy without confirmation per the cluster-edit rule.

- [ ] **Step 2: After cluster deploy (whenever it happens), verify in browser**

Test asset IDs from the handoff:
- `533ac70b-8616-420b-8ac8-acf77059cef8` — `01_beauty_only.exr` (single AOV → expect 1 pill, no timecode/frame yet)
- `b87af229-41ba-4aa3-b5e1-b5874e7dc8f6` — `02_all_aovs_single_part.exr` (multi AOV → multiple pills, click filter works)
- `92e6b329-0392-4fa3-a202-04eaa7b09460` — `lola-vfx-480-v2.mov` (video → pills hide, timecode if present, frame_number probably absent)

Acceptance:
- Bar shows above TabBar in side-panel
- Bar shows in MediaPreview top zone (with sidebar open or closed)
- Pills clickable in side-panel, non-interactive in full-screen
- Click pill in side-panel → AOVS tab table filters to that layer
- Click same pill again → filter clears
- Switch asset → activeAov resets

---

## Self-Review Checklist (post-write)

Each spec section maps to at least one task:

- ✅ Component API — Task B1 (signature) + B3 (interactivity branches)
- ✅ Mount point: AssetDetailPanel above TabBar — Task C2
- ✅ Mount point: MediaPreview viewer chrome — Task D1
- ✅ Data flow: `extractFrameFields().frame_number`, `.timecode_value` — Task B2
- ✅ Data flow: `buildLayerRows()` for pills — Task B2
- ✅ Color consistency by construction — Task B2 (LAYER_COLORS const + index)
- ✅ Frame `0` is valid (not falsy hide) — Task B2 explicit test
- ✅ AovLayerMapTable activeAov filter — Tasks A1+A2
- ✅ State reset on asset.id change — Task C1
- ✅ A11y: role="button" / aria-pressed / tabIndex=-1 — Task B3
- ✅ Bar collapses entirely when all empty — Task B1
- ✅ Test plan items — covered across A1, B1–B3, C3
- ✅ Files-affected list — File Map section above

**Out of scope, intentionally not in plan:** Frame range "of N", multi-select pills, pill click swapping preview, pill mount in third surfaces. (Documented in spec's "Out of scope" section.)

No placeholders, no TBDs, no "similar to Task N" — every step has the actual code or command.
