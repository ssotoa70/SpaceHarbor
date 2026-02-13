import requests


class ControlPlaneClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = None

    def set_api_key(self, api_key: str | None):
        self.api_key = api_key

    def _headers(self):
        if not self.api_key:
            return {}
        return {"x-api-key": self.api_key}

    def claim_next_job(self, worker_id: str, lease_seconds: int) -> dict | None:
        response = requests.post(
            f"{self.base_url}/api/v1/queue/claim",
            json={
                "workerId": worker_id,
                "leaseSeconds": lease_seconds,
            },
            headers=self._headers(),
            timeout=10,
        )
        response.raise_for_status()
        body = response.json()
        return body.get("job")

    def heartbeat_job(self, job_id: str, worker_id: str, lease_seconds: int) -> dict:
        response = requests.post(
            f"{self.base_url}/api/v1/jobs/{job_id}/heartbeat",
            json={
                "workerId": worker_id,
                "leaseSeconds": lease_seconds,
            },
            headers=self._headers(),
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    def post_event(self, payload: dict) -> dict:
        response = requests.post(
            f"{self.base_url}/api/v1/events",
            json=payload,
            headers=self._headers(),
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
