# AssetHeaderBar — Design

**Status:** Approved (brainstorming complete 2026-04-29)
**Branch:** `feat/asset-header-bar-and-cleanup`
**Phase:** 6 of asset-detail-panel rework (Phases 1–5 in PR #17)

## Context

The asset-detail panel rework (PR #17) shipped a Frame.io-style "All Fields"
metadata view with file-kind-aware dispatch, an AOV Layer Map table, and badges.
What's missing is a **header bar** that surfaces three pieces of information
artists scan first when triaging a frame: which frame number, what timecode,
and which AOVs are present. The AOV pill row also needs to act as a filter on
the AOV Layer Map table so an artist can scope to a single layer (e.g.,
`motion_vec`) without scrolling.

## Responsibility

A self-contained metadata-summary bar with three independent slots:

1. **Frame counter** — "Frame 1001"
2. **Timecode** — "01:00:04:01"
3. **AOV pill row** — "beauty | diffuse | specular | AO | depth …" with a
   deterministic color dot per pill matching the row dot in `AovLayerMapTable`

Renders identically wherever it mounts. Interactivity is opt-in via a callback
prop — the same component renders both the side-panel (clickable, filters the
AOV table) and the full-screen viewer (read-only display).

## Component API

```ts
interface AssetHeaderBarProps {
  metadata: AssetMetadataResponse | null;
  activeAov?: string | null;
  onAovChange?: (aov: string | null) => void;
}
```

- `onAovChange` absent → pills render non-interactive (no `role="button"`,
  no hover, `tabIndex={-1}`, not in tab order). `activeAov` is ignored.
- `onAovChange` present → pills are clickable. `activeAov === pill.name`
  renders that pill in selected style with `aria-pressed="true"`.
- `metadata == null` (loading) → bar returns `null`. Loading state is the
  parent's responsibility (existing pattern).
- All three slots empty → bar returns `null` (collapses entirely; zero DOM,
  zero border, zero padding).

## Mount points

- **`AssetDetailPanel`** — Mounts `<AssetHeaderBar>` directly above the
  `TabBar`, **replacing** the existing static `<ChannelPills>` row at
  `AssetDetailPanel.tsx:940-950`. Owns `activeAov: string | null` state.
  Resets to `null` when `asset.id` changes (avoids stale filter when the
  user picks a different asset). Passes `activeAov` down to
  `<AovLayerMapTable>` in the AOVS tab.

- **`MediaPreview`** (full-screen viewer in `AssetBrowser.tsx`) — Mounts
  `<AssetHeaderBar metadata={...} />` in its viewer chrome with no
  callbacks. Pills render read-only.

`AllFieldsPanel` is **not** modified. The bar is a sibling concern, not
part of the metadata-body renderer.

## Data flow

| Slot          | Source                                                         | Hides when                                       |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| Frame counter | `extractFrameFields(metadata).frame_number`                    | strictly `undefined` (frame `0` is valid → show) |
| Timecode      | `extractFrameFields(metadata).timecode_value`                  | `undefined` or empty string                      |
| AOV pills     | `buildLayerRows(metadata)` (exported from `AovLayerMapTable`) | `rows.length === 0`                              |

Pill `i` color is `LAYER_COLORS[i % LAYER_COLORS.length]`. The
`AovLayerMapTable` already uses the same call and indexing, so pill color
matches the table's row dot color **by construction** — no parallel color
table to maintain.

Frame range ("Frame 1001 of 1240") is **deferred** — depends on
`frame_first` / `frame_last` fields the extractor doesn't yet emit.

## `AovLayerMapTable` change

Accepts a new optional prop:

```ts
interface AovLayerMapTableProps {
  asset: AssetRow;
  activeAov?: string | null;  // NEW
}
```

When `activeAov` is set, filters the row list to rows where
`row.name === activeAov` before rendering. When `null` or `undefined`,
existing behavior is unchanged. Color-dot index continues to use the
filtered row's original index in the unfiltered list, so a pinned pill
shows the same color it had in the unfiltered view.

## Accessibility

- **Interactive pill** (side-panel): `role="button"`, `aria-pressed`
  reflecting selected state, keyboard Enter/Space toggles, visible focus
  ring.
- **Non-interactive pill** (full-screen): no role, `tabIndex={-1}`, no
  hover/focus state. Same DOM shape so screen-reader navigation is
  structurally consistent across mount contexts.
- Color dot is `aria-hidden="true"`. Pill text is the accessible label.

## State reset

`AssetDetailPanel` declares:

```ts
const [activeAov, setActiveAov] = useState<string | null>(null);
useEffect(() => { setActiveAov(null); }, [asset.id]);
```

This guards against the user clicking a pill on Asset A, then switching
to Asset B which has different (or no) AOVs — without reset, Asset B's
table would render filtered by a stale layer name.

## Test plan

### `AssetHeaderBar.test.tsx` (new)

- Renders all three slots when frame_number, timecode_value, and AOV
  rows are all present
- Renders only the slots that have data (e.g., timecode missing →
  frame counter + pills only)
- Returns `null` when all three slots are empty
- Pills are non-interactive when no `onAovChange` is provided
  (no `role="button"`, `tabIndex={-1}`)
- Pill click calls `onAovChange(name)` when `onAovChange` is provided
- Clicking the currently-active pill calls `onAovChange(null)`
  (single-select toggle)
- Active pill has `aria-pressed="true"`; others have `aria-pressed="false"`
- Pill color matches `LAYER_COLORS[i % LAYER_COLORS.length]` by index

### `AovLayerMapTable.test.tsx` (extend existing)

- With `activeAov="diffuse"`, only the matching row renders
- With `activeAov={null}` or undefined, all rows render
  (regression guard for existing behavior)

### `AssetDetailPanel.test.tsx` (extend existing)

- Pill click in `<AssetHeaderBar>` updates the rows rendered by
  `<AovLayerMapTable>` in the AOVS tab
- `activeAov` resets to `null` when the `asset.id` prop changes

## Files affected

| File                                                          | Change          |
| ------------------------------------------------------------- | --------------- |
| `services/web-ui/src/components/AssetHeaderBar.tsx`           | NEW             |
| `services/web-ui/src/components/AssetHeaderBar.test.tsx`      | NEW             |
| `services/web-ui/src/components/AssetDetailPanel.tsx`         | MODIFY (mount + state + reset; remove static `ChannelPills` row) |
| `services/web-ui/src/components/AovLayerMapTable.tsx`         | MODIFY (add `activeAov` prop + filter) |
| `services/web-ui/src/components/AovLayerMapTable.test.tsx`    | EXTEND          |
| `services/web-ui/src/pages/AssetBrowser.tsx`                  | MODIFY (mount in `MediaPreview` viewer chrome) |

## Out of scope (explicit follow-up)

- Frame range "of N" rendering — needs `frame_first` / `frame_last`
  fields from the extractor
- Pill click swapping the embedded preview — preserved as a separate
  decision per agent reviews; pills filter only
- Multi-select pill filtering (intersection vs. union) — single-select
  toggle is sufficient for the primary use case (scope to one AOV)
- Pill behavior in any third mount surface (mini-cards, hover previews) —
  none exist today; revisit when one does
