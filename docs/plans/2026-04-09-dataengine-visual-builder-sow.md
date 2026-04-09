# DataEngine Visual Builder — Statement of Work

**Status:** Proposed (Phase 5)
**Author:** SpaceHarbor platform
**Created:** 2026-04-09
**Reference implementation:** `https://var201.selab.vastdata.com/dataengine/#/pipelines/<guid>/builder`

## 1. Background

SpaceHarbor's current DataEngine surface is list-centric: users can view
Functions, Triggers, and Pipelines in tables and edit their metadata
(name/description/tags) via modals. Pipeline structure (which triggers fire
which functions, what deployment config each function uses) is only editable
as **raw JSON** through `PipelineManifestEditor.tsx`.

The VAST DataEngine UI exposes a **Visual Builder** for pipelines — a
node-graph canvas with a library sidebar, drag-and-drop composition, and a
right-side Inspect panel for configuring the currently-selected node. This
is the expected experience for DataEngine power users and the primary way
pipelines are authored on the cluster today.

This SoW defines the scope, phases, and exit criteria for bringing a
SpaceHarbor-native Visual Builder online so users can compose and deploy
pipelines without leaving SpaceHarbor or hand-editing JSON.

## 2. Goals

1. **View** any existing pipeline as a node graph (triggers → functions)
   rendered in SpaceHarbor's visual language.
2. **Inspect** any node and see its full configuration in a right sidebar
   (function deployment name, revision, image, secrets, env vars,
   concurrency, CPU/memory limits; trigger source, filters, schedule).
