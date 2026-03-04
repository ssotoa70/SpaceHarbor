from worker.main import MediaWorker


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
        self.heartbeats.append({"job_id": job_id})

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
    assert len(client.heartbeats) == 1


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
