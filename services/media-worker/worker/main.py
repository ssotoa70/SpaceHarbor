import os
import time

from worker.client import ControlPlaneClient
from worker.models import WorkflowEvent


class MediaWorker:
    def __init__(self, client):
        self.client = client

    def process_next_job(self) -> bool:
        jobs = self.client.fetch_pending_jobs()
        if not jobs:
            return False

        job = jobs[0]
        asset_id = job["assetId"]
        job_id = job["id"]

        started = WorkflowEvent(
            event_type="asset.processing.started",
            asset_id=asset_id,
            job_id=job_id,
        )
        self.client.post_event(started.to_payload())

        completed = WorkflowEvent(
            event_type="asset.processing.completed",
            asset_id=asset_id,
            job_id=job_id,
        )
        self.client.post_event(completed.to_payload())

        return True


def run_forever() -> None:
    base_url = os.environ.get("CONTROL_PLANE_URL", "http://localhost:8080")
    poll_seconds = float(os.environ.get("WORKER_POLL_SECONDS", "2"))

    worker = MediaWorker(ControlPlaneClient(base_url=base_url))

    while True:
        processed = worker.process_next_job()
        if not processed:
            time.sleep(poll_seconds)


if __name__ == "__main__":
    run_forever()
