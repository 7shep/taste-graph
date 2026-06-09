from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from backend._compat import CORSMiddleware, FastAPI
from backend.db.supabase import SupabaseRepository
from backend.routers.auth import configure_auth_service, router as auth_router
from backend.routers.graph import configure_graph_pipeline, router as graph_router
from backend.routers.share import router as share_router
from backend.services.labeling import ClusterLabelingService
from backend.services.pipeline import GraphPipeline
from backend.services.spotify import SpotifyService

REQUIRED_ENV_VARS = [
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
    "SPOTIFY_REDIRECT_URI",
    "GEMINI_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
]

DEFAULT_CORS_ORIGINS = [
    "http://127.0.0.1:4173",
    "http://localhost:4173",
]


def load_env_files() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    env_paths = [repo_root / ".env", repo_root / ".env.local"]

    for env_path in env_paths:
        if not env_path.exists():
            continue

        for raw_line in env_path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def validate_required_env_vars() -> None:
    missing = [name for name in REQUIRED_ENV_VARS if not os.getenv(name)]
    if missing:
        raise RuntimeError(
            "Missing required environment variables: " + ", ".join(sorted(missing))
        )


def _origin_from_url(value: str) -> str | None:
    parsed = urlparse(value.strip())
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def get_cors_origins() -> list[str]:
    origins = list(DEFAULT_CORS_ORIGINS)
    frontend_app_url = os.getenv("FRONTEND_APP_URL")
    if frontend_app_url:
        origin = _origin_from_url(frontend_app_url)
        if origin:
            origins.append(origin)
    return sorted(set(origins))


def create_app(*, validate_env: bool = False) -> FastAPI:
    load_env_files()

    if validate_env:
        validate_required_env_vars()

    repository = SupabaseRepository()
    spotify_service = SpotifyService(
        client_id=os.getenv("SPOTIFY_CLIENT_ID"),
        client_secret=os.getenv("SPOTIFY_CLIENT_SECRET"),
    )
    configure_auth_service(spotify_service)
    labeling_service = ClusterLabelingService(api_key=os.getenv("GEMINI_API_KEY"))
    configure_graph_pipeline(
        GraphPipeline(
            repository=repository,
            spotify_service=spotify_service,
            labeling_service=labeling_service,
        )
    )

    app = FastAPI(title="Taste Graph API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)
    app.include_router(graph_router)
    app.include_router(share_router)
    return app


app = create_app(validate_env=False)
