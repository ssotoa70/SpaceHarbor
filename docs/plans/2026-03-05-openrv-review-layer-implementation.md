# OpenRV Review Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Open in RV" button to the Web UI that constructs an `rvlink://` URI from an asset's VAST path and opens it in the artist's locally-installed RV player.

**Architecture:** Control-plane adds `GET /api/v1/assets/:id/review-uri` which queries VastDB for the asset's VAST NFS path and returns an `rvlink://` URI. Web UI adds a `ReviewButton` component (React) that calls this endpoint and opens the URI. No server-side RV binary required. `ReviewButton` renders only when `asset.proxy_uri` or `asset.source_uri` is set.

**Tech Stack:** TypeScript/Fastify (control-plane route), React + Vite (Web UI component)

**Design doc:** `docs/plans/2026-03-05-aswf-integrations-design.md`

---

### Task 1: Add `review_uri` field to asset domain model

**Files:**
- Modify: `services/control-plane/src/domain/models.ts`

**Step 1: Read current `models.ts`**

Open `services/control-plane/src/domain/models.ts` and locate the `WorkflowJob` or `Asset` type definition.

**Step 2: Add `review_uri` field**

In the asset/job model, add the optional field:

```typescript
review_uri?: string;  // rvlink:// URI for OpenRV launch
```

**Step 3: TypeScript check**

```bash
cd services/control-plane
./node_modules/.bin/tsc --noEmit
```

Expected: 0 errors

**Step 4: Commit**

```bash
git add services/control-plane/src/domain/models.ts
git commit -m "feat: add review_uri field to asset domain model"
```

---

### Task 2: Implement `GET /api/v1/assets/:id/review-uri` control-plane route

**Files:**
- Create: `services/control-plane/src/routes/review.ts`
- Modify: `services/control-plane/src/app.ts`
- Create: `services/control-plane/test/review.test.ts`

**Step 1: Write failing tests**

```typescript
// test/review.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

before(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
});

describe("GET /api/v1/assets/:id/review-uri", () => {
  it("returns 200 with rvlink URI for known asset", async () => {
    // Ingest an asset first to get a known ID
    const ingestRes = await app.inject({
      method: "POST",
      url: "/api/v1/ingest",
      headers: { "x-api-key": "test-key", "content-type": "application/json" },
      payload: {
        name: "hero_plate_v001.exr",
        shot_id: "sh010",
        source_uri: "vast://ingest/sh010/hero_plate_v001.exr",
        version_label: "v001",
      },
    });
    assert.equal(ingestRes.statusCode, 201);
    const { asset_id } = JSON.parse(ingestRes.body);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/assets/${asset_id}/review-uri`,
      headers: { "x-api-key": "test-key" },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.uri, "should have uri");
    assert.ok(body.uri.startsWith("rvlink://") || body.uri.startsWith("mock-rvlink://"),
      `uri should start with rvlink://, got: ${body.uri}`);
    assert.ok(body.format, "should have format");
    assert.equal(body.asset_id, asset_id);
  });

  it("returns 404 for unknown asset", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/assets/nonexistent-uuid-9999/review-uri",
      headers: { "x-api-key": "test-key" },
    });
    assert.equal(res.statusCode, 404);
  });

  it("returns 401 without API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/assets/some-id/review-uri",
    });
    assert.equal(res.statusCode, 401);
  });
});
```

**Step 2: Run — verify FAIL**

```bash
node --import tsx --test test/review.test.ts 2>&1 | tail -20
```

Expected: FAIL — 404 (route not registered)

**Step 3: Create `src/routes/review.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

const reviewUriResponseSchema = {
  type: "object",
  required: ["asset_id", "uri", "format"],
  properties: {
    asset_id: { type: "string" },
    uri: { type: "string" },
    format: { type: "string", enum: ["exr_sequence", "mov", "dpx_sequence", "mp4", "unknown"] },
  },
} as const;

