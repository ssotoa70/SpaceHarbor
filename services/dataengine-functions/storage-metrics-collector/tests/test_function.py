"""Tests for storage-metrics-collector DataEngine function."""

import pytest
from unittest.mock import patch, MagicMock
import json
import sys


class TestCollectProjectMetrics:
    """Test S3 metrics collection logic."""

    def test_single_page_collection(self):
        """Test collection with a single S3 page of objects."""
        from src.function import collect_project_metrics

        mock_client = MagicMock()
        mock_paginator = MagicMock()
        mock_client.get_paginator.return_value = mock_paginator

        # Simulate single page with mixed media types
        mock_paginator.paginate.return_value = [
            {
                "Contents": [
                    {"Key": "projects/proj1/hero.exr", "Size": 1000000},  # primary media
                    {"Key": "projects/proj1/hero_proxy.mp4", "Size": 50000},  # proxy
                    {"Key": "projects/proj1/hero_thumb.jpg", "Size": 5000},  # thumbnail
                ]
            }
        ]

        result = collect_project_metrics(mock_client, "spaceharbor-media", "projects/proj1/")

        assert result["total_bytes"] == 1055000
        assert result["file_count"] == 3
        assert result["proxy_bytes"] == 50000
        assert result["thumbnail_bytes"] == 5000

    def test_pagination_accumulation(self):
        """Test collection across multiple S3 pages."""
        from src.function import collect_project_metrics

        mock_client = MagicMock()
        mock_paginator = MagicMock()
        mock_client.get_paginator.return_value = mock_paginator

        # Simulate two pages
        mock_paginator.paginate.return_value = [
            {
                "Contents": [
                    {"Key": "projects/proj1/file1.exr", "Size": 1000000},
                    {"Key": "projects/proj1/file1_proxy.mov", "Size": 60000},
                ]
            },
            {
                "Contents": [
                    {"Key": "projects/proj1/file2.exr", "Size": 2000000},
                    {"Key": "projects/proj1/file2_thumb.png", "Size": 8000},
                ]
            },
        ]

        result = collect_project_metrics(mock_client, "spaceharbor-media", "projects/proj1/")

        assert result["total_bytes"] == 3068000
        assert result["file_count"] == 4
        assert result["proxy_bytes"] == 60000
        assert result["thumbnail_bytes"] == 8000

    def test_media_classification_extensions(self):
        """Test correct classification by file extension."""
        from src.function import collect_project_metrics

        mock_client = MagicMock()
        mock_paginator = MagicMock()
        mock_client.get_paginator.return_value = mock_paginator

        # Test all supported extensions (case-insensitive)
        mock_paginator.paginate.return_value = [
            {
                "Contents": [
                    {"Key": "projects/proj1/video.mp4", "Size": 100},
                    {"Key": "projects/proj1/VIDEO.MOV", "Size": 200},
                    {"Key": "projects/proj1/VIdeo.WEBM", "Size": 300},
                    {"Key": "projects/proj1/thumb.jpg", "Size": 10},
                    {"Key": "projects/proj1/thumb.JPEG", "Size": 20},
                    {"Key": "projects/proj1/thumb.png", "Size": 30},
                    {"Key": "projects/proj1/thumb.WEBP", "Size": 40},
                    {"Key": "projects/proj1/primary.exr", "Size": 5000},
                ]
            }
        ]

        result = collect_project_metrics(mock_client, "spaceharbor-media", "projects/proj1/")

        assert result["proxy_bytes"] == 600  # mp4 + mov + webm
        assert result["thumbnail_bytes"] == 100  # jpg + jpeg + png + webp
        assert result["total_bytes"] == 5700

    def test_empty_project_prefix(self):
        """Test handling when project has no objects."""
        from src.function import collect_project_metrics

        mock_client = MagicMock()
        mock_paginator = MagicMock()
        mock_client.get_paginator.return_value = mock_paginator

        # Empty response
        mock_paginator.paginate.return_value = [
            {"Contents": []}
        ]

        result = collect_project_metrics(mock_client, "spaceharbor-media", "projects/empty/")

        assert result["total_bytes"] == 0
        assert result["file_count"] == 0
        assert result["proxy_bytes"] == 0
        assert result["thumbnail_bytes"] == 0

    def test_missing_contents_key(self):
        """Test handling of pages without Contents key."""
        from src.function import collect_project_metrics

        mock_client = MagicMock()
        mock_paginator = MagicMock()
        mock_client.get_paginator.return_value = mock_paginator

        # Page without Contents
        mock_paginator.paginate.return_value = [
            {"Contents": [{"Key": "file.exr", "Size": 1000}]},
            {},  # Page with no Contents
            {"Contents": [{"Key": "file2.exr", "Size": 2000}]},
        ]

        result = collect_project_metrics(mock_client, "spaceharbor-media", "projects/proj1/")

        assert result["total_bytes"] == 3000
        assert result["file_count"] == 2

    def test_missing_size_in_object(self):
        """Test handling of objects without Size."""
        from src.function import collect_project_metrics

        mock_client = MagicMock()
        mock_paginator = MagicMock()
        mock_client.get_paginator.return_value = mock_paginator

        mock_paginator.paginate.return_value = [
            {
                "Contents": [
                    {"Key": "file1.exr", "Size": 1000},
                    {"Key": "file2.exr"},  # Missing Size
                    {"Key": "file3.exr", "Size": 500},
                ]
            }
        ]

        result = collect_project_metrics(mock_client, "spaceharbor-media", "projects/proj1/")

        assert result["total_bytes"] == 1500
        assert result["file_count"] == 3


