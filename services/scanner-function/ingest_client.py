"""HTTP client for the AssetHarbor control-plane /assets/ingest endpoint."""
import requests
from typing import Optional


class DuplicateIngestError(Exception):
    pass


class IngestClient:
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        if api_key:
            self.session.headers["x-api-key"] = api_key

    def ingest_file(
        self,
        *,
        source_uri: str,
        title: str,
        shot_id: Optional[str] = None,
        project_id: Optional[str] = None,
        version_label: Optional[str] = None,
        file_size: Optional[int] = None,
        md5_checksum: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> dict:
        payload: dict = {"title": title, "sourceUri": source_uri}
        if shot_id is not None:
            payload["shotId"] = shot_id
        if project_id is not None:
            payload["projectId"] = project_id
        if version_label is not None:
            payload["versionLabel"] = version_label
        if file_size is not None:
            payload["fileSizeBytes"] = file_size
        if md5_checksum is not None:
            payload["md5Checksum"] = md5_checksum
        if created_by is not None:
            payload["createdBy"] = created_by

        resp = self.session.post(f"{self.base_url}/assets/ingest", json=payload)

        if resp.status_code == 409:
            raise DuplicateIngestError(f"Asset already ingested: {source_uri}")

        resp.raise_for_status()
        return resp.json()
