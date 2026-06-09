from __future__ import annotations

from backend._compat import APIRouter, JSONResponse
from backend.models.schemas import ErrorResponse

router = APIRouter(prefix="/api/share", tags=["share"])


@router.get("/{slug}")
def get_shared_graph(slug: str) -> dict[str, str]:
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="not_implemented",
            detail=f"Share flow is not implemented yet for slug '{slug}'.",
        ).model_dump(),
    )