class TestPostMetricsToControlPlane:
    """Test control-plane API posting."""

    def test_successful_post_201(self):
        """Test successful metric posting with 201 response."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            import importlib
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_metrics_to_control_plane

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 201
            mock_requests.post.return_value = mock_resp

            metrics = {
                "total_bytes": 5000000,
                "file_count": 100,
                "proxy_bytes": 2000000,
                "thumbnail_bytes": 100000,
            }

            result = post_metrics_to_control_plane(
                "http://localhost:3000",
                "proj-123",
                metrics,
            )

            assert result is True
            mock_requests.post.assert_called_once()
            call_args = mock_requests.post.call_args
            assert "proj-123" in call_args[0][0]

    def test_successful_post_200(self):
        """Test successful metric posting with 200 response."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_metrics_to_control_plane

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_requests.post.return_value = mock_resp

            metrics = {"total_bytes": 1000, "file_count": 1, "proxy_bytes": 0, "thumbnail_bytes": 0}

            result = post_metrics_to_control_plane(
                "http://localhost:3000",
                "proj-456",
                metrics,
            )

            assert result is True

    def test_api_error_response(self):
        """Test handling of API error responses."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_metrics_to_control_plane

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 500
            mock_resp.text = "Internal Server Error"
            mock_requests.post.return_value = mock_resp

            metrics = {"total_bytes": 1000, "file_count": 1, "proxy_bytes": 0, "thumbnail_bytes": 0}

            result = post_metrics_to_control_plane(
                "http://localhost:3000",
                "proj-789",
                metrics,
            )

            assert result is False

    def test_network_error_handling(self):
        """Test handling of network exceptions."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_metrics_to_control_plane

            mock_requests = sys.modules["requests"]
            mock_requests.post.side_effect = ConnectionError("Cannot reach control-plane")

            metrics = {"total_bytes": 1000, "file_count": 1, "proxy_bytes": 0, "thumbnail_bytes": 0}

            result = post_metrics_to_control_plane(
                "http://localhost:3000",
                "proj-999",
                metrics,
            )

            assert result is False


class TestListProjectPrefixes:
    """Test S3 project prefix enumeration."""

    def test_list_multiple_projects(self):
        """Test listing multiple project prefixes."""
        from src.function import list_project_prefixes

        mock_client = MagicMock()
        mock_client.list_objects_v2.return_value = {
            "CommonPrefixes": [
                {"Prefix": "projects/proj-alpha/"},
                {"Prefix": "projects/proj-beta/"},
                {"Prefix": "projects/proj-gamma/"},
            ]
        }

        result = list_project_prefixes(mock_client, "spaceharbor-media")

        assert len(result) == 3
        assert "projects/proj-alpha/" in result
        assert "projects/proj-beta/" in result
        assert "projects/proj-gamma/" in result

    def test_list_empty_bucket(self):
        """Test handling when bucket has no project prefixes."""
        from src.function import list_project_prefixes

        mock_client = MagicMock()
        mock_client.list_objects_v2.return_value = {
            "CommonPrefixes": []
        }

        result = list_project_prefixes(mock_client, "spaceharbor-media")

        assert result == []

    def test_list_s3_error_handling(self):
        """Test graceful handling of S3 errors."""
        from src.function import list_project_prefixes

        mock_client = MagicMock()
        mock_client.list_objects_v2.side_effect = Exception("S3 access denied")

        result = list_project_prefixes(mock_client, "spaceharbor-media")

        assert result == []

    def test_missing_commonprefixes_key(self):
        """Test handling when response lacks CommonPrefixes."""
        from src.function import list_project_prefixes

        mock_client = MagicMock()
        mock_client.list_objects_v2.return_value = {}

        result = list_project_prefixes(mock_client, "spaceharbor-media")

        assert result == []


class TestExtractProjectIdFromPrefix:
    """Test project ID extraction logic."""

    def test_extract_standard_prefix(self):
        """Test extraction from standard prefix format."""
        from src.function import extract_project_id_from_prefix

        result = extract_project_id_from_prefix("projects/proj-123/")
        assert result == "proj-123"

    def test_extract_with_trailing_slash(self):
        """Test extraction when prefix has trailing slash."""
        from src.function import extract_project_id_from_prefix

        result = extract_project_id_from_prefix("projects/my-project/")
        assert result == "my-project"

    def test_extract_without_trailing_slash(self):
        """Test extraction without trailing slash."""
        from src.function import extract_project_id_from_prefix

        result = extract_project_id_from_prefix("projects/alpha")
        assert result == "alpha"

    def test_extract_malformed_prefix(self):
        """Test extraction from malformed prefix."""
        from src.function import extract_project_id_from_prefix

        result = extract_project_id_from_prefix("notaproject")
        assert result == "notaproject"
