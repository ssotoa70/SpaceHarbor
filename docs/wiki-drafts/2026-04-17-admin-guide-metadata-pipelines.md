# Wiki page — `Admin-Guide-Metadata-Pipelines`

Create a new wiki page with the title **Admin-Guide-Metadata-Pipelines** and paste the entire block below as its content. Also add a link from the wiki sidebar under the **Admin Guides** section:

```markdown
* [Metadata Pipelines](Admin-Guide-Metadata-Pipelines)
```

---

# Metadata Pipelines

The **Metadata Pipelines** admin page lets you view and edit the routing table that maps each file kind (image, video, raw camera) to a VAST DataEngine function and a VastDB `schema.table` where the extracted metadata lands.

**Access:** `Automation → Metadata Pipelines` (requires the `admin:system_config` permission).

## What the page shows

Each row is one pipeline — one per `fileKind`. At most three rows (`image`, `video`, `raw_camera`).

| Column | What it means |
|---|---|
| Kind | The logical file kind this pipeline handles. Immutable — to change which extensions belong to which kind, edit the row's `extensions` list. |
| Function | The VAST DataEngine function name that processes files of this kind. The page looks this up in VAST by exact name — no pattern matching. |
| Target | The VastDB `schema.table` the function writes into. The control-plane reads from here to surface metadata in the asset browser. |
| Extensions | File extensions that route to this pipeline. Each extension must start with a dot and contain only lowercase alphanumeric characters. |
| Status | Live status pill — see below. |
| Enabled | On/off toggle. When off, the control-plane skips the DB lookup for this kind (useful for draining a misconfigured target without deleting the row). |
| Actions | `Edit` opens a detailed dialog. |

## Status pills

The status pill tells you whether the routing path is actually usable right now. Hover any non-OK pill for a one-line reason.

| Pill | Color | Meaning |
|---|---|---|
| **OK** | green | Function resolves in VAST and the target `schema.table` is reachable. |
| **Not found** | amber | No VAST function exists with the configured `functionName`. Check that the function was deployed and the name matches exactly. |
| **Unreachable** | red | VAST DataEngine itself is unreachable (auth, network, tenant). Fix the VAST connection in `Admin → Settings → DataEngine`. |
| **Target missing** | amber | The function exists, but `targetSchema.targetTable` doesn't exist in VastDB. Either rename the target to match reality, or have the functions team create the table. |
| **Target unreachable** | red | `vastdb-query` service is down or misconfigured. Check the container is running. |

## Common workflows

### First-time setup on a fresh deploy

1. Open `Automation → Metadata Pipelines`.
2. If the page shows "No pipelines configured", click **Seed defaults**. This populates all three pipelines from the container's canonical seed JSON.
3. All rows should show `OK`. If not, fix per the status-pill table above.

### Adding a missing pipeline (partial state)

If an operator previously removed a row (via the API) so only some `fileKind` entries exist, the page shows a yellow banner:

> ⓘ Missing pipelines for: video, raw_camera. [Seed missing]

Click **Seed missing**. The page loads the defaults and appends only the missing kinds, preserving everything you already had.

### Changing the schema or table a function writes to

When the functions team renames a VastDB schema or table, update the corresponding pipeline so the control-plane reads the new location:

1. Click **Edit** on the affected row.
2. Change `Target schema` or `Target table`. Both must be valid SQL identifiers (letters, digits, underscores; must start with a letter or underscore).
3. Before saving, use the **Test lookup** pane at the bottom of the dialog:
   - Paste a full S3 path to any known asset of this kind (e.g. `s3://sergio-spaceharbor/uploads/XYZ.exr`).
   - Click **Run test**.
   - You should see `1 row` with a sample of the first matching record.
4. Click **Save changes**.
5. Click **Refresh** in the page header to verify the status pill is back to `OK`.

If Save fails with a 400 error like `body/dataEnginePipelines/0/targetSchema must match pattern ...`, fix the identifier format and re-save.

### Temporarily disabling a pipeline

Click the green toggle in the `Enabled` column. The row updates immediately and the toggle turns grey. The control-plane will stop reading from this pipeline until you re-enable it.

If the save fails for any reason, the toggle rolls back automatically and an error banner appears.

### Inspecting the live VAST function

Open **Edit** on any row. The middle pane shows the live VAST function metadata (GUID, description, owner, revision number, timestamps, VRN). This is the authoritative record of what VAST currently has — useful for confirming which function revision is actually wired up.

When `status=Not found` or `status=Unreachable`, this pane shows "— Not currently resolved —".

## When the status pill is wrong

The pill reflects cached live data (60-second TTL). If you just changed something in VAST and the pill hasn't caught up, click **Refresh** in the page header — it bypasses the cache and forces a fresh probe.

If the pill stays wrong after refresh, check:

1. The VAST function name is an **exact** match (spaces, hyphens, case all matter).
2. VAST DataEngine is reachable from the control-plane host (`Admin → Settings → DataEngine → Test Connection`).
3. `vastdb-query` is running (`docker compose ps`). A stopped or unhealthy `vastdb-query` container turns every probe into `Target unreachable`.

## API access

For scripting or CI:

- `GET /api/v1/dataengine/pipelines/active` — same data the page shows, JSON.
- `GET /api/v1/dataengine/pipelines/active?force=true` — bypass cache.
- `GET /api/v1/dataengine/pipelines/defaults` — the canonical default list.
- `PUT /api/v1/platform/settings` with `{ "dataEnginePipelines": [ ... ] }` — full-array write. Validation errors return a 400 with the exact message from `validatePipelineConfigList`.
- `GET /api/v1/metadata/lookup?path=&schema=&table=` — admin proxy over vastdb-query's schema-agnostic lookup. Same one the Test Lookup pane uses.

All routes require the `admin:system_config` permission.
