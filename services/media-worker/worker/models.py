from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4


@dataclass
class WorkflowEvent:
    event_type: str
    asset_id: str
    job_id: str
    correlation_id: str
    producer: str = "media-worker"
    event_version: str = "1.0"
    error: str | None = None

    def to_payload(self) -> dict:
        payload = {
            "eventId": str(uuid4()),
            "eventType": self.event_type,
            "eventVersion": self.event_version,
            "occurredAt": datetime.now(timezone.utc).isoformat(),
            "correlationId": self.correlation_id,
            "producer": self.producer,
            "data": {
                "assetId": self.asset_id,
                "jobId": self.job_id,
            },
        }

        if self.error:
            payload["data"]["error"] = self.error

        return payload
