from __future__ import annotations

import os
import unittest
from urllib.parse import parse_qs, urlparse

from backend.routers.auth import (
    _encode_state,
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
        configure_auth_service(FakeSpotifyAuthService())  # type: ignore[arg-type]

    def test_callback_redirects_to_dashboard_with_tokens(self) -> None:
        response = finish_spotify_login(
            code="example-code",
            state=_encode_state("http://127.0.0.1:4173/graph"),
        )

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith("http://127.0.0.1:4173/graph#"))

        fragment = urlparse(response.url).fragment
        values = parse_qs(fragment)
        self.assertEqual(values["access_token"][0], "access-token")
        self.assertEqual(values["refresh_token"][0], "refresh-token")
        self.assertEqual(values["user_id"][0], "spotify-user-123")


if __name__ == "__main__":
    unittest.main()
