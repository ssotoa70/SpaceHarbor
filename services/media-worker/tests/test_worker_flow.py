from worker.main import MediaWorker


class FakeControlPlaneClient:
    def __init__(self):
        self._jobs = [
            {
                "id": "job-1",
                "assetId": "asset-1",
                "status": "pending",
            }
        ]
        self.events = []

    def fetch_pending_jobs(self):
        return list(self._jobs)

    def post_event(self, payload):
        self.events.append(payload)


def test_worker_emits_started_and_completed_events_for_pending_job():
    client = FakeControlPlaneClient()
    worker = MediaWorker(client)

    processed = worker.process_next_job()

    assert processed is True
    assert len(client.events) == 2
    assert client.events[0]["event_type"] == "asset.processing.started"
    assert client.events[1]["event_type"] == "asset.processing.completed"
    assert client.events[0]["data"]["job_id"] == "job-1"
    assert client.events[1]["data"]["job_id"] == "job-1"
