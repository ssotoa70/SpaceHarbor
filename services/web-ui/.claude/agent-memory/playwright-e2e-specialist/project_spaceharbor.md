---
name: SpaceHarbor application config
description: URLs, credentials, Docker setup, and key known issues for SpaceHarbor E2E testing
type: project
---

## Application URLs
- Frontend (Vite preview): http://localhost:4173 (Docker container `assetharbor-web-ui`)
- Backend API (Docker): http://localhost:8080 (Docker container `assetharbor-control-plane`)
- Vite proxy: `/api/*` proxied to `http://localhost:8080`
- Browser automation must use host IP `192.168.0.5` (not localhost) because Playwright runs in Docker

**Why:** Playwright runs inside a Docker container (`competent_kare`); localhost resolves to the container, not the host machine.

**How to apply:** Always use `http://192.168.0.5:4173` as the base URL for browser navigation.

## Auth Credentials
- Email: `admin@assetharbor.dev`
- Password: `Admin1234!dev`
- These come from `ASSETHARBOR_ADMIN_EMAIL` / `ASSETHARBOR_ADMIN_PASSWORD` env vars in the Docker container.
- JWT secret: `dev-jwt-secret-2026` (set as `ASSETHARBOR_JWT_SECRET` in Docker env)

**Note:** `admin@spaceharbor.dev` / `admin@spaceharbor.local` do NOT work — wrong domain.

## SPA Navigation Pattern
The app uses React Router. Direct `page.goto()` to protected routes triggers a redirect to `/login` because the JWT is in-memory and doesn't survive full page navigation.

**Solution:** Login first, then use SPA navigation:
```javascript
await page.evaluate((p) => {
  window.history.pushState({}, '', p);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}, '/target/path');
await page.waitForTimeout(1200);
```

## Screenshot Workflow
The Playwright Docker container cannot write to host paths. Use this workflow:
1. Capture to `/tmp/*.png` in the container
2. `docker cp competent_kare:/tmp/file.png /host/path/file.png`

**Note:** `competent_kare` is the container name — verify with `docker ps` as it changes per session.

## Known Issues (from 2026-03-22 audit)
1. **+ Ingest button missing from built app** — The Docker container runs an old build that does not include the `+ Ingest` button. Source has it at `/services/web-ui/src/pages/AssetBrowser.tsx:698` but it doesn't render in the built container. Regression vs current source.
2. **Sample data shown instead of real assets** — `fetchAssets()` returns HTTP 200 with empty array; the UI shows sample data. `apiReachable` remains `false` because the assets endpoint returns 0 results and the code falls to `.catch()`. Actually: the fetch _resolves_ with `[]`, so `apiReachable` should be true but samples still show — needs further investigation.
3. **API endpoints returning 4xx/5xx** — Multiple endpoints are unimplemented or broken in the Docker container:
   - `GET /api/v1/catalog/unregistered` → 503 (recurring)
   - `GET /api/v1/materials` → 500
   - `GET /api/v1/iam/users` → 404
   - `GET /api/v1/iam/audit-decisions` → 404
   - `GET /api/v1/shots/board` → 400
   - `GET /api/v1/timelines` → 500
   - `GET /api/v1/delivery/status` → 400
   - `GET /api/v1/pipeline/queue` → 404
   - `GET /api/v1/pipeline/dlq` → 404
   - `GET /api/v1/reviews/sessions` → 404
   - `GET /api/v1/work/queue` → 400
   - `GET /api/v1/work/assignments` → 400
4. **Settings section screenshots appear identical** — Settings page sections (S3/Auth/SCIM) appear cut off at scroll max of 684px; content extends to 1404px total height.
5. **Login error message is vague** — Shows "Invalid email or password" for any failure including server errors (JWT not configured).

## Screenshot Storage
`/Users/sergio.soto/Development/ai-apps/SpaceHarbor/docs/screenshots/`
Subdirs: login, settings, assets, search, admin, production, pipeline, review, work, errors
