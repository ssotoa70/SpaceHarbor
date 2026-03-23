import pytest
import json
from unittest.mock import patch, MagicMock
from src.publisher import publish_proxy_generated, ProxyGeneratedEvent


def test_proxy_generated_event_shape():
    event = ProxyGeneratedEvent(
        asset_id="abc123",
        thumbnail_uri="/vast/thumbnails/abc123.jpg",
        proxy_uri="/vast/proxies/abc123_proxy.mp4",
    )
    payload = event.to_dict()
    assert payload["type"] == "proxy.generated"
    assert payload["asset_id"] == "abc123"
    assert "thumbnail_uri" in payload
    assert "proxy_uri" in payload
    assert "timestamp" in payload


def test_publish_calls_kafka_producer(monkeypatch):
    mock_producer = MagicMock()
    with patch("src.publisher.Producer", return_value=mock_producer):
        publish_proxy_generated(
            asset_id="abc123",
            thumbnail_uri="/vast/thumbnails/abc123.jpg",
            proxy_uri="/vast/proxies/abc123_proxy.mp4",
            broker="localhost:9092",
            topic="spaceharbor.proxy",
            dev_mode=False,
        )
    mock_producer.produce.assert_called_once()
    call_kwargs = mock_producer.produce.call_args[1]
    assert call_kwargs["topic"] == "spaceharbor.proxy"
    value = json.loads(call_kwargs["value"])
    assert value["asset_id"] == "abc123"
    assert value["type"] == "proxy.generated"
    mock_producer.flush.assert_called_once()


def test_publish_dev_mode_does_not_call_kafka():
    """In dev mode, publish logs but does not connect to Kafka."""
    with patch("src.publisher.Producer") as mock_cls:
        publish_proxy_generated(
            asset_id="abc123",
            thumbnail_uri="/tmp/thumb.jpg",
            proxy_uri="/tmp/proxy.mp4",
            broker="localhost:9092",
            topic="spaceharbor.proxy",
            dev_mode=True,
        )
        mock_cls.assert_not_called()
