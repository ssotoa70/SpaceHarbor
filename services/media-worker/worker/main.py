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
        self.error_backoff_seconds = 2
        self.max_backoff_seconds = 30

    def process_next_job(self) -> bool:
        """Process next job with error handling and automatic backoff.

        Returns True if a job was processed, False if no job available.
        Raises exceptions for network/system errors (caught by caller).
        """
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

    def handle_error(self) -> None:
        """Apply exponential backoff on errors.

        Backs off: 2s, 4s, 8s, 16s, 30s max
        """
        time.sleep(self.error_backoff_seconds)
        self.error_backoff_seconds = min(
            self.error_backoff_seconds * 2, self.max_backoff_seconds
        )

    def reset_backoff(self) -> None:
        """Reset backoff to initial value after successful processing."""
        self.error_backoff_seconds = 2


def run_forever() -> None:
    """Run the worker forever, claiming and processing jobs with error handling.

    - Polls for jobs every WORKER_POLL_SECONDS
    - Implements exponential backoff on errors: 2s, 4s, 8s, 16s, 30s max
    - Resets backoff on successful job processing
    """
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

    while True:
        try:
            processed = worker.process_next_job()
            if not processed:
                # No jobs available; wait before polling again
                time.sleep(poll_seconds)
            # Reset backoff on successful processing
            worker.reset_backoff()
        except (ConnectionError, TimeoutError) as e:
            # Network error; apply exponential backoff and retry
            print(
                f"[{worker_id}] Network error processing job: {e}. "
                f"Backing off {worker.error_backoff_seconds}s before retry.",
                flush=True,
            )
            worker.handle_error()
        except Exception as e:
            # Unexpected error; apply exponential backoff
            print(
                f"[{worker_id}] Unexpected error processing job: {e}",
                flush=True,
            )
            worker.handle_error()


if __name__ == "__main__":
    run_forever()
