import hmac
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from src.routes.manager import router as manager_router

app = FastAPI(title="SpaceHarbor OpenAssetIO Manager", version="0.1.0")

# ── API Key Middleware ──────────────────────────────────────────────
# Reads the expected API key from SPACEHARBOR_API_KEY env var.
# If the var is not set, auth is skipped (development mode).
# Health check paths are always exempt from auth.

_HEALTH_PATHS = {"/health", "/health/"}


@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    """Validate x-api-key header using constant-time comparison.

    - Skips auth for health-check endpoints.
    - Skips auth when SPACEHARBOR_API_KEY is not configured (dev mode).
    - Returns 401 if the key is missing or does not match.
    """
    # Always allow health checks through without auth
    if request.url.path in _HEALTH_PATHS:
        return await call_next(request)

    expected_key = os.environ.get("SPACEHARBOR_API_KEY", "")

    # Development mode: no API key configured — skip auth
    if not expected_key:
        return await call_next(request)

    provided_key = request.headers.get("x-api-key", "")

    if not provided_key:
        return JSONResponse(
            status_code=401,
            content={"detail": "Missing x-api-key header"},
        )

    # Constant-time comparison to prevent timing attacks
    if not hmac.compare_digest(provided_key, expected_key):
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid API key"},
        )

    return await call_next(request)


# ── Routes ──────────────────────────────────────────────────────────

app.include_router(manager_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "openassetio-manager"}
