from __future__ import annotations

import unittest

from backend.db.supabase import SupabaseRepository
from backend.models.schemas import GraphGenerateRequest, GraphPayload, GraphStats
from backend.services.labeling import ClusterLabelingService
from backend.services.pipeline import GraphPipeline
from backend.services.spotify import SpotifyAPIError


class FakeSpotifyService:
    def __init__(self) -> None:
        self.calls = 0

    def fetch_user_profile(self, access_token: str) -> dict[str, object]:
        self.calls += 1
        return {
            "display_name": "Alex",
            "email": "alex@example.com",
            "images": [{"url": "https://example.com/avatar.jpg"}],
        }

    def get_top_artists(self, access_token: str, time_range: str) -> list[dict[str, object]]:
        self.calls += 1
        return [
            {
                "id": "artist-a",
                "name": "Artist A",
                "genres": ["hip hop"],
                "images": [{"url": "https://example.com/a.jpg"}],
            },
            {
                "id": "artist-b",
                "name": "Artist B",
                "genres": ["jazz"],
                "images": [{"url": "https://example.com/b.jpg"}],
            },
        ]

    def get_top_tracks(self, access_token: str, time_range: str) -> list[dict[str, object]]:
        self.calls += 1
        return [
            {
                "name": "Track One",
                "popularity": 77,
                "album": {"name": "Album One"},
                "artists": [{"id": "artist-a", "name": "Artist A"}],
            }
        ]

    def get_recently_played(self, access_token: str) -> list[dict[str, object]]:
        self.calls += 1
        return [
            {
                "played_at": "2026-06-08T10:00:00Z",
                "track": {
                    "artists": [{"id": "artist-a", "name": "Artist A"}],
                    "album": {"images": [{"url": "https://example.com/a.jpg"}]},
                },
            },
            {
                "played_at": "2026-06-08T10:05:00Z",
                "track": {
                    "artists": [{"id": "artist-b", "name": "Artist B"}],
                    "album": {"images": [{"url": "https://example.com/b.jpg"}]},
                },
            },
            {
                "played_at": "2026-06-08T11:10:00Z",
                "track": {
                    "artists": [{"id": "artist-a", "name": "Artist A"}],
                    "album": {"images": [{"url": "https://example.com/a.jpg"}]},
                },
            },
        ]


class RefreshingSpotifyService(FakeSpotifyService):
    def __init__(self) -> None:
        super().__init__()
        self.refreshed = False

    def fetch_user_profile(self, access_token: str) -> dict[str, object]:
        if access_token == "expired-token" and not self.refreshed:
            raise SpotifyAPIError("expired", status_code=401)
        return super().fetch_user_profile(access_token)

    def refresh_access_token(self, refresh_token: str) -> dict[str, object]:
        self.refreshed = True
        return {"access_token": "fresh-token"}


class PipelineTests(unittest.TestCase):
    def test_cache_hit_skips_spotify_fetch(self) -> None:
        repository = SupabaseRepository()
        spotify = FakeSpotifyService()
        cached_payload = GraphPayload(nodes=[], edges=[], clusters=[], stats=GraphStats(artists=0, edges=0, clusters=0))
        repository.save_graph("user-1", "medium_term", cached_payload)

        pipeline = GraphPipeline(
            repository=repository,
            spotify_service=spotify,
            labeling_service=ClusterLabelingService(),
        )

        payload = pipeline.generate_graph(
            GraphGenerateRequest(
                user_id="user-1",
                time_range="medium_term",
                access_token="token",
            )
        )

        self.assertEqual(payload.stats.artists, 0)
        self.assertEqual(spotify.calls, 0)

    def test_cache_miss_persists_sessions_and_returns_graph(self) -> None:
        repository = SupabaseRepository()
        spotify = FakeSpotifyService()
        pipeline = GraphPipeline(
            repository=repository,
            spotify_service=spotify,
            labeling_service=ClusterLabelingService(),
        )

        payload = pipeline.generate_graph(
            GraphGenerateRequest(
                user_id="user-2",
                time_range="short_term",
                access_token="token",
                force_refresh=True,
            )
        )

        self.assertGreaterEqual(spotify.calls, 4)
        self.assertEqual(len(repository.list_sessions("user-2")), 2)
        self.assertEqual(payload.stats.artists, len(payload.nodes))
        self.assertTrue(payload.metadata["fallback_used"])
        self.assertTrue(any(cluster.label.startswith("Cluster") for cluster in payload.clusters))
        self.assertIsNotNone(repository.get_cached_graph("user-2", "short_term"))

    def test_refresh_token_is_used_after_unauthorized_access_token(self) -> None:
        repository = SupabaseRepository()
        spotify = RefreshingSpotifyService()
        pipeline = GraphPipeline(
            repository=repository,
            spotify_service=spotify,
            labeling_service=ClusterLabelingService(),
        )

        payload = pipeline.generate_graph(
            GraphGenerateRequest(
                user_id="user-3",
                time_range="medium_term",
                access_token="expired-token",
                refresh_token="refresh-token",
                force_refresh=True,
            )
        )

        self.assertTrue(spotify.refreshed)
        self.assertGreater(payload.stats.artists, 0)


if __name__ == "__main__":
    unittest.main()
