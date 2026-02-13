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
