from __future__ import annotations

import os
import unittest
from urllib.parse import parse_qs, urlparse

from backend.routers.auth import (
    _encode_state,
    _safe_return_to,
    configure_auth_service,
    finish_spotify_login,
)


class FakeSpotifyAuthService:
    def exchange_code_for_tokens(self, code: str, redirect_uri: str) -> dict[str, object]:
        return {
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "expires_in": 3600,
        }

    def fetch_user_profile(self, access_token: str) -> dict[str, object]:
        return {"id": "spotify-user-123"}


class AuthRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["SPOTIFY_REDIRECT_URI"] = "http://localhost:8000/api/auth/spotify/callback"
        os.environ.pop("FRONTEND_APP_URL", None)
        configure_auth_service(FakeSpotifyAuthService())  # type: ignore[arg-type]

    def test_callback_redirects_to_dashboard_with_tokens(self) -> None:
        response = finish_spotify_login(
            code="example-code",
            state=_encode_state("http://127.0.0.1:4173/graph"),
        )

        self.assertEqual(response.status_code, 302)
        location = response.headers["location"]
        self.assertTrue(location.startswith("http://127.0.0.1:4173/graph#"))

        fragment = urlparse(location).fragment
        values = parse_qs(fragment)
        self.assertEqual(values["access_token"][0], "access-token")
        self.assertEqual(values["refresh_token"][0], "refresh-token")
        self.assertEqual(values["user_id"][0], "spotify-user-123")

    def test_callback_rejects_foreign_redirect_target(self) -> None:
        response = finish_spotify_login(
            code="example-code",
            state=_encode_state("https://evil.example.com/steal"),
        )

        self.assertEqual(response.status_code, 302)
        location = response.headers["location"]
        self.assertTrue(location.startswith("http://127.0.0.1:4173/graph#"))


class SafeReturnToTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ.pop("FRONTEND_APP_URL", None)

    def test_allows_frontend_origin_urls(self) -> None:
        self.assertEqual(
            _safe_return_to("http://127.0.0.1:4173/graph?tab=1"),
            "http://127.0.0.1:4173/graph?tab=1",
        )

    def test_allows_relative_paths(self) -> None:
        self.assertEqual(_safe_return_to("/graph"), "http://127.0.0.1:4173/graph")

    def test_rejects_foreign_hosts_and_schemes(self) -> None:
        fallback = "http://127.0.0.1:4173/graph"
        self.assertEqual(_safe_return_to("https://evil.example.com/graph"), fallback)
        self.assertEqual(_safe_return_to("//evil.example.com/graph"), fallback)
        self.assertEqual(_safe_return_to("javascript:alert(1)"), fallback)
        self.assertEqual(_safe_return_to(None), fallback)


if __name__ == "__main__":
    unittest.main()
