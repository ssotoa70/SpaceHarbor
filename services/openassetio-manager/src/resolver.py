"""OpenAssetIO resolver that queries the AssetHarbor control-plane API.

In production, resolves entity references via HTTP calls to the control-plane.
In dev mode (ASSETHARBOR_CONTROL_PLANE_URL not set), falls back to in-memory store.
"""

import os
import logging
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    import requests
    HAS_HTTPX = False


class AssetNotFoundError(Exception):
    pass


@dataclass
class VastResolver:
    trino_host: str = ""
    trino_port: int = 8080
    dev_mode: bool = False
    _dev_store: dict = field(default_factory=dict, init=False, repr=False)
    _control_plane_url: str = field(default="", init=False, repr=False)

    def __post_init__(self):
        self._control_plane_url = os.environ.get("ASSETHARBOR_CONTROL_PLANE_URL", "")

        if not self._control_plane_url:
            self.dev_mode = True

        self._dev_store = {
            "asset:abc123": "mock://vast/ingest/abc123/source.exr",
            "asset:def456": "mock://vast/ingest/def456/source.mov",
        }

    def resolve(self, entity_ref: str) -> str:
        """Resolve an entity reference to a source URI."""
        if self.dev_mode and not self._control_plane_url:
            uri = self._dev_store.get(entity_ref)
            if uri is None:
                raise AssetNotFoundError(f"Asset not found: {entity_ref}")
            return uri

        asset_id = entity_ref.removeprefix("asset:")
        return self._query_control_plane(f"/api/v1/assets/{asset_id}", "sourceUri")

    def register(self, entity_ref: str, data: dict) -> dict:
        """Register a new asset via the control-plane ingest endpoint."""
        if self.dev_mode and not self._control_plane_url:
            asset_id = entity_ref.removeprefix("asset:")
            self._dev_store[entity_ref] = data.get("sourceUri", f"mock://vast/{asset_id}")
            return {"id": asset_id, "status": "registered"}

        url = f"{self._control_plane_url}/api/v1/assets/ingest"
        payload = {
            "title": data.get("title", "Untitled"),
            "sourceUri": data.get("sourceUri", ""),
        }
        response = self._http_post(url, payload)
        return response

    def browse(self, entity_ref: str) -> list[dict]:
        """Browse assets or timelines based on entity reference type."""
        if self.dev_mode and not self._control_plane_url:
            return [
                {"id": "abc123", "name": "hero_plate_v001.exr", "shot_id": "sh010"},
                {"id": "def456", "name": "hero_plate_v002.mov", "shot_id": "sh010"},
            ]

        if entity_ref.startswith("timeline:"):
            return self._http_get(f"{self._control_plane_url}/api/v1/timelines")
        return self._http_get(f"{self._control_plane_url}/api/v1/assets")

    def list_assets(self, shot_id: str | None = None, project_id: str | None = None) -> list[dict]:
        """List assets optionally filtered by shot or project."""
        if self.dev_mode and not self._control_plane_url:
            return [
                {"id": "abc123", "name": "hero_plate_v001.exr", "shot_id": shot_id or "sh010"},
                {"id": "def456", "name": "hero_plate_v002.mov", "shot_id": shot_id or "sh010"},
            ]

        params = {}
        if shot_id:
            params["shotId"] = shot_id
        if project_id:
            params["projectId"] = project_id

        url = f"{self._control_plane_url}/api/v1/assets"
        return self._http_get(url, params)

    def _query_control_plane(self, path: str, field: str) -> str:
        """Query control-plane API and extract a field from the response."""
        url = f"{self._control_plane_url}{path}"
        data = self._http_get(url)
        if isinstance(data, dict):
            value = data.get(field)
            if value:
                return str(value)
        raise AssetNotFoundError(f"Asset not found at {path}")

    def _http_get(self, url: str, params: dict | None = None) -> any:
        """HTTP GET with httpx or requests fallback."""
        try:
            if HAS_HTTPX:
                resp = httpx.get(url, params=params, timeout=10)
                resp.raise_for_status()
                return resp.json()
            else:
                resp = requests.get(url, params=params, timeout=10)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            log.error(f"HTTP GET {url} failed: {e}")
            raise AssetNotFoundError(f"Failed to query {url}: {e}") from e

    def _http_post(self, url: str, payload: dict) -> dict:
        """HTTP POST with httpx or requests fallback."""
        try:
            if HAS_HTTPX:
                resp = httpx.post(url, json=payload, timeout=10)
                resp.raise_for_status()
                return resp.json()
            else:
                resp = requests.post(url, json=payload, timeout=10)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            log.error(f"HTTP POST {url} failed: {e}")
            raise AssetNotFoundError(f"Failed to post to {url}: {e}") from e
