"""Tests for scanner-function hierarchy_resolver module."""

import pytest
from unittest.mock import MagicMock
import uuid

from hierarchy_resolver import (
    resolve_hierarchy,
    HierarchyNotFoundError,
    _auto_create_sequence,
    _auto_create_shot,
)


class TestResolveHierarchy:
    """Test main hierarchy resolution logic."""

    def test_resolve_existing_project_sequence_shot(self):
        """Test resolving existing project, sequence, and shot."""
        mock_trino = MagicMock()

        # Project lookup returns
        mock_trino.query.side_effect = [
            [{"id": "proj-uuid-1"}],  # project query
            [{"id": "seq-uuid-1"}],   # sequence query
            [{"id": "shot-uuid-1"}],  # shot query
        ]

        parsed = {
            "project_code": "PROJ01",
            "sequence_code": "SQ010",
            "shot_code": "SH020",
            "version_label": "v001",
        }

        result = resolve_hierarchy(parsed, mock_trino)

        assert result["project_id"] == "proj-uuid-1"
        assert result["sequence_id"] == "seq-uuid-1"
        assert result["shot_id"] == "shot-uuid-1"
        assert result["version_label"] == "v001"

    def test_project_not_found_raises_error(self):
        """Test that missing project raises HierarchyNotFoundError."""
        mock_trino = MagicMock()
        mock_trino.query.return_value = []  # Project not found

        parsed = {
            "project_code": "NONEXISTENT",
            "sequence_code": "SQ010",
            "shot_code": "SH020",
            "version_label": "v001",
        }

        with pytest.raises(HierarchyNotFoundError) as exc_info:
            resolve_hierarchy(parsed, mock_trino)

        assert "NONEXISTENT" in str(exc_info.value)

    def test_auto_create_sequence_when_missing(self):
        """Test auto-creation of sequence when not found."""
        mock_trino = MagicMock()

        call_count = [0]
        def query_side_effect(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:  # project query
                return [{"id": "proj-uuid-1"}]
            elif call_count[0] == 2:  # sequence query (not found)
                return []
            elif call_count[0] == 3:  # shot query
                return [{"id": "shot-uuid-1"}]

        mock_trino.query.side_effect = query_side_effect

        parsed = {
            "project_code": "PROJ01",
            "sequence_code": "SQ010",
            "shot_code": "SH020",
            "version_label": "v001",
        }

        result = resolve_hierarchy(parsed, mock_trino)

        # Verify sequence was created
        execute_calls = [call for call in mock_trino.execute.call_args_list]
        assert len(execute_calls) >= 1
        assert "INSERT INTO" in str(execute_calls[0])
        assert "sequences" in str(execute_calls[0])

    def test_auto_create_shot_when_missing(self):
        """Test auto-creation of shot when not found."""
        mock_trino = MagicMock()

        call_count = [0]
        def query_side_effect(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:  # project query
                return [{"id": "proj-uuid-1"}]
            elif call_count[0] == 2:  # sequence query
                return [{"id": "seq-uuid-1"}]
            elif call_count[0] == 3:  # shot query (not found)
                return []

        mock_trino.query.side_effect = query_side_effect

        parsed = {
            "project_code": "PROJ01",
            "sequence_code": "SQ010",
            "shot_code": "SH020",
            "version_label": "v001",
        }

        result = resolve_hierarchy(parsed, mock_trino)

        # Verify shot was created
        execute_calls = [call for call in mock_trino.execute.call_args_list]
        assert len(execute_calls) >= 1
        assert "INSERT INTO" in str(execute_calls[0])
        assert "shots" in str(execute_calls[0])

    def test_auto_create_sequence_and_shot(self):
        """Test auto-creation of both sequence and shot when missing."""
        mock_trino = MagicMock()

        call_count = [0]
        def query_side_effect(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:  # project query
                return [{"id": "proj-uuid-1"}]
            elif call_count[0] == 2:  # sequence query (not found)
                return []
            elif call_count[0] == 3:  # shot query (not found)
                return []

        mock_trino.query.side_effect = query_side_effect

        parsed = {
            "project_code": "PROJ01",
            "sequence_code": "SQ010",
            "shot_code": "SH020",
            "version_label": "v001",
        }

        result = resolve_hierarchy(parsed, mock_trino)

        # Verify both were created
        execute_calls = [call for call in mock_trino.execute.call_args_list]
        assert len(execute_calls) >= 2

    def test_returns_all_ids_and_version(self):
        """Test that result contains all required fields."""
        mock_trino = MagicMock()

        mock_trino.query.side_effect = [
            [{"id": "proj-id"}],
            [{"id": "seq-id"}],
            [{"id": "shot-id"}],
        ]

        parsed = {
            "project_code": "P1",
            "sequence_code": "S1",
            "shot_code": "SH1",
            "version_label": "v2",
        }

        result = resolve_hierarchy(parsed, mock_trino)

        assert "project_id" in result
        assert "sequence_id" in result
        assert "shot_id" in result
        assert "version_label" in result


class TestAutoCreateSequence:
    """Test sequence auto-creation."""

    def test_creates_sequence_with_correct_data(self):
        """Test that sequence is created with correct parameters."""
        mock_trino = MagicMock()

        _auto_create_sequence(
            project_id="proj-1",
            parsed={
                "sequence_code": "SQ010",
            },
            trino_client=mock_trino,
            schema='vast."spaceharbor/production"',
        )

        mock_trino.execute.assert_called_once()
        call_args = mock_trino.execute.call_args

        # Verify INSERT statement
        insert_stmt = call_args[0][0]
        assert "INSERT INTO" in insert_stmt
        assert "sequences" in insert_stmt

        # Verify parameters include project_id, code, name
        params = call_args[0][1]
        assert "proj-1" in params
        assert "SQ010" in params

    def test_returns_new_sequence_id(self):
        """Test that a sequence ID is returned."""
        mock_trino = MagicMock()

        result = _auto_create_sequence(
            project_id="proj-1",
            parsed={"sequence_code": "SQ020"},
            trino_client=mock_trino,
            schema='vast."spaceharbor/production"',
        )

        assert isinstance(result, str)
        # Should be UUID format
        try:
            uuid.UUID(result)
        except ValueError:
            pytest.fail(f"Result {result} is not a valid UUID")

    def test_uses_provided_schema(self):
        """Test that the provided schema is used in the query."""
        mock_trino = MagicMock()
        custom_schema = 'mydb."customtable"'

        _auto_create_sequence(
            project_id="proj-1",
            parsed={"sequence_code": "SQ030"},
            trino_client=mock_trino,
            schema=custom_schema,
        )

        call_args = mock_trino.execute.call_args
        insert_stmt = call_args[0][0]
        assert custom_schema in insert_stmt


class TestAutoCreateShot:
    """Test shot auto-creation."""

    def test_creates_shot_with_correct_data(self):
        """Test that shot is created with correct parameters."""
        mock_trino = MagicMock()

        _auto_create_shot(
            project_id="proj-1",
            sequence_id="seq-1",
            parsed={
                "shot_code": "SH020",
            },
            trino_client=mock_trino,
            schema='vast."spaceharbor/production"',
        )

        mock_trino.execute.assert_called_once()
        call_args = mock_trino.execute.call_args

        # Verify INSERT statement
        insert_stmt = call_args[0][0]
        assert "INSERT INTO" in insert_stmt
        assert "shots" in insert_stmt

        # Verify parameters
        params = call_args[0][1]
        assert "proj-1" in params
        assert "seq-1" in params
        assert "SH020" in params

    def test_returns_new_shot_id(self):
        """Test that a shot ID is returned."""
        mock_trino = MagicMock()

        result = _auto_create_shot(
            project_id="proj-1",
            sequence_id="seq-1",
            parsed={"shot_code": "SH030"},
            trino_client=mock_trino,
            schema='vast."spaceharbor/production"',
        )

        assert isinstance(result, str)
        # Should be UUID format
        try:
            uuid.UUID(result)
        except ValueError:
            pytest.fail(f"Result {result} is not a valid UUID")

    def test_uses_shot_code_for_name(self):
        """Test that shot code is used for the name field."""
        mock_trino = MagicMock()

        _auto_create_shot(
            project_id="proj-1",
            sequence_id="seq-1",
            parsed={"shot_code": "SH040"},
            trino_client=mock_trino,
            schema='vast."spaceharbor/production"',
        )

        call_args = mock_trino.execute.call_args
        params = call_args[0][1]

        # Verify shot_code appears twice (once for code, once for name)
        assert params.count("SH040") == 2

    def test_uses_provided_schema(self):
        """Test that the provided schema is used in the query."""
        mock_trino = MagicMock()
        custom_schema = 'mydb."customshots"'

        _auto_create_shot(
            project_id="proj-1",
            sequence_id="seq-1",
            parsed={"shot_code": "SH050"},
            trino_client=mock_trino,
            schema=custom_schema,
        )

        call_args = mock_trino.execute.call_args
        insert_stmt = call_args[0][0]
        assert custom_schema in insert_stmt


class TestHierarchyNotFoundError:
    """Test custom exception."""

    def test_exception_raised_and_caught(self):
        """Test that HierarchyNotFoundError is raised and can be caught."""
        with pytest.raises(HierarchyNotFoundError):
            raise HierarchyNotFoundError("Project not found")

    def test_exception_message(self):
        """Test that exception message is preserved."""
        msg = "Custom error message"
        with pytest.raises(HierarchyNotFoundError) as exc_info:
            raise HierarchyNotFoundError(msg)

        assert msg in str(exc_info.value)
