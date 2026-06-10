from __future__ import annotations

import base64
import json
import os
from urllib.parse import urlencode, urlparse

from backend._compat import APIRouter, JSONResponse, RedirectResponse
from backend.models.schemas import ErrorResponse
from backend.services.spotify import SpotifyAPIError, SpotifyService

router = APIRouter(prefix="/api/auth", tags=["auth"])
_spotify_service: SpotifyService | None = None


def configure_auth_service(spotify_service: SpotifyService) -> None:
    global _spotify_service
    _spotify_service = spotify_service


def _encode_state(return_to: str) -> str:
    payload = json.dumps({"return_to": return_to}).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")


def _decode_state(state: str | None) -> str | None:
    if not state:
        return None
    padding = "=" * (-len(state) % 4)
    try:
        decoded = base64.urlsafe_b64decode(f"{state}{padding}")
        payload = json.loads(decoded.decode("utf-8"))
    except Exception:
        return None
    return payload.get("return_to")


def _frontend_origin() -> str:
    return os.getenv("FRONTEND_APP_URL", "http://127.0.0.1:4173")


def _fallback_dashboard_url() -> str:
    return _frontend_origin() + "/graph"


def _safe_return_to(candidate: str | None) -> str:
    # The callback appends OAuth tokens to this URL's fragment, so an
    # unvalidated return_to is an open redirect that leaks tokens to an
    # attacker-controlled site. Only the configured frontend origin (or a
    # plain relative path on it) is allowed.
    if not candidate:
        return _fallback_dashboard_url()
    parsed = urlparse(candidate)
    if not parsed.scheme and not parsed.netloc:
        if candidate.startswith("/") and not candidate.startswith("//"):
            return _frontend_origin() + candidate
        return _fallback_dashboard_url()
    if parsed.scheme in ("http", "https") and parsed.netloc == urlparse(
        _frontend_origin()
    ).netloc:
        return candidate
    return _fallback_dashboard_url()


def _redirect_with_hash(base_url: str, values: dict[str, str]) -> RedirectResponse:
    return RedirectResponse(url=f"{base_url}#{urlencode(values)}", status_code=302)


@router.get("/spotify/login")
def start_spotify_login(return_to: str | None = None) -> dict[str, str]:
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    redirect_uri = os.getenv("SPOTIFY_REDIRECT_URI")

    if not client_id or not redirect_uri:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="spotify_auth_unavailable",
                detail="Spotify OAuth is not configured on the backend.",
            ).model_dump(),
        )

    scope = "user-read-email user-read-recently-played user-top-read"
    dashboard_url = _safe_return_to(return_to)
    query = urlencode(
        {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": scope,
            "state": _encode_state(dashboard_url),
        }
    )
    return {"url": f"https://accounts.spotify.com/authorize?{query}"}


@router.get("/spotify/callback")
def finish_spotify_login(
    code: str | None = None,
    error: str | None = None,
    state: str | None = None,
) -> RedirectResponse:
    redirect_uri = os.getenv("SPOTIFY_REDIRECT_URI")
    return_to = _safe_return_to(_decode_state(state))

    if error:
        return _redirect_with_hash(return_to, {"auth_error": error})

    if not code or not redirect_uri or _spotify_service is None:
        return _redirect_with_hash(
            return_to,
            {"auth_error": "callback_unavailable"},
        )

    try:
        token_payload = _spotify_service.exchange_code_for_tokens(code, redirect_uri)
        profile = _spotify_service.fetch_user_profile(token_payload["access_token"])
    except (KeyError, SpotifyAPIError):
        return _redirect_with_hash(
            return_to,
            {"auth_error": "token_exchange_failed"},
        )

    return _redirect_with_hash(
        return_to,
        {
            "access_token": str(token_payload.get("access_token") or ""),
            "refresh_token": str(token_payload.get("refresh_token") or ""),
            "expires_in": str(token_payload.get("expires_in") or ""),
            "user_id": str(profile.get("id") or ""),
        },
    )