function buildRvlinkUri(sourceUri: string, devMode: boolean): { uri: string; format: string } {
  if (devMode || sourceUri.startsWith("mock://") || sourceUri.startsWith("vast://")) {
    // Normalize to NFS-style path for RV
    const path = sourceUri.replace(/^(mock|vast):\/\//, "/vast/");
    const format = detectFormat(sourceUri);
    const uri = `rvlink://${path}`;
    return { uri, format };
  }
  // Production: sourceUri is already an NFS or S3 path
  return { uri: `rvlink://${sourceUri}`, format: detectFormat(sourceUri) };
}

function detectFormat(uri: string): string {
  if (uri.includes(".exr")) return "exr_sequence";
  if (uri.includes(".mov")) return "mov";
  if (uri.includes(".dpx")) return "dpx_sequence";
  if (uri.includes(".mp4")) return "mp4";
  return "unknown";
}

export async function registerReviewRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  const devMode = process.env.DEV_MODE !== "false";

  for (const prefix of prefixes) {
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/review-uri"),
      {
        schema: {
          tags: ["review"],
          operationId: "v1AssetsReviewUri",
          summary: "Get OpenRV launch URI for an asset",
          security: [{ ApiKeyAuth: [] as string[] }],
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
          response: {
            200: reviewUriResponseSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const asset = await persistence.getAsset(request.params.id);
        if (!asset) {
          return sendError(reply, 404, "Asset not found");
        }
        const sourceUri = asset.proxy_uri ?? asset.source_uri ?? "";
        if (!sourceUri) {
          return sendError(reply, 404, "Asset has no reviewable URI");
        }
        const { uri, format } = buildRvlinkUri(sourceUri, devMode);
        return reply.status(200).send({ asset_id: request.params.id, uri, format });
      },
    );
  }
}
```

**Step 4: Register in `src/app.ts`**

```typescript
import { registerReviewRoutes } from "./routes/review.js";
// inside buildApp:
await registerReviewRoutes(app, persistence, ["/api/v1"]);
```

**Step 5: Run all control-plane tests**

```bash
node --import tsx --test test/*.test.ts 2>&1 | tail -10
```

Expected: all PASS (≥142)

**Step 6: TypeScript check**

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: 0 errors

**Step 7: Commit**

```bash
git add services/control-plane/src/routes/review.ts services/control-plane/src/app.ts services/control-plane/test/review.test.ts
git commit -m "feat: add GET /assets/:id/review-uri for OpenRV rvlink launch"
```

---

### Task 3: Implement `ReviewButton` React component

**Files:**
- Create: `services/web-ui/src/components/ReviewButton.tsx`
- Create: `services/web-ui/src/components/ReviewButton.test.tsx`

**Step 1: Check existing test setup**

```bash
ls services/web-ui/src/components/
cat services/web-ui/package.json | grep -E '"test|vitest|jest'
```

Note the test runner (Vitest or Jest) and import patterns used in existing component tests.

**Step 2: Write failing test**

```tsx
// src/components/ReviewButton.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { ReviewButton } from "./ReviewButton";

describe("ReviewButton", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        asset_id: "abc123",
        uri: "rvlink:///vast/ingest/abc123/hero_plate_v001.exr",
        format: "exr_sequence",
      }),
    });
    // Mock window.open
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("renders Open in RV button", () => {
    render(<ReviewButton assetId="abc123" />);
    expect(screen.getByRole("button", { name: /open in rv/i })).toBeDefined();
  });

  it("fetches review URI and opens rvlink on click", async () => {
    render(<ReviewButton assetId="abc123" />);
    fireEvent.click(screen.getByRole("button", { name: /open in rv/i }));
    // Wait for fetch
    await vi.waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        "rvlink:///vast/ingest/abc123/hero_plate_v001.exr",
        "_blank",
      );
    });
  });

  it("shows error state when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    render(<ReviewButton assetId="abc123" />);
    fireEvent.click(screen.getByRole("button", { name: /open in rv/i }));
    await vi.waitFor(() => {
      expect(screen.getByText(/failed to open/i)).toBeDefined();
    });
  });

  it("does not render when assetId is undefined", () => {
    const { container } = render(<ReviewButton assetId={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
```

**Step 3: Run — verify FAIL**

```bash
cd services/web-ui
npm test -- --run ReviewButton
```

Expected: FAIL — `ReviewButton` not found

**Step 4: Implement `src/components/ReviewButton.tsx`**

```tsx
import { useState } from "react";

interface ReviewButtonProps {
  assetId: string | undefined;
  apiBase?: string;
}

export function ReviewButton({ assetId, apiBase = "/api/v1" }: ReviewButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!assetId) return null;

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/assets/${assetId}/review-uri`, {
        headers: { "x-api-key": import.meta.env.VITE_API_KEY ?? "" },
      });
      if (!res.ok) {
        setError("Failed to open in RV");
        return;
      }
      const { uri } = await res.json();
      window.open(uri, "_blank");
    } catch {
      setError("Failed to open in RV");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span>
      <button
        onClick={handleClick}
        disabled={loading}
        title="Open in RV player"
        aria-label="Open in RV"
        style={{ cursor: loading ? "wait" : "pointer" }}
      >
        {loading ? "Opening..." : "Open in RV"}
      </button>
      {error && <span role="alert" style={{ color: "red", marginLeft: 8 }}>{error}</span>}
    </span>
  );
}
```

**Step 5: Run tests**

```bash
npm test -- --run ReviewButton
```

Expected: PASS (4/4)

**Step 6: Commit**

```bash
git add services/web-ui/src/components/ReviewButton.tsx services/web-ui/src/components/ReviewButton.test.tsx
git commit -m "feat: add ReviewButton component for OpenRV rvlink launch"
```

---

### Task 4: Integrate `ReviewButton` into `AssetQueue` and `ApprovalPanel`

**Files:**
- Modify: `services/web-ui/src/components/AssetQueue.tsx` (or wherever AssetRow renders)
- Modify: `services/web-ui/src/components/ApprovalPanel.tsx`

**Step 1: Locate component files**

```bash
ls services/web-ui/src/components/
```

Find `AssetQueue.tsx` (or `AssetRow.tsx`) and `ApprovalPanel.tsx`.

**Step 2: Add import and use `ReviewButton` in `AssetQueue`**

In `AssetQueue.tsx` (or `AssetRow.tsx`), find where each asset row renders its action buttons and add:

```tsx
import { ReviewButton } from "./ReviewButton";

// Inside the asset row render, after existing buttons:
<ReviewButton assetId={asset.id} />
```

**Step 3: Add `ReviewButton` in `ApprovalPanel`**

In `ApprovalPanel.tsx`, find the detail/action area and add:

```tsx
import { ReviewButton } from "./ReviewButton";

// Inside panel action area:
<ReviewButton assetId={selectedAsset?.id} />
```

**Step 4: Run web-ui tests**

```bash
cd services/web-ui
npm test -- --run
```

Expected: all PASS

**Step 5: Commit**

```bash
git add services/web-ui/src/components/AssetQueue.tsx services/web-ui/src/components/ApprovalPanel.tsx
git commit -m "feat: integrate ReviewButton into AssetQueue and ApprovalPanel"
```
