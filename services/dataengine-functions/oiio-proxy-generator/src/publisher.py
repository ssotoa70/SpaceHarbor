import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

log = logging.getLogger("oiio-proxy-generator")

try:
    from confluent_kafka import Producer
except ImportError:
    Producer = None  # type: ignore[assignment,misc]


@dataclass
class ProxyGeneratedEvent:
    asset_id: str
    thumbnail_uri: str
    proxy_uri: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    type: str = "proxy.generated"

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "asset_id": self.asset_id,
            "thumbnail_uri": self.thumbnail_uri,
            "proxy_uri": self.proxy_uri,
            "timestamp": self.timestamp,
        }


def publish_proxy_generated(
    asset_id: str,
    thumbnail_uri: str,
    proxy_uri: str,
    broker: str = "vastbroker:9092",
    topic: str = "assetharbor.proxy",
    dev_mode: bool = False,
) -> None:
    event = ProxyGeneratedEvent(
        asset_id=asset_id,
        thumbnail_uri=thumbnail_uri,
        proxy_uri=proxy_uri,
    )
    payload = json.dumps(event.to_dict()).encode("utf-8")

    if dev_mode or os.environ.get("DEV_MODE", "false").lower() == "true":
        log.info(f"[DEV] proxy.generated event (not publishing to Kafka): {event.to_dict()}")
        return

    producer = Producer({"bootstrap.servers": broker})
    producer.produce(
        topic=topic,
        key=asset_id.encode("utf-8"),
        value=payload,
        on_delivery=lambda err, msg: log.error(f"Kafka delivery error: {err}") if err else None,
    )
    producer.flush()
    log.info(f"Published proxy.generated for asset {asset_id}")
