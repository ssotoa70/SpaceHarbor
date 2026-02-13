from dataclasses import dataclass
from datetime import datetime, UTC
from uuid import uuid4


@dataclass
class WorkflowEvent:
    event_type: str
    asset_id: str
    job_id: str
    producer: str = "media-worker"
    schema_version: str = "1.0"
    error: str | None = None

    def to_payload(self) -> dict:
        payload = {
            "event_id": str(uuid4()),
            "event_type": self.event_type,
            "asset_id": self.asset_id,
            "occurred_at": datetime.now(UTC).isoformat(),
            "producer": self.producer,
            "schema_version": self.schema_version,
            "data": {
                "job_id": self.job_id,
            },
        }

        if self.error:
            payload["data"]["error"] = self.error

        return payload
