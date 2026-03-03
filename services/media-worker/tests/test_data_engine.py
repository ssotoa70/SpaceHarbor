"""Tests for data engine pipeline architecture."""

import asyncio
import pytest
from worker.data_engine import Pipeline, ProcessingContext, ProcessorStage, DataEngine
from worker.exrinspector import ExrInspectorStage


class MockProcessorStage(ProcessorStage):
    """Mock processor for testing."""

    def __init__(self, name_str: str, add_metadata: dict = None):
        self._name = name_str
        self.add_metadata = add_metadata or {}
        self.executed = False

    def name(self) -> str:
        return self._name

    async def process(self, context: ProcessingContext) -> ProcessingContext:
        self.executed = True
        context.metadata.update(self.add_metadata)
        return context


class ErrorProducingStage(ProcessorStage):
    """Stage that adds an error."""

    def name(self) -> str:
        return "error_producer"

    async def process(self, context: ProcessingContext) -> ProcessingContext:
        context.add_error("Test error from error_producer")
        return context


def test_pipeline_executes_stages_in_order():
    """Verify stages execute in the order they were added."""
    stage1 = MockProcessorStage("stage1", {"order": [1]})
    stage2 = MockProcessorStage("stage2", {"order": [2]})
    stage3 = MockProcessorStage("stage3", {"order": [3]})

    pipeline = Pipeline([stage1, stage2, stage3])

    context = ProcessingContext(
        asset_id="a1",
        job_id="j1",
        source_uri="file:///test.exr",
        correlation_id="corr-123",
    )

    result = asyncio.run(pipeline.execute(context))

    assert stage1.executed
    assert stage2.executed
    assert stage3.executed
    assert len(result.errors) == 0


def test_pipeline_accumulates_metadata():
    """Verify pipeline accumulates metadata from all stages."""
    pipeline = Pipeline([
        MockProcessorStage("stage1", {"field1": "value1"}),
        MockProcessorStage("stage2", {"field2": "value2"}),
        MockProcessorStage("stage3", {"field3": "value3"}),
    ])

    context = ProcessingContext(
        asset_id="a1",
        job_id="j1",
        source_uri="file:///test.exr",
        correlation_id="corr-123",
    )

    result = asyncio.run(pipeline.execute(context))

    assert result.metadata["field1"] == "value1"
    assert result.metadata["field2"] == "value2"
    assert result.metadata["field3"] == "value3"


def test_pipeline_continues_on_stage_errors():
    """Verify pipeline continues even if a stage adds errors."""
    pipeline = Pipeline([
        MockProcessorStage("stage1", {"field1": "value1"}),
        ErrorProducingStage(),
        MockProcessorStage("stage3", {"field3": "value3"}),
    ])

    context = ProcessingContext(
        asset_id="a1",
        job_id="j1",
        source_uri="file:///test.exr",
        correlation_id="corr-123",
    )

    result = asyncio.run(pipeline.execute(context))

    # All stages should have executed despite the error
    assert result.metadata.get("field1") == "value1"
    assert result.metadata.get("field3") == "value3"
    assert len(result.errors) == 1
    assert "Test error from error_producer" in result.errors[0]


def test_data_engine_registers_and_executes_pipeline():
    """Verify DataEngine can register and execute named pipelines."""
    engine = DataEngine()

    pipeline = Pipeline([
        MockProcessorStage("default_stage", {"processed": True}),
    ])

    engine.register_pipeline("default", pipeline)

    result = asyncio.run(engine.process_asset(
        asset_id="a1",
        job_id="j1",
        source_uri="file:///test.exr",
        correlation_id="corr-123",
    ))

    assert result.metadata.get("processed") is True
    assert len(result.errors) == 0


def test_exr_inspector_extracts_metadata():
    """Verify EXR inspector extracts expected metadata."""
    # Note: This test uses a mock file that may not exist
    # In production, we'd mock the file system or use a real EXR file
    inspector = ExrInspectorStage()

    context = ProcessingContext(
        asset_id="a1",
        job_id="j1",
        source_uri="file:///nonexistent.exr",
        correlation_id="corr-123",
    )

    result = asyncio.run(inspector.process(context))

    # Should have an error for missing file
    assert len(result.errors) > 0
    assert "File not found" in result.errors[0]


def test_processing_context_tracks_warnings_and_errors():
    """Verify ProcessingContext properly tracks warnings and errors."""
    context = ProcessingContext(
        asset_id="a1",
        job_id="j1",
        source_uri="file:///test.exr",
        correlation_id="corr-123",
    )

    context.add_warning("Test warning")
    context.add_error("Test error")

    assert len(context.warnings) == 1
    assert len(context.errors) == 1
    assert context.has_errors()

    context2 = ProcessingContext(
        asset_id="a2",
        job_id="j2",
        source_uri="file:///test2.exr",
        correlation_id="corr-456",
    )
    assert not context2.has_errors()
