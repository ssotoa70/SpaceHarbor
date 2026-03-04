"""
DEV SIMULATION MODE
===================
This file simulates VAST DataEngine behavior locally when no VAST cluster is available.

In production (VAST environment):
- VAST element triggers fire automatically when files land in VAST views
- VAST DataEngine runs registered pipeline functions (exr_inspector, ASR, transcode, etc.)
- VAST Event Broker publishes completion CloudEvents to Kafka
- Control-plane VastEventSubscriber consumes those events

This file is NOT used in production VAST environments.
"""

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
        self.max_backoff_seconds = 300  # 5 minutes for long-running jobs

    def process_next_job(self) -> bool:
        """DEV SIMULATION: claim a job, run mock pipeline, publish DataEngine completion event.

        Returns True if a job was processed, False if no job available.
        Raises exceptions for network/system errors (caught by caller).

        In production, VAST DataEngine element triggers replace this entire flow.
        """
        claimed = self.client.claim_next_job(self.worker_id, self.lease_seconds)
        if not claimed:
            return False

        job_id = claimed["id"]
        asset_id = claimed["assetId"]
        correlation_id = f"dev-sim-{self.worker_id}-{job_id}-{uuid4()}"

        # Emit started event so the UI can show processing state
        started = WorkflowEvent(
            event_type="asset.processing.started",
            asset_id=asset_id,
            job_id=job_id,
            correlation_id=correlation_id,
        )
        self.client.post_event(started.to_payload())

        self.client.heartbeat_job(job_id, self.worker_id, self.lease_seconds)

        try:
            # DEV SIMULATION: run local mock pipeline
            # In production, VAST DataEngine runs the real function
            mock_metadata = {
                "codec": "exr",
                "resolution": {"width": 4096, "height": 2160},
                "frame_rate": 24.0,
                "file_size_bytes": 52428800,
            }

            # Publish mock VAST DataEngine completion event to control-plane HTTP endpoint.
            # Control-plane VastEventSubscriber will receive and update job status + metadata.
            self.client.post_dataengine_completion(
                event_id=str(uuid4()),
                asset_id=asset_id,
                job_id=job_id,
                function_id="exr_inspector",
                success=True,
                metadata=mock_metadata,
            )

        except Exception as exc:
            self.client.post_dataengine_completion(
                event_id=str(uuid4()),
                asset_id=asset_id,
                job_id=job_id,
                function_id="exr_inspector",
                success=False,
                error=str(exc),
            )

        return True

    def handle_error(self) -> None:
        """Apply exponential backoff on errors.

        Backs off: 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 300s max
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
    - Implements exponential backoff on errors: 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 300s max
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
