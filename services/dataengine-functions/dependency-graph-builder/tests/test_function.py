"""Tests for dependency-graph-builder DataEngine function."""

import pytest
from unittest.mock import patch, MagicMock
import json
import sys


class TestBuildDependencies:
    """Test dependency graph construction from mtlx-parser output."""

    def test_single_texture_dependency(self):
        """Test building a single texture dependency."""
        from src.function import build_dependencies

        parse_result = {
            "material_name": "gold_material",
            "textures": [
                {
                    "texture_path": "/assets/textures/gold_diffuse.tx",
                    "texture_type": "diffuse",
                    "colorspace": "srgb",
                    "content_hash": "abc123def456",
                    "dependency_depth": 0,
                }
            ],
        }

        result = build_dependencies(parse_result)

        assert len(result) == 1
        dep = result[0]
        assert dep["sourceEntityType"] == "material_version"
        assert dep["targetEntityType"] == "texture"
        assert dep["targetEntityId"] == "/assets/textures/gold_diffuse.tx"
        assert dep["dependencyType"] == "references_texture"
        assert dep["dependencyStrength"] == "hard"
        assert dep["textureType"] == "diffuse"
        assert dep["colorspace"] == "srgb"
        assert dep["contentHash"] == "abc123def456"
        assert dep["discoveredBy"] == "dependency-graph-builder"

    def test_multiple_texture_dependencies(self):
        """Test building multiple texture dependencies."""
        from src.function import build_dependencies

        parse_result = {
            "material_name": "complex_material",
            "textures": [
                {
                    "texture_path": "/assets/textures/diffuse.tx",
                    "texture_type": "diffuse",
                    "colorspace": "srgb",
                },
                {
                    "texture_path": "/assets/textures/normal.tx",
                    "texture_type": "normal",
                    "colorspace": "raw",
                },
                {
                    "texture_path": "/assets/textures/roughness.tx",
                    "texture_type": "roughness",
                    "colorspace": "raw",
                },
            ],
        }

        result = build_dependencies(parse_result)

        assert len(result) == 3
        texture_paths = [dep["targetEntityId"] for dep in result]
        assert "/assets/textures/diffuse.tx" in texture_paths
        assert "/assets/textures/normal.tx" in texture_paths
        assert "/assets/textures/roughness.tx" in texture_paths

    def test_empty_texture_path_skipped(self):
        """Test that textures with empty paths are skipped."""
        from src.function import build_dependencies

        parse_result = {
            "material_name": "mat",
            "textures": [
                {
                    "texture_path": "/valid/path.tx",
                    "texture_type": "diffuse",
                },
                {
                    "texture_path": "",  # Empty
                    "texture_type": "normal",
                },
                {
                    # Missing texture_path key
                    "texture_type": "roughness",
                },
            ],
        }

        result = build_dependencies(parse_result)

        assert len(result) == 1
        assert result[0]["targetEntityId"] == "/valid/path.tx"

    def test_no_textures(self):
        """Test when parse result has no textures."""
        from src.function import build_dependencies

        parse_result = {
            "material_name": "simple_material",
            "textures": [],
        }

        result = build_dependencies(parse_result)

        assert result == []

    def test_missing_textures_key(self):
        """Test when textures key is missing."""
        from src.function import build_dependencies

        parse_result = {
            "material_name": "material_with_no_textures_key",
        }

        result = build_dependencies(parse_result)

        assert result == []

    def test_default_values_for_optional_fields(self):
        """Test default values when optional texture fields are missing."""
        from src.function import build_dependencies

        parse_result = {
            "material_name": "minimal_material",
            "textures": [
                {
                    "texture_path": "/textures/minimal.tx",
                    # No texture_type, colorspace, content_hash, dependency_depth
                }
            ],
        }

        result = build_dependencies(parse_result)

        assert len(result) == 1
        dep = result[0]
        assert dep["textureType"] == "unknown"
        assert dep["colorspace"] == "raw"
        assert dep["contentHash"] is None
        assert dep["dependencyDepth"] == 0


