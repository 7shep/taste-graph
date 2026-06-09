from __future__ import annotations

from backend._compat import APIRouter, JSONResponse
from backend.models.schemas import ErrorResponse, GraphGenerateRequest, GraphPayload
from backend.services.pipeline import GraphGenerationError, GraphPipeline

router = APIRouter(prefix="/api/graph", tags=["graph"])
_pipeline: GraphPipeline | None = None


def configure_graph_pipeline(pipeline: GraphPipeline) -> None:
    global _pipeline
    _pipeline = pipeline


@router.post("/generate")
def generate_graph(request: GraphGenerateRequest) -> GraphPayload:
    if _pipeline is None:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="pipeline_unavailable",
                detail="Graph pipeline is not configured on the backend.",
            ).model_dump(),
        )

    try:
        return _pipeline.generate_graph(request)
    except GraphGenerationError as exc:
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(
                error="graph_generation_failed",
                detail=str(exc),
            ).model_dump(),
        )
