# Web-UI Architecture Guide

## Overview

SpaceHarbor's web-UI is a **React + Vite + TypeScript** single-page application that provides:

- **Multi-role dashboards**: Operator (system health), Coordinator (incident response), Supervisor (oversight)
- **Asset management**: browse, ingest, approve, track pipelines
- **VFX hierarchy**: projects, sequences, shots, versions, materials
- **Admin console**: users, roles, analytics, settings, audit logs, capacity planning
- **Real-time events**: streaming from control-plane via Server-Sent Events

No build step—Vite handles transformation on-the-fly in dev mode.

## Directory Structure

```
services/web-ui/src/
├── App.tsx              # Root component, role selector, main board routing
├── api.ts               # Centralized API client (types + fetch functions)
├── types.ts             # Shared TypeScript interfaces
├── main.tsx             # React entry point
├── pages/               # 25+ page components (one per major UI screen)
│   ├── AssetBrowser.tsx
│   ├── ApprovalQueuePage.tsx
│   ├── AuditTrailPage.tsx
│   ├── AnalyticsDashboard.tsx
│   ├── CapacityPlanningDashboard.tsx
│   └── ... (see pages/ directory)
├── components/          # Reusable components (if created)
├── boards/              # Dashboard layouts
│   ├── OperatorBoard.tsx
│   ├── CoordinatorBoard.tsx
│   └── SupervisorBoard.tsx
├── operator/            # Operator-specific logic
│   ├── health.ts        # Health state derivation
│   └── types.ts         # HealthState, MetricsSnapshot
├── styles/              # Tailwind CSS (vite imports)
└── vite-env.d.ts        # Vite type definitions

test/                   # Vitest test files
├── pages/
│   ├── AssetBrowser.test.tsx
│   ├── ApprovalQueuePage.test.tsx
│   └── ...
└── fixtures/           # Sample data for tests
```

## How to Add a New Page

1. **Create the page component** at `src/pages/MyPageName.tsx`:

   ```typescript
   import { useEffect, useState } from "react";
   import { fetchMyData, type MyDataRow } from "../api.js";

   export function MyPage() {
     const [data, setData] = useState<MyDataRow[]>([]);
     const [loading, setLoading] = useState(true);
     const [error, setError] = useState<string | null>(null);

     useEffect(() => {
       fetchMyData()
         .then(setData)
         .catch((err) => setError(err.message))
         .finally(() => setLoading(false));
     }, []);

     if (loading) return <div>Loading...</div>;
     if (error) return <div className="text-red-600">Error: {error}</div>;

     return (
       <div className="p-6">
         <h1 className="text-2xl font-bold">My Data</h1>
         <ul>{data.map((row) => <li key={row.id}>{row.name}</li>)}</ul>
       </div>
     );
   }
   ```

2. **Add fetch function to `api.ts`**:

   ```typescript
   export async function fetchMyData(): Promise<MyDataRow[]> {
     const res = await fetch(`/api/v1/my-endpoint`);
     if (!res.ok) throw new Error(`: ${res.status}`);
     return res.json();
   }
   ```

3. **Add TypeScript types to `types.ts`**:

   ```typescript
   export interface MyDataRow {
     id: string;
     name: string;
     status: "active" | "inactive";
   }
   ```

4. **Add route in `App.tsx`** (if using React Router) or link from a dashboard.

## API Client Pattern

All API calls go through **`api.ts`** — a centralized module with typed fetch functions. This pattern:

- **Centralizes URLs** — change API endpoints in one place
- **Types responses** — catch type mismatches at compile time
- **Fallback data** — many functions export sample data for offline testing

### Example: API Client Function

```typescript
// api.ts
export type AssetRow = {
  id: string;
  title: string;
  status: "ingesting" | "ready" | "approved" | "rejected";
  // ... 20+ fields
};

export async function fetchAssets(filters?: { status?: string }): Promise<AssetRow[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append("status", filters.status);

  const res = await fetch(`/api/v1/assets?${params}`);
  if (!res.ok) {
    // Fallback to sample data if API unavailable
    console.warn(`fetchAssets failed (${res.status}) — returning sample`);
    return SAMPLE_ASSETS;
  }
  return res.json();
}

// Sample data (for offline dev)
const SAMPLE_ASSETS: AssetRow[] = [
  { id: "1", title: "hero_shot_001.exr", status: "ready", /* ... */ },
];
```

### Sample Data Fallback

