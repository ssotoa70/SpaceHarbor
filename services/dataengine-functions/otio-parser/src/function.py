"""VAST DataEngine entrypoint for otio-parser.

Called by VAST DataEngine when a timeline file (.otio, .edl) is ingested.

Environment variables:
  VAST_SOURCE_PATH  - NFS path to the timeline file
  VAST_ASSET_ID     - AssetHarbor asset ID
  KAFKA_BROKER      - Kafka broker address (default: vastbroker:9092)
  KAFKA_TOPIC       - Kafka topic (default: assetharbor.otio)
  DEV_MODE          - If "true", skip Kafka publishing
"""

import json
import logging
import os
import sys

from src.parser import parse_timeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("otio-parser")


def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")

    log.info(f"Processing timeline asset {asset_id}: {source_path}")

    if not source_path or not asset_id:
        log.error("VAST_SOURCE_PATH and VAST_ASSET_ID must be set")
        return 1

    try:
        result = parse_timeline(source_path)
        log.info(f"Parsed timeline: {result['timeline_name']} ({len(result['tracks'])} tracks)")
        _publish_completion(asset_id, result)
        return 0
    except FileNotFoundError as e:
        log.error(f"File not found: {e}")
        return 1
    except ImportError as e:
        log.error(f"Missing dependency: {e}")
        return 1
    except Exception as e:
        log.error(f"Parsing failed: {e}", exc_info=True)
        return 1


def _publish_completion(asset_id: str, result: dict) -> None:
    if os.environ.get("DEV_MODE", "false").lower() == "true":
        log.info(f"[DEV] skipping Kafka publish for asset {asset_id}")
        return

    try:
        from confluent_kafka import Producer

        broker = os.environ.get("KAFKA_BROKER", "vastbroker:9092")
        topic = os.environ.get("KAFKA_TOPIC", "assetharbor.otio")
        producer = Producer({"bootstrap.servers": broker})
        event = {"eventType": "otio_parsed", "assetId": asset_id, "parseResult": result}
        producer.produce(topic, json.dumps(event).encode("utf-8"))
        producer.flush()
        log.info(f"Published otio_parsed for asset {asset_id}")
    except ImportError:
        log.error("confluent-kafka not installed; cannot publish")
    except Exception as e:
        log.error(f"Failed to publish event: {e}")


if __name__ == "__main__":
    sys.exit(main())
