"""
DEV SIMULATION ONLY — Not used in production VAST environments.

In production, VAST DataEngine runs pipeline functions as containerized images
on Kubernetes, triggered by VAST element triggers (file CRUD on VAST views).
This module provides local mock execution for development without a VAST cluster.

----

Data Engine Pipeline Architecture

Modular pipeline for processing media assets through various extraction and analysis steps.
Each stage in the pipeline is an independent processor that can be composed together.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import logging


logger = logging.getLogger(__name__)


@dataclass
class ProcessingContext:
    """Context passed through the pipeline stages."""

    asset_id: str
    job_id: str
    source_uri: str
    correlation_id: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def has_errors(self) -> bool:
        """Check if any errors occurred."""
        return bool(self.errors)

    def add_error(self, error: str) -> None:
        """Add an error message."""
        self.errors.append(error)
        logger.error(f"[{self.correlation_id}] {error}")

    def add_warning(self, warning: str) -> None:
        """Add a warning message."""
        self.warnings.append(warning)
        logger.warning(f"[{self.correlation_id}] {warning}")


class ProcessorStage(ABC):
    """Base class for pipeline processing stages."""

    @abstractmethod
    def name(self) -> str:
        """Return the stage name."""
        pass

    @abstractmethod
    async def process(self, context: ProcessingContext) -> ProcessingContext:
        """Process the context and return updated context.

        Should not raise exceptions; instead add errors to context.
        """
        pass


class Pipeline:
    """Composable pipeline of processing stages."""

    def __init__(self, stages: Optional[List[ProcessorStage]] = None):
        """Initialize pipeline with optional stages."""
        self.stages = stages or []

    def add_stage(self, stage: ProcessorStage) -> "Pipeline":
        """Add a stage to the pipeline."""
        self.stages.append(stage)
        return self  # For fluent interface

    async def execute(self, context: ProcessingContext) -> ProcessingContext:
        """Execute all stages in order.

        Stops early if any stage adds an error (unless continue_on_error is set).
        """
        logger.info(f"[{context.correlation_id}] Starting pipeline with {len(self.stages)} stages")

        for stage in self.stages:
            try:
                logger.debug(f"[{context.correlation_id}] Running stage: {stage.name()}")
                context = await stage.process(context)

                if context.has_errors():
                    logger.warning(
                        f"[{context.correlation_id}] Stage '{stage.name()}' produced errors, "
                        f"continuing with next stage"
                    )
            except Exception as e:
                error_msg = f"Stage '{stage.name()}' failed: {str(e)}"
                context.add_error(error_msg)
                logger.exception(f"[{context.correlation_id}] {error_msg}")

        logger.info(
            f"[{context.correlation_id}] Pipeline complete. "
            f"Errors: {len(context.errors)}, Warnings: {len(context.warnings)}"
        )

        return context


class DataEngine:
    """Orchestrates pipeline execution for asset processing."""

    def __init__(self):
        """Initialize data engine."""
        self.pipelines: Dict[str, Pipeline] = {}

    def register_pipeline(self, name: str, pipeline: Pipeline) -> None:
        """Register a pipeline by name."""
        self.pipelines[name] = pipeline
        logger.info(f"Registered pipeline: {name}")

    async def process_asset(
        self,
        asset_id: str,
        job_id: str,
        source_uri: str,
        correlation_id: str,
        pipeline_name: str = "default"
    ) -> ProcessingContext:
        """Process an asset through a registered pipeline."""
        if pipeline_name not in self.pipelines:
            raise ValueError(f"Unknown pipeline: {pipeline_name}")

        context = ProcessingContext(
            asset_id=asset_id,
            job_id=job_id,
            source_uri=source_uri,
            correlation_id=correlation_id,
        )

        pipeline = self.pipelines[pipeline_name]
        return await pipeline.execute(context)


# Global data engine instance
_data_engine: Optional[DataEngine] = None


def get_data_engine() -> DataEngine:
    """Get or create the global data engine instance."""
    global _data_engine
    if _data_engine is None:
        _data_engine = DataEngine()
    return _data_engine