Most pages can render with **sample data** when the API is unavailable. This enables:

- **UI development** without a running control-plane
- **Testing** without mocking the entire fetch layer
- **Demo mode** by setting an env var

To use sample data, call the fallback directly:
```typescript
const data = SAMPLE_ASSETS; // instead of await fetchAssets()
```

## Role-Based Views

SpaceHarbor renders different dashboards per role (no RBAC enforced in UI—purely UX):

```typescript
// App.tsx
export function App() {
  const [role, setRole] = useState<AppRole>("operator");

  return (
    <div>
      {role === "operator" && <OperatorBoard {...} />}
      {role === "coordinator" && <CoordinatorBoard {...} />}
      {role === "supervisor" && <SupervisorBoard {...} />}
    </div>
  );
}
```

Each board imports its own pages and arranges them into a layout. Roles are **for UI/UX only**—authentication and actual access control happen in control-plane.

## Design System

Pages use **Tailwind CSS v4** (configured via `@tailwindcss/vite` plugin):

- **Spacing**: `p-6`, `m-4` (6=24px, 4=16px)
- **Colors**: neutral grays, red-600 for errors, green-600 for success
- **Typography**: Tailwind defaults (18px base, -2/0/+2/-4 scale)
- **Components**: @radix-ui for popovers, dialogs, toggles (primitives only, no pre-styled components)

No custom component library—style pages directly with Tailwind classes.

## Testing Pages

### Setup

Tests use **vitest** + **React Testing Library**:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { MyPage } from "../src/pages/MyPage";
import * as api from "../src/api";
import { vi } from "vitest";

describe("MyPage", () => {
  it("renders data from API", async () => {
    // Mock the API
    vi.spyOn(api, "fetchMyData").mockResolvedValue([
      { id: "1", name: "Test" },
    ]);

    render(<MyPage />);

    // Wait for async load
    await waitFor(() => {
      expect(screen.getByText("Test")).toBeInTheDocument();
    });
  });

  it("shows error when API fails", async () => {
    vi.spyOn(api, "fetchMyData").mockRejectedValue(new Error("API error"));

    render(<MyPage />);

    await waitFor(() => {
      expect(screen.getByText(/Error:/)).toBeInTheDocument();
    });
  });
});
```

### Run Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Single file
npm test MyPage.test.tsx
```

## Configuration via Environment Variables

Build-time variables (embedded at build time):

```
VITE_API_BASE_URL = /api/v1              # API endpoint (defaults to relative)
VITE_EVENT_STREAM_URL = /api/v1/events/stream
```

These are embedded into the bundle via Vite's `import.meta.env` API. To use:

```typescript
const apiBase = import.meta.env.VITE_API_BASE_URL || "/api/v1";
```

## Development Workflow

### Start Dev Server

```bash
npm run dev
```

Runs Vite on `http://localhost:4173` with hot module reloading.

### Run Tests

```bash
npm test
```

Watches for changes and re-runs related tests.

### Build for Production

```bash
npm run build
```

Outputs optimized bundle to `dist/` (vite default).

## Key Files to Review

- **API contract**: `src/api.ts` (all fetch functions + types)
- **Types**: `src/types.ts` (shared interfaces for routes)
- **App routing**: `src/App.tsx` (role selector, dashboard layout)
- **Sample pages**: `src/pages/AssetBrowser.tsx`, `src/pages/ApprovalQueuePage.tsx`
- **Tests pattern**: `test/pages/AssetBrowser.test.tsx`

## Common Patterns

### Fetch + Loading + Error

```typescript
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  fetchData()
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));
}, []);

if (loading) return <div>Loading...</div>;
if (error) return <div className="text-red-600">{error}</div>;
return <div>{/* render data */}</div>;
```

### URL Search Params

```typescript
const role = new URLSearchParams(window.location.search).get("role") || "operator";
```

### Form Submission

```typescript
const handleSubmit = async (e: FormEvent) => {
  e.preventDefault();
  try {
    await submitData({ title, sourceUri });
    setTitle("");
    setSourceUri("");
  } catch (err) {
    setError(err.message);
  }
};
```

## Troubleshooting

- **API 404**: Check control-plane is running on `localhost:8080` and route exists
- **Types mismatch**: API response doesn't match `AssetRow` interface — check control-plane sends correct JSON
- **Build fails**: `rm -rf node_modules && npm ci` then `npm run build`
- **Tests fail**: Mock API in test, or check that control-plane is running for integration tests
