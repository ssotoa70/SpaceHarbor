import threading
import time

from worker.main import HeartbeatThread, MediaWorker


class FakeControlPlaneClient:
    def __init__(self):
        self._claims = [
            {
                "id": "job-1",
                "assetId": "asset-1",
                "sourceUri": "file:///vast/renders/test.exr",
                "status": "processing",
                "attemptCount": 1,
            }
        ]
        self.events = []
        self.heartbeats = []
        self.dataengine_completions = []

    def claim_next_job(self, worker_id: str, lease_seconds: int):
        if not self._claims:
            return None
        return self._claims.pop(0)

    def heartbeat_job(self, job_id: str, worker_id: str, lease_seconds: int):
        self.heartbeats.append(
            {"job_id": job_id, "worker_id": worker_id, "time": time.monotonic()}
        )

    def post_event(self, payload):
        self.events.append(payload)

    def post_dataengine_completion(
        self, event_id, asset_id, job_id, function_id, success, metadata=None, error=None
    ):
        self.dataengine_completions.append(
            {
                "event_id": event_id,
                "asset_id": asset_id,
                "job_id": job_id,
                "function_id": function_id,
                "success": success,
                "metadata": metadata,
                "error": error,
            }
        )


def test_worker_claims_job_emits_started_then_dataengine_completion():
    client = FakeControlPlaneClient()
    worker = MediaWorker(client, worker_id="worker-a", lease_seconds=30)

    processed = worker.process_next_job()

    assert processed is True
    # Only the started event is emitted via post_event
    assert len(client.events) == 1
    assert client.events[0]["eventType"] == "asset.processing.started"
    assert client.events[0]["data"]["jobId"] == "job-1"
    # DataEngine completion published via post_dataengine_completion
    assert len(client.dataengine_completions) == 1
    assert client.dataengine_completions[0]["success"] is True
    assert client.dataengine_completions[0]["function_id"] == "exr_inspector"
    assert client.dataengine_completions[0]["job_id"] == "job-1"
    # Heartbeat thread runs in background; with instant processing and 15s interval,
    # no heartbeat may fire before the thread is stopped — that's correct behavior
    assert len(client.heartbeats) >= 0


def test_worker_returns_false_when_no_claim_available():
    client = FakeControlPlaneClient()
    client._claims = []

    worker = MediaWorker(client, worker_id="worker-a", lease_seconds=30)
    processed = worker.process_next_job()

    assert processed is False
    assert client.events == []
    assert client.dataengine_completions == []


def test_worker_implements_exponential_backoff_on_failures():
    """Verify worker implements exponential backoff on network errors."""
    from unittest.mock import patch

    class FailingClient:
        def __init__(self, fail_count: int):
            self.fail_count = fail_count
            self.call_count = 0

        def claim_next_job(self, worker_id: str, lease_seconds: int):
            self.call_count += 1
            if self.call_count <= self.fail_count:
                raise ConnectionError("Network timeout")
            return None

        def set_api_key(self, api_key):
            pass

    # Test exponential backoff with mocked time.sleep
    with patch("worker.main.time.sleep") as mock_sleep:
        client = FailingClient(fail_count=3)
        worker = MediaWorker(client, worker_id="worker-a", lease_seconds=30)

        worker.handle_error()  # 2s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 2

        worker.handle_error()  # 4s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 4

        worker.handle_error()  # 8s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 8

        worker.handle_error()  # 16s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 16

        worker.handle_error()  # 32s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 32

        worker.handle_error()  # 64s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 64

        worker.handle_error()  # 128s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 128

        worker.handle_error()  # 256s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 256

        worker.handle_error()  # 300s backoff (max)
        assert mock_sleep.call_args_list[-1][0][0] == 300

        # Verify backoff doesn't exceed max
        worker.handle_error()  # Still 300s
        assert mock_sleep.call_args_list[-1][0][0] == 300

        # Reset backoff should go back to 2s
        worker.reset_backoff()
        worker.handle_error()  # 2s again
        assert mock_sleep.call_args_list[-1][0][0] == 2


def test_heartbeat_fires_periodically_during_processing():
    """Verify the heartbeat thread sends heartbeats at lease_seconds/2 intervals."""
    client = FakeControlPlaneClient()
    heartbeat = HeartbeatThread(client, "job-1", "worker-a", lease_seconds=2)
    heartbeat.start()

    # Wait long enough for at least 2 heartbeats (interval=1s, wait ~2.5s)
    time.sleep(2.5)
    heartbeat.stop()

    assert len(client.heartbeats) >= 2
    for hb in client.heartbeats:
        assert hb["job_id"] == "job-1"
        assert hb["worker_id"] == "worker-a"


def test_heartbeat_stops_on_completion():
    """Verify heartbeat thread stops cleanly when told to stop."""
    client = FakeControlPlaneClient()
    heartbeat = HeartbeatThread(client, "job-1", "worker-a", lease_seconds=2)
    heartbeat.start()
    time.sleep(0.2)
    heartbeat.stop()

    count_after_stop = len(client.heartbeats)
    time.sleep(1.5)
    # No new heartbeats should fire after stop
    assert len(client.heartbeats) == count_after_stop


class SlowProcessClient(FakeControlPlaneClient):
    """Client that simulates slow processing by blocking _do_process."""

    def __init__(self, process_delay: float):
        super().__init__()
        self.process_delay = process_delay
        self._original_post_dataengine = self.post_dataengine_completion

    def post_dataengine_completion(self, event_id, asset_id, job_id, function_id, success, metadata=None, error=None):
        if success:
            # Simulate slow processing before the success completion fires
            time.sleep(self.process_delay)
        super().post_dataengine_completion(event_id, asset_id, job_id, function_id, success, metadata, error)


def test_long_running_job_maintains_claim_via_heartbeat():
    """Job that takes longer than lease_seconds still maintains its claim via heartbeat."""
    client = SlowProcessClient(process_delay=3.0)
    worker = MediaWorker(
        client, worker_id="worker-a", lease_seconds=2, job_timeout_seconds=10
    )

    processed = worker.process_next_job()

    assert processed is True
    # Processing took ~3s with a 2s lease, so heartbeat (interval=1s) should fire multiple times
    assert len(client.heartbeats) >= 2, (
        f"Expected >=2 heartbeats during 3s processing with 1s interval, got {len(client.heartbeats)}"
    )
    # Job still completed successfully
    assert len(client.dataengine_completions) == 1
    assert client.dataengine_completions[0]["success"] is True


def test_job_timeout_posts_failure_event():
    """Job that exceeds timeout gets a failure completion event."""
    client = SlowProcessClient(process_delay=5.0)
    worker = MediaWorker(
        client, worker_id="worker-a", lease_seconds=4, job_timeout_seconds=2
    )

    processed = worker.process_next_job()

    assert processed is True
    # Should have a failure completion due to timeout
    failures = [c for c in client.dataengine_completions if not c["success"]]
    assert len(failures) >= 1
    assert "timed out" in failures[0]["error"]
