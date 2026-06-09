from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib import error as urllib_error
from urllib import parse, request


SPOTIFY_API_BASE = "https://api.spotify.com/v1"
SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com"


class SpotifyAPIError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def _parse_timestamp(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).astimezone(timezone.utc)


def _before_cursor(value: str) -> str:
    timestamp = _parse_timestamp(value)
    return str(int(timestamp.timestamp() * 1000))


def segment_sessions(
    recently_played_items: list[dict[str, Any]], gap_minutes: int = 30
) -> list[list[str]]:
    if not recently_played_items:
        return []

    sorted_items = sorted(
        recently_played_items,
        key=lambda item: _parse_timestamp(str(item.get("played_at"))),
    )
    sessions: list[list[str]] = []
    current_session: list[str] = []
    previous_timestamp: datetime | None = None

    for item in sorted_items:
        played_at = _parse_timestamp(str(item.get("played_at")))
        track = item.get("track", {}) or {}
        artists = track.get("artists", []) or []
        artist_ids = [
            str(artist.get("id") or "") for artist in artists if artist.get("id")
        ]
        if not artist_ids:
            continue

        if (
            previous_timestamp is not None
            and (played_at - previous_timestamp).total_seconds() > gap_minutes * 60
            and current_session
        ):
            sessions.append(current_session)
            current_session = []

        current_session.extend(artist_ids)
        previous_timestamp = played_at

    if current_session:
        sessions.append(current_session)

    return sessions


@dataclass
class SpotifyService:
    client_id: str | None = None
    client_secret: str | None = None
    sleep: Any = time.sleep

    def _request_json(
        self,
        method: str,
        url: str,
        *,
        token: str | None = None,
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        max_attempts: int = 5,
    ) -> dict[str, Any]:
        body: bytes | None = None
        request_headers = {"Accept": "application/json"}
        if headers:
            request_headers.update(headers)
        if token:
            request_headers["Authorization"] = f"Bearer {token}"
        if data is not None:
            body = parse.urlencode(data).encode("utf-8")
            request_headers["Content-Type"] = "application/x-www-form-urlencoded"

        for attempt in range(max_attempts):
            req = request.Request(url, data=body, headers=request_headers, method=method)
            try:
                with request.urlopen(req) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib_error.HTTPError as exc:
                status_code = exc.code
                payload = exc.read().decode("utf-8", errors="ignore")
                if status_code == 429 and attempt < max_attempts - 1:
                    retry_after = exc.headers.get("Retry-After")
                    wait_seconds = (
                        int(retry_after)
                        if retry_after and retry_after.isdigit()
                        else min(16, 2**attempt)
                    )
                    self.sleep(wait_seconds)
                    continue
                raise SpotifyAPIError(
                    payload or "Spotify request failed", status_code=status_code
                ) from exc
            except urllib_error.URLError as exc:
                raise SpotifyAPIError(str(exc.reason)) from exc

        raise SpotifyAPIError("Spotify request failed after retries")

    def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        if not self.client_id or not self.client_secret:
            raise SpotifyAPIError("Spotify client credentials are not configured")

        credentials = f"{self.client_id}:{self.client_secret}".encode("utf-8")
        auth_header = base64.b64encode(credentials).decode("utf-8")
        return self._request_json(
            "POST",
            f"{SPOTIFY_ACCOUNTS_BASE}/api/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            headers={"Authorization": f"Basic {auth_header}"},
        )

    def exchange_code_for_tokens(self, code: str, redirect_uri: str) -> dict[str, Any]:
        if not self.client_id or not self.client_secret:
            raise SpotifyAPIError("Spotify client credentials are not configured")

        credentials = f"{self.client_id}:{self.client_secret}".encode("utf-8")
        auth_header = base64.b64encode(credentials).decode("utf-8")
        return self._request_json(
            "POST",
            f"{SPOTIFY_ACCOUNTS_BASE}/api/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Authorization": f"Basic {auth_header}"},
        )

    def fetch_user_profile(self, access_token: str) -> dict[str, Any]:
        return self._request_json("GET", f"{SPOTIFY_API_BASE}/me", token=access_token)

    def get_recently_played(
        self, access_token: str, *, limit: int = 200
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        before: str | None = None

        while len(items) < limit:
            query = {"limit": min(50, limit - len(items))}
            if before:
                query["before"] = before
            url = (
                f"{SPOTIFY_API_BASE}/me/player/recently-played?"
                + parse.urlencode(query)
            )
            payload = self._request_json("GET", url, token=access_token)
            batch = payload.get("items", []) or []
            if not batch:
                break
            items.extend(batch)
            played_at = str(batch[-1].get("played_at") or "")
            before = _before_cursor(played_at) if played_at else None
            if not before:
                break

        return items[:limit]

    def get_top_artists(
        self, access_token: str, time_range: str, *, limit: int = 50
    ) -> list[dict[str, Any]]:
        url = (
            f"{SPOTIFY_API_BASE}/me/top/artists?"
            + parse.urlencode({"time_range": time_range, "limit": limit})
        )
        payload = self._request_json("GET", url, token=access_token)
        return payload.get("items", []) or []

    def get_top_tracks(
        self, access_token: str, time_range: str, *, limit: int = 50
    ) -> list[dict[str, Any]]:
        url = (
            f"{SPOTIFY_API_BASE}/me/top/tracks?"
            + parse.urlencode({"time_range": time_range, "limit": limit})
        )
        payload = self._request_json("GET", url, token=access_token)
        return payload.get("items", []) or []