class TestPostDependenciesToControlPlane:
    """Test dependency posting to control-plane API."""

    def test_post_single_dependency_success(self):
        """Test posting a single dependency successfully."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_dependencies_to_control_plane

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 201
            mock_requests.post.return_value = mock_resp

            dependencies = [
                {
                    "sourceEntityType": "material_version",
                    "targetEntityType": "texture",
                    "targetEntityId": "/textures/diffuse.tx",
                    "dependencyType": "references_texture",
                    "dependencyStrength": "hard",
                    "discoveredBy": "dependency-graph-builder",
                }
            ]

            result = post_dependencies_to_control_plane(
                "http://localhost:3000",
                "mat-v1",
                dependencies,
            )

            assert result == 1
            mock_requests.post.assert_called_once()

    def test_post_multiple_dependencies(self):
        """Test posting multiple dependencies."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_dependencies_to_control_plane

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 201
            mock_requests.post.return_value = mock_resp

            dependencies = [
                {
                    "sourceEntityType": "material_version",
                    "targetEntityType": "texture",
                    "targetEntityId": f"/textures/tex{i}.tx",
                    "dependencyType": "references_texture",
                    "dependencyStrength": "hard",
                    "discoveredBy": "dependency-graph-builder",
                }
                for i in range(3)
            ]

            result = post_dependencies_to_control_plane(
                "http://localhost:3000",
                "mat-v2",
                dependencies,
            )

            assert result == 3
            assert mock_requests.post.call_count == 3

    def test_post_partial_failure(self):
        """Test posting when some dependencies fail."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_dependencies_to_control_plane

            mock_requests = sys.modules["requests"]
            # First call succeeds, second fails
            responses = [
                MagicMock(status_code=201),
                MagicMock(status_code=400, text="Bad request"),
                MagicMock(status_code=201),
            ]
            mock_requests.post.side_effect = responses

            dependencies = [
                {
                    "sourceEntityType": "material_version",
                    "targetEntityType": "texture",
                    "targetEntityId": f"/textures/tex{i}.tx",
                    "dependencyType": "references_texture",
                    "dependencyStrength": "hard",
                    "discoveredBy": "dependency-graph-builder",
                }
                for i in range(3)
            ]

            result = post_dependencies_to_control_plane(
                "http://localhost:3000",
                "mat-v3",
                dependencies,
            )

            assert result == 2  # Only 2 succeeded

    def test_post_network_error(self):
        """Test handling of network errors during posting."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_dependencies_to_control_plane

            mock_requests = sys.modules["requests"]
            mock_requests.post.side_effect = ConnectionError("Network unreachable")

            dependencies = [
                {
                    "sourceEntityType": "material_version",
                    "targetEntityType": "texture",
                    "targetEntityId": "/textures/test.tx",
                    "dependencyType": "references_texture",
                    "dependencyStrength": "hard",
                    "discoveredBy": "dependency-graph-builder",
                }
            ]

            result = post_dependencies_to_control_plane(
                "http://localhost:3000",
                "mat-v4",
                dependencies,
            )

            assert result == 0

    def test_post_empty_dependencies(self):
        """Test posting when dependency list is empty."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import post_dependencies_to_control_plane

            mock_requests = sys.modules["requests"]

            result = post_dependencies_to_control_plane(
                "http://localhost:3000",
                "mat-v6",
                [],
            )

            assert result == 0
            mock_requests.post.assert_not_called()


class TestMain:
    """Test main function integration."""

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-123",
        "MTLX_PARSE_RESULT": json.dumps({
            "material_name": "gold",
            "material_version_id": "mat-v1",
            "textures": [
                {
                    "texture_path": "/textures/gold_diffuse.tx",
                    "texture_type": "diffuse",
                    "colorspace": "srgb",
                }
            ],
        }),
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    @patch("src.function.publish_completion")
    @patch("src.function.post_dependencies_to_control_plane", return_value=1)
    def test_main_success(self, mock_post_deps, mock_publish):
        """Test main function with valid inputs."""
        from src.function import main

        result = main()

        assert result == 0
        mock_post_deps.assert_called_once()
        mock_publish.assert_called_once()
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["function_name"] == "dependency-graph-builder"
        assert call_kwargs["success"] is True
        assert call_kwargs["metadata"]["dependency_count"] == 1

    @patch.dict("os.environ", {})
    def test_main_missing_asset_id(self):
        """Test main function when VAST_ASSET_ID is missing."""
        from src.function import main

        result = main()

        assert result == 1

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-456",
    })
    def test_main_missing_mtlx_parse_result(self):
        """Test main function when MTLX_PARSE_RESULT is missing."""
        from src.function import main

        result = main()

        assert result == 1

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-789",
        "MTLX_PARSE_RESULT": "not valid json {",
    })
    def test_main_invalid_json(self):
        """Test main function with malformed JSON."""
        from src.function import main

        result = main()

        assert result == 1

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-shot-123",
        "VAST_PROJECT_ID": "proj-1",
        "VAST_SHOT_ID": "shot-10",
        "MTLX_PARSE_RESULT": json.dumps({
            "material_name": "copper",
            "material_version_id": "mat-copper-v1",
            "textures": [
                {
                    "texture_path": "/textures/copper_diffuse.tx",
                    "texture_type": "diffuse",
                }
            ],
        }),
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    def test_main_with_shot_usage(self):
        """Test main function creating shot-asset usage linkage."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]

            with patch("src.function.publish_completion"):
                with patch("src.function.post_dependencies_to_control_plane", return_value=1):
                    from src.function import main

                    mock_requests = sys.modules["requests"]
                    mock_resp = MagicMock()
                    mock_resp.status_code = 201
                    mock_requests.post.return_value = mock_resp

                    result = main()

                    assert result == 0
                    # Verify shot usage call was made
                    shot_usage_call = [
                        call for call in mock_requests.post.call_args_list
                        if "asset-usage" in call[0][0]
                    ]
                    assert len(shot_usage_call) > 0

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-noreq",
        "MTLX_PARSE_RESULT": json.dumps({
            "material_name": "test",
            "textures": [],
        }),
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    @patch("src.function.publish_completion")
    @patch("src.function.post_dependencies_to_control_plane", return_value=0)
    def test_main_no_dependencies_found(self, mock_post_deps, mock_publish):
        """Test main function when parse result has no textures."""
        from src.function import main

        result = main()

        assert result == 0
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["metadata"]["dependency_count"] == 0
        assert call_kwargs["metadata"]["created_count"] == 0

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-multi",
        "MTLX_PARSE_RESULT": json.dumps({
            "material_name": "complex",
            "material_version_id": "mat-v-complex",
            "textures": [
                {
                    "texture_path": f"/textures/tex{i}.tx",
                    "texture_type": "diffuse",
                }
                for i in range(5)
            ],
        }),
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    @patch("src.function.publish_completion")
    @patch("src.function.post_dependencies_to_control_plane", return_value=5)
    def test_main_multiple_dependencies(self, mock_post_deps, mock_publish):
        """Test main function with multiple texture dependencies."""
        from src.function import main

        result = main()

        assert result == 0
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["metadata"]["dependency_count"] == 5
        assert call_kwargs["metadata"]["created_count"] == 5

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-shot-fail",
        "VAST_SHOT_ID": "shot-99",
        "MTLX_PARSE_RESULT": json.dumps({
            "material_name": "test",
            "textures": [],
        }),
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    def test_main_shot_usage_failure_ignored(self):
        """Test that shot-asset usage failure doesn't affect main success."""
        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]

            with patch("src.function.publish_completion") as mock_publish:
                with patch("src.function.post_dependencies_to_control_plane", return_value=0):
                    from src.function import main

                    mock_requests = sys.modules["requests"]
                    mock_requests.post.side_effect = Exception("Shot API unavailable")

                    result = main()

                    # Should still succeed (warning logged)
                    assert result == 0
                    mock_publish.assert_called_once()
