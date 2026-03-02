import os
import time
from uuid import uuid4

from worker.client import ControlPlaneClient
from worker.models import WorkflowEvent


class MediaWorker:
    def __init__(self, client, worker_id: str, lease_seconds: int):
        self.client = client
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds

    def process_next_job(self) -> bool:
        claimed = self.client.claim_next_job(self.worker_id, self.lease_seconds)
        if not claimed:
            return False

        job_id = claimed["id"]
        asset_id = claimed["assetId"]
        correlation_id = f"corr-{self.worker_id}-{job_id}-{uuid4()}"

        started = WorkflowEvent(
            event_type="asset.processing.started",
            asset_id=asset_id,
            job_id=job_id,
            correlation_id=correlation_id,
        )
        self.client.post_event(started.to_payload())

        self.client.heartbeat_job(job_id, self.worker_id, self.lease_seconds)

        completed = WorkflowEvent(
            event_type="asset.processing.completed",
            asset_id=asset_id,
            job_id=job_id,
            correlation_id=correlation_id,
        )
        self.client.post_event(completed.to_payload())

        return True


def run_forever() -> None:
    base_url = os.environ.get("CONTROL_PLANE_URL", "http://localhost:8080")
    poll_seconds = float(os.environ.get("WORKER_POLL_SECONDS", "2"))
    worker_id = os.environ.get("WORKER_ID", "media-worker-1")
    lease_seconds = int(os.environ.get("WORKER_LEASE_SECONDS", "30"))
    control_plane_api_key = os.environ.get("CONTROL_PLANE_API_KEY")

    client = ControlPlaneClient(base_url=base_url)
    client.set_api_key(control_plane_api_key)

    worker = MediaWorker(
        client,
        worker_id=worker_id,
        lease_seconds=lease_seconds,
    )

    error_backoff_seconds = 2
    while True:
        try:
            processed = worker.process_next_job()
            if not processed:
                time.sleep(poll_seconds)
            # Reset backoff on successful processing
            error_backoff_seconds = 2
        except Exception as e:
            # Exponential backoff on error: 2s, 4s, 8s, 16s, 30s max
            print(f"[{worker_id}] Error processing job: {e}", flush=True)
            time.sleep(error_backoff_seconds)
            error_backoff_seconds = min(error_backoff_seconds * 2, 30)


if __name__ == "__main__":
    run_forever()
