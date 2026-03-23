"""Shared CloudEvent publisher for VAST DataEngine functions.

Publishes completion events in CloudEvent format compatible with
the control-plane VastEventSubscriber (Kafka consumer).

Usage:
    from shared.cloudevent_publisher import publish_completion

    publish_completion(
        function_name="exr_inspector",
        asset_id="abc123",
        job_id="j456",
        success=True,
        metadata={"resolution": {"width": 4096, "height": 2160}},
    )
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone

log = logging.getLogger(__name__)

try:
    from confluent_kafka import Producer
except ImportError:
    Producer = None  # type: ignore[assignment,misc]


def publish_completion(
    function_name: str,
    asset_id: str,
    job_id: str = "",
    success: bool = True,
    metadata: dict | None = None,
    error: str | None = None,
) -> None:
    """Publish a VAST DataEngine completion CloudEvent to Kafka.

    Args:
        function_name: Name of the DataEngine function (e.g., "exr_inspector")
        asset_id: SpaceHarbor asset ID
        job_id: Workflow job ID (optional)
        success: Whether the function completed successfully
        metadata: Optional result metadata dict
        error: Error message if success=False
    """
    broker = os.environ.get("KAFKA_BROKER")
    environment = os.environ.get("ENVIRONMENT", "development")

    if not broker:
        if environment == "production":
            raise ValueError(
                f"KAFKA_BROKER is not set in production — cannot publish completion event "
                f"for {function_name}. Set KAFKA_BROKER or ENVIRONMENT=development."
            )
        log.info(f"[DEV] No KAFKA_BROKER set — skipping publish for {function_name}")
        return

    if Producer is None:
        raise RuntimeError(
            "confluent-kafka not installed; cannot publish completion event. "
            "Install with: pip install confluent-kafka"
        )

    topic = os.environ.get(
        "KAFKA_COMPLETION_TOPIC",
        "spaceharbor.dataengine.completed",
    )

    flush_timeout = int(os.environ.get("KAFKA_FLUSH_TIMEOUT", "5"))

    event = {
        "specversion": "1.0",
        "type": "vast.dataengine.pipeline.completed",
        "source": f"spaceharbor/{function_name}",
        "id": str(uuid.uuid4()),
        "time": datetime.now(timezone.utc).isoformat(),
        "data": {
            "asset_id": asset_id,
            "job_id": job_id,
            "function_id": function_name,
            "success": success,
        },
    }

    if metadata:
        event["data"]["metadata"] = metadata
    if error:
        event["data"]["error"] = error

    _delivery_error: list[str] = []

    def _on_delivery(err, msg):
        if err:
            _delivery_error.append(str(err))

    producer = Producer({"bootstrap.servers": broker})
    producer.produce(
        topic=topic,
        key=asset_id.encode("utf-8"),
        value=json.dumps(event).encode("utf-8"),
        on_delivery=_on_delivery,
    )
    remaining = producer.flush(timeout=flush_timeout)
    if remaining > 0:
        raise RuntimeError(
            f"Kafka flush timeout: {remaining} message(s) still pending after "
            f"{flush_timeout}s for {function_name} asset={asset_id}"
        )
    if _delivery_error:
        raise RuntimeError(
            f"Kafka delivery failed for {function_name} asset={asset_id}: "
            f"{_delivery_error[0]}"
        )
    log.info(f"Published completion event for {function_name} asset={asset_id}")
