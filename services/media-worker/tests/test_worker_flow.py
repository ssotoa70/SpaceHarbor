from worker.main import MediaWorker


class FakeControlPlaneClient:
    def __init__(self):
        self._claims = [
            {
                "id": "job-1",
                "assetId": "asset-1",
                "status": "processing",
                "attemptCount": 1,
            }
        ]
        self.events = []
        self.heartbeats = []

    def claim_next_job(self, worker_id: str, lease_seconds: int):
        if not self._claims:
            return None
        return self._claims.pop(0)

    def heartbeat_job(self, job_id: str, worker_id: str, lease_seconds: int):
        self.heartbeats.append(
            {
                "job_id": job_id,
                "worker_id": worker_id,
                "lease_seconds": lease_seconds,
            }
        )

    def post_event(self, payload):
        self.events.append(payload)


def test_worker_claims_job_emits_canonical_events_and_heartbeat():
    client = FakeControlPlaneClient()
    worker = MediaWorker(client, worker_id="worker-a", lease_seconds=30)

    processed = worker.process_next_job()

    assert processed is True
    assert len(client.events) == 2
    assert client.events[0]["eventType"] == "asset.processing.started"
    assert client.events[1]["eventType"] == "asset.processing.completed"
    assert client.events[0]["data"]["jobId"] == "job-1"
    assert client.events[1]["data"]["jobId"] == "job-1"
    assert len(client.heartbeats) == 1
    assert client.heartbeats[0]["job_id"] == "job-1"


def test_worker_returns_false_when_no_claim_available():
    client = FakeControlPlaneClient()
    client._claims = []

    worker = MediaWorker(client, worker_id="worker-a", lease_seconds=30)
    processed = worker.process_next_job()

    assert processed is False
    assert client.events == []


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

        # Simulate 3 errors by calling handle_error() which sleeps
        # This verifies the backoff sequence
        worker.handle_error()  # 2s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 2

        worker.handle_error()  # 4s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 4

        worker.handle_error()  # 8s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 8

        worker.handle_error()  # 16s backoff
        assert mock_sleep.call_args_list[-1][0][0] == 16

        worker.handle_error()  # 30s backoff (max)
        assert mock_sleep.call_args_list[-1][0][0] == 30

        # Verify backoff doesn't exceed max
        worker.handle_error()  # Still 30s
        assert mock_sleep.call_args_list[-1][0][0] == 30

        # Reset backoff should go back to 2s
        worker.reset_backoff()
        worker.handle_error()  # 2s again
        assert mock_sleep.call_args_list[-1][0][0] == 2
