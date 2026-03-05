import requests
from dataclasses import dataclass, field


class AssetNotFoundError(Exception):
    pass


@dataclass
class VastResolver:
    trino_host: str
    trino_port: int
    dev_mode: bool = False
    _dev_store: dict = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self):
        self._dev_store = {
            "asset:abc123": "mock://vast/ingest/abc123/source.exr",
            "asset:def456": "mock://vast/ingest/def456/source.mov",
        }

    def resolve(self, entity_ref: str) -> str:
        """Resolve an entity reference to a VAST URI."""
        if self.dev_mode:
            uri = self._dev_store.get(entity_ref)
            if uri is None:
                raise AssetNotFoundError(f"Asset not found: {entity_ref}")
            return uri

        asset_id = entity_ref.removeprefix("asset:")
        return self._query_vastdb(asset_id)

    def _query_vastdb(self, asset_id: str) -> str:
        """Query VastDB via Trino REST API for asset source URI."""
        url = f"http://{self.trino_host}:{self.trino_port}/v1/statement"
        query = f"SELECT source_uri FROM assetharbor.assets WHERE id = '{asset_id}' LIMIT 1"
        headers = {"X-Trino-User": "assetharbor", "Content-Type": "text/plain"}
        response = requests.post(url, data=query, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        rows = data.get("data", [])
        if not rows:
            raise AssetNotFoundError(f"Asset not found in VastDB: {asset_id}")
        return rows[0][0]

    def list_assets(self, shot_id: str | None = None, project_id: str | None = None) -> list[dict]:
        """List assets optionally filtered by shot or project."""
        if self.dev_mode:
            return [
                {"id": "abc123", "name": "hero_plate_v001.exr", "shot_id": shot_id or "sh010"},
                {"id": "def456", "name": "hero_plate_v002.mov", "shot_id": shot_id or "sh010"},
            ]
        filters = []
        if shot_id:
            filters.append(f"shot_id = '{shot_id}'")
        if project_id:
            filters.append(f"project_id = '{project_id}'")
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        query = f"SELECT id, name, shot_id, source_uri FROM assetharbor.assets {where} LIMIT 100"
        url = f"http://{self.trino_host}:{self.trino_port}/v1/statement"
        headers = {"X-Trino-User": "assetharbor", "Content-Type": "text/plain"}
        response = requests.post(url, data=query, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        return [
            {"id": r[0], "name": r[1], "shot_id": r[2], "source_uri": r[3]}
            for r in data.get("data", [])
        ]
