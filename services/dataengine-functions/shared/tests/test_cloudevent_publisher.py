"""Tests for shared CloudEvent publisher."""

import json
import pytest
from unittest.mock import patch, MagicMock

from shared.cloudevent_publisher import publish_completion


class TestPublishCompletion:
    @patch.dict("os.environ", {}, clear=True)
    def test_noop_when_no_kafka_broker(self):
        """Dev mode: no-op when KAFKA_BROKER is unset."""
        # Should not raise
        publish_completion(
            function_name="test_func",
            asset_id="abc123",
            success=True,
        )

    @patch.dict("os.environ", {"KAFKA_BROKER": "broker:9092"})
    @patch("shared.cloudevent_publisher.Producer")
    def test_produces_cloudevent_v1_format(self, mock_producer_cls):
        mock_producer = MagicMock()
        mock_producer_cls.return_value = mock_producer

        publish_completion(
            function_name="exr_inspector",
            asset_id="abc123",
            job_id="j456",
            success=True,
            metadata={"resolution": {"width": 4096}},
        )

        mock_producer.produce.assert_called_once()
        call_kwargs = mock_producer.produce.call_args
        payload = json.loads(call_kwargs.kwargs.get("value") or call_kwargs[1].get("value"))

        # Verify CloudEvent v1.0 schema
        assert payload["specversion"] == "1.0"
        assert payload["type"] == "vast.dataengine.pipeline.completed"
        assert payload["source"] == "spaceharbor/exr_inspector"
        assert isinstance(payload["id"], str)
        assert isinstance(payload["time"], str)
        assert payload["data"]["asset_id"] == "abc123"
        assert payload["data"]["job_id"] == "j456"
        assert payload["data"]["function_id"] == "exr_inspector"
        assert payload["data"]["success"] is True
        assert payload["data"]["metadata"]["resolution"]["width"] == 4096

    @patch.dict("os.environ", {"KAFKA_BROKER": "broker:9092"})
    @patch("shared.cloudevent_publisher.Producer")
    def test_produces_error_event(self, mock_producer_cls):
        mock_producer = MagicMock()
        mock_producer_cls.return_value = mock_producer

        publish_completion(
            function_name="mtlx_parser",
            asset_id="def456",
            success=False,
            error="File not found",
        )

        payload = json.loads(
            mock_producer.produce.call_args.kwargs.get("value")
            or mock_producer.produce.call_args[1].get("value")
        )
        assert payload["data"]["success"] is False
        assert payload["data"]["error"] == "File not found"

    @patch.dict("os.environ", {"KAFKA_BROKER": "broker:9092"})
    @patch("shared.cloudevent_publisher.Producer")
    def test_uses_correct_topic(self, mock_producer_cls):
        mock_producer = MagicMock()
        mock_producer_cls.return_value = mock_producer

        publish_completion(
            function_name="test",
            asset_id="a1",
            success=True,
        )

        call_kwargs = mock_producer.produce.call_args
        topic = call_kwargs.kwargs.get("topic") or call_kwargs[1].get("topic")
        assert topic == "spaceharbor.dataengine.completed"

    @patch.dict("os.environ", {
        "KAFKA_BROKER": "broker:9092",
        "KAFKA_COMPLETION_TOPIC": "custom.topic",
    })
    @patch("shared.cloudevent_publisher.Producer")
    def test_custom_topic_override(self, mock_producer_cls):
        mock_producer = MagicMock()
        mock_producer_cls.return_value = mock_producer

        publish_completion(function_name="test", asset_id="a1", success=True)

        call_kwargs = mock_producer.produce.call_args
        topic = call_kwargs.kwargs.get("topic") or call_kwargs[1].get("topic")
        assert topic == "custom.topic"

    @patch.dict("os.environ", {"KAFKA_BROKER": "broker:9092"})
    @patch("shared.cloudevent_publisher.Producer")
    def test_key_is_asset_id(self, mock_producer_cls):
        mock_producer = MagicMock()
        mock_producer_cls.return_value = mock_producer

        publish_completion(function_name="test", asset_id="myasset", success=True)

        call_kwargs = mock_producer.produce.call_args
        key = call_kwargs.kwargs.get("key") or call_kwargs[1].get("key")
        assert key == b"myasset"
