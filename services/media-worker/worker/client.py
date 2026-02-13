import requests


class ControlPlaneClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def fetch_pending_jobs(self) -> list[dict]:
        response = requests.get(f"{self.base_url}/jobs/pending", timeout=10)
        response.raise_for_status()
        body = response.json()
        return body.get("jobs", [])

    def post_event(self, payload: dict) -> dict:
        response = requests.post(f"{self.base_url}/events", json=payload, timeout=10)
        response.raise_for_status()
        return response.json()