3. **Edit** node parameters inline from the Inspect panel (e.g. change a
   function's concurrency from 2 to 4) and persist via `updateVastPipeline`.
4. **Compose** new pipelines by dragging triggers and functions from the
   sidebar onto the canvas and drawing edges between them.
5. **Deploy** the composed pipeline to the cluster via the existing
   `deployVastPipeline` proxy route.
6. **Toggle** between the visual graph and the underlying YAML/JSON
   representation at any time, with round-trip fidelity.

## 3. Non-goals (deferred)

- Trace-level run visualization overlaid on the graph (red nodes for failed
  runs, latency heatmaps, etc.) — belongs to the Telemetry tab.
- Template library and one-click "clone from another tenant" flows.
- Multi-tenant pipeline sharing, pipeline versioning UI beyond the existing
  `last_revision_number` display.
- A standalone function builder (the function *code* is authored and built
  elsewhere — SpaceHarbor only deploys revisions).
- Mobile / small-viewport layouts.

## 4. Scope phases

### Phase B.1 — View-only visualization (target: ~40% of total effort)

**Deliverables:**
- New route `/pipeline/pipelines/:guid/builder`
- Install `@xyflow/react` (MIT) as the graph library
- Read existing pipeline's manifest via `fetchVastPipeline(guid)` and
  lay out nodes + edges automatically (dagre or ELK for layout)
- Custom SpaceHarbor-themed node components: `TriggerNode`, `FunctionNode`
- Read-only right sidebar ("Inspect") that shows the selected node's
  properties (no inline editing yet)
- Header with breadcrumb (`Library / Pipelines / <name>`), **Visual Builder
  / YAML** toggle (YAML view reuses the existing `PipelineManifestEditor`)
- "Open in Builder" button added to `PipelinesTab.tsx` rows

**Exit criteria:**
- User can click a pipeline row and see its structure as a graph
- User can click any node and see its full config in the Inspect panel
- YAML toggle shows the same manifest serialized

### Phase B.2 — Inline parameter editing (target: ~25% of total effort)

**Deliverables:**
- Inspect panel fields become editable (text inputs, number inputs, key-value
  editors for env vars and tags)
- A "Save Draft" button at the top right becomes active when the local
  manifest diverges from the server version
- Discard/confirm flow on route leave with unsaved changes
- Persist via `updateVastPipeline(guid, { manifest })`
- Toast/banner confirmation on successful save

**Exit criteria:**
- User can change any single parameter and save it without touching JSON
- Server-side manifest reflects the change within one refresh cycle
- Attempting to leave with unsaved changes prompts for confirmation

### Phase B.3 — Composition (target: ~30% of total effort)

**Deliverables:**
- Left sidebar with two tabs: **Triggers** and **Functions**, each listing
  existing cluster resources with search
- Drag-and-drop from sidebar → canvas creates a new node
- Draw edges by dragging from node handles (React Flow built-in)
- Contextual validation: can't connect function → trigger, can't leave
  orphaned nodes, etc.
- "Create New Trigger" / "Create New Function" shortcuts in the sidebar
  that open the existing create modals and drop the result onto the canvas
- "Deploy" button wired to `deployVastPipeline(guid)`
- Deploy state machine: Draft → Deploying → Ready/Failure with toast
  feedback

**Exit criteria:**
- User can compose a new pipeline from scratch by dragging nodes and
  connecting them
- Deploy succeeds and the pipeline status updates in the cluster

### Phase B.4 — Polish (target: ~5% of total effort)

**Deliverables:**
- Keyboard shortcuts (Cmd+S save, Delete to remove selected node, arrow
  keys to pan, +/- to zoom)
- Minimap for large pipelines
- Auto-layout button that re-runs dagre/ELK
- Copy/paste nodes
- Undo/redo

**Exit criteria:**
- Keyboard-only user can build and deploy a pipeline
- 50-node pipeline renders and pans smoothly at 60fps

## 5. Technical approach

### 5.1 Graph library

**Choice:** `@xyflow/react` (formerly React Flow). MIT-licensed, tree-shakable,
mature, supports custom nodes/edges, handles viewport pan/zoom, includes
minimap and controls out of the box.

**Alternative considered:** Hand-rolled SVG. Rejected — three to four weeks
of extra work to re-implement pan/zoom, viewport culling, edge routing, and
node dragging. Not worth it for MVP.

### 5.2 Manifest ↔ graph translation

VAST pipeline manifest shape (from existing code + cluster inspection):

```yaml
triggers:
  - trigger_guid: <guid>
functions:
  - function_guid: <guid>
    function_vrn: <vrn>
    config: { concurrency, timeout }
    resources: { cpu_min, cpu_max, memory_min, memory_max }
    environment_variables: { … }
    secret_keys: { … }
```

The translation layer (`src/pages/dataengine/builder/manifest.ts`) will:
- Convert the manifest into React Flow `nodes[]` + `edges[]`
- Lay out with `dagre` for consistent top-down flow
- Convert back to manifest on save, preserving field ordering so the
  YAML diff stays minimal

### 5.3 File layout

```
services/web-ui/src/pages/dataengine/builder/
  BuilderPage.tsx        # Route component; orchestrates layout
  Canvas.tsx             # React Flow wrapper
  nodes/
    TriggerNode.tsx      # Custom node for triggers
    FunctionNode.tsx     # Custom node for functions
  sidebar/
    LibrarySidebar.tsx   # Left: draggable triggers + functions list
    InspectPanel.tsx     # Right: selected-node properties
    inspectors/
      FunctionInspector.tsx
      TriggerInspector.tsx
  manifest.ts            # Manifest ↔ {nodes, edges} translation
  layout.ts              # dagre auto-layout
  useBuilderState.ts     # Local state store (Zustand or plain hook)
```

### 5.4 Backend work

**No new control-plane routes needed.** All functionality is covered by the
existing `dataengine-proxy` endpoints:

- `GET /dataengine-proxy/pipelines/:guid` (read)
- `GET /dataengine-proxy/triggers` (library)
- `GET /dataengine-proxy/functions` (library)
- `PUT /dataengine-proxy/pipelines/:guid` (save manifest)
- `POST /dataengine-proxy/pipelines/:guid/deploy` (deploy)

The VMS `X-Tenant-Name` header injection and normalization transforms from
commit `f0fe7aa` already handle the response shapes.

## 6. Open questions (to resolve before starting)

1. **Function revision selection:** the Inspect panel in VMS lets users
   pick a revision number from a dropdown. We need to call
   `GET /function-revisions?guid=<function_guid>` — this endpoint is already
   proxied but we'd need a helper to fetch per-function. Any caching
   strategy, or fetch on-demand?
2. **Secret keys:** the existing `SecretKey` type is undocumented in our
   codebase. We need to confirm the VMS create-secret payload and ensure
   the Inspect panel's "Create Secret" action matches it.
3. **Kubernetes cluster + namespace:** currently read-only in the create
   modal. Should the builder allow changing the cluster of an existing
   pipeline, or is that out of scope (requires redeploy anyway)?
4. **Auto-layout trigger:** should auto-layout run on every node addition,
   or only on explicit user action? VMS seems to leave node positions
   alone once placed.

## 7. Risks

- **Manifest drift:** if VMS evolves the manifest schema, the graph↔manifest
  translation may silently lose fields. Mitigation: keep a "passthrough"
  bucket on each node for fields the builder doesn't recognize, and
  preserve them on serialize.
- **Large pipelines:** React Flow performance degrades past ~200 nodes.
  Mitigation: lazy-render off-screen nodes, defer if we see real customer
  pipelines exceed 50 nodes (current largest: 27).
- **Drag-and-drop UX:** needs real user testing. Plan for a design review
  after Phase B.1 and another after B.3.

## 8. Dependencies

- Commit `f0fe7aa`: VMS response normalization (landed)
- Commit `cd19227`: DataEngine tenant header (landed)
- The DataEngine function repo's oiio-proxy-generator `_preview.jpg` work
  (separate agent) — **not a blocker** for the builder itself, but improves
  the demo story.
- No new control-plane work.
- New npm dependency: `@xyflow/react` (~80KB minified gzipped), `dagre`
  (~20KB minified gzipped).

## 9. Acceptance criteria (whole feature)

1. User can open any existing pipeline in the Visual Builder and see a
   correct graph.
2. User can compose a new pipeline from scratch by drag-and-drop, configure
   function deployments (concurrency, CPU, memory), and click Deploy.
3. Deployed pipeline is visible in VMS Visual Builder at the same structure.
4. User can switch between Visual Builder and YAML view with no data loss.
5. All DataEngine tab tests still pass; new Builder tests cover manifest
   round-trip, node selection, inspect rendering, and a happy-path
   drag-and-drop composition.

## 10. Out of this SoW / for later

- Trace replay on the graph
- Pipeline templates / export
- Collaborative multi-user editing
- Git-style diff view between pipeline revisions

---

**Review and approval:** Needed before Phase B.1 kickoff.
