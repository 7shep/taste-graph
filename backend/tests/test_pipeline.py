from __future__ import annotations

import unittest

from backend.db.supabase import SupabaseRepository
from backend.models.schemas import (
    GraphEdge,
    GraphGenerateRequest,
    GraphPayload,
    GraphStats,
)
from backend.services.clustering import ClusterRecord, ClusteringResult
from backend.services.labeling import ClusterLabelingService
from backend.services.pipeline import (
    GraphPipeline,
    _assign_uncategorized_by_genre,
    _artist_metadata,
    _genre_edges_for_orphans,
    _top_tracks_by_artist,
)
from backend.services.spotify import SpotifyAPIError


class FakeSpotifyService:
    def __init__(self) -> None:
        self.calls = 0
        self.requested_artist_ids: list[str] = []

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
                    "artists": [
                        {"id": "artist-a", "name": "Artist A"},
                        {"id": "artist-feat", "name": "Featured Artist"},
                    ],
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

    def get_artists(
        self, access_token: str, artist_ids: list[str]
    ) -> list[dict[str, object]]:
        self.calls += 1
        self.requested_artist_ids = list(artist_ids)
        return [
            {
                "id": artist_id,
                "name": f"Fetched {artist_id}",
                "genres": ["rage rap"],
                "images": [{"url": f"https://example.com/{artist_id}.jpg"}],
            }
            for artist_id in artist_ids
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

    def test_featured_artists_join_sessions_and_get_metadata(self) -> None:
        repository = SupabaseRepository()
        spotify = FakeSpotifyService()
        pipeline = GraphPipeline(
            repository=repository,
            spotify_service=spotify,
            labeling_service=ClusterLabelingService(),
        )

        payload = pipeline.generate_graph(
            GraphGenerateRequest(
                user_id="user-4",
                time_range="medium_term",
                access_token="token",
                force_refresh=True,
            )
        )

        node_ids = {node.id for node in payload.nodes}
        self.assertIn("artist-feat", node_ids)

        feat_node = next(node for node in payload.nodes if node.id == "artist-feat")
        self.assertEqual(feat_node.name, "Fetched artist-feat")
        self.assertIn("artist-feat", spotify.requested_artist_ids)
        self.assertTrue(
            any(
                "artist-feat" in (edge.source, edge.target)
                and edge.kind == "listening"
                for edge in payload.edges
            )
        )

    def test_orphan_artists_get_faint_genre_edges(self) -> None:
        listening_edges = [
            GraphEdge(source="artist-a", target="artist-b", weight=1.0)
        ]
        genres_by_artist = {
            "artist-a": ["rage rap"],
            "artist-b": ["jazz"],
            "orphan-1": ["rage rap"],
            "orphan-2": ["bubblegum pop"],
            "no-genres": [],
        }
        artist_ids = ["artist-a", "artist-b", "orphan-1", "orphan-2", "no-genres"]

        edges = _genre_edges_for_orphans(
            artist_ids, genres_by_artist, listening_edges
        )

        self.assertTrue(edges)
        self.assertTrue(all(edge.kind == "genre" for edge in edges))
        self.assertTrue(all(0.05 <= edge.weight <= 0.25 for edge in edges))
        self.assertTrue(
            any({edge.source, edge.target} == {"artist-a", "orphan-1"} for edge in edges)
        )
        self.assertFalse(
            any("no-genres" in (edge.source, edge.target) for edge in edges)
        )

    def test_top_tracks_get_rank_score_when_popularity_is_missing(self) -> None:
        tracks_by_artist = _top_tracks_by_artist(
            [
                {
                    "name": "First Track",
                    "popularity": 0,
                    "album": {"name": "First Album"},
                    "artists": [{"id": "artist-a"}],
                },
                {
                    "name": "Second Track",
                    "album": {"name": "Second Album"},
                    "artists": [{"id": "artist-a"}],
                },
            ]
        )

        scores = [track.play_count for track in tracks_by_artist["artist-a"]]

        self.assertEqual(scores, [100, 10])

    def test_artist_metadata_uses_top_artist_rank_score(self) -> None:
        top_artists = [
            {
                "id": "artist-a",
                "name": "Artist A",
                "genres": [],
                "images": [],
            },
            {
                "id": "artist-b",
                "name": "Artist B",
                "genres": [],
                "images": [],
            },
        ]
        embedding_result = type(
            "EmbeddingResultStub",
            (),
            {"play_counts": {"artist-b": 3}},
        )()

        metadata = _artist_metadata([], top_artists, [], [], embedding_result)

        self.assertEqual(metadata["artist-a"]["play_count"], 1000)
        self.assertEqual(metadata["artist-b"]["play_count"], 83)

    def test_gemini_genres_backfill_when_spotify_returns_none(self) -> None:
        class GenrelessSpotifyService(FakeSpotifyService):
            def get_top_artists(self, access_token, time_range):
                artists = super().get_top_artists(access_token, time_range)
                for artist in artists:
                    artist["genres"] = []
                return artists

            def get_artists(self, access_token, artist_ids):
                self.requested_artist_ids = list(artist_ids)
                raise SpotifyAPIError("Forbidden", status_code=403)

        class FakeGenreClient:
            def __init__(self) -> None:
                self.requested: list[dict[str, str]] = []

            def generate_genres(self, artists, system_prompt, model):
                self.requested = list(artists)
                return {artist["id"]: ["rage rap"] for artist in artists}

        repository = SupabaseRepository()
        spotify = GenrelessSpotifyService()
        genre_client = FakeGenreClient()
        pipeline = GraphPipeline(
            repository=repository,
            spotify_service=spotify,
            labeling_service=ClusterLabelingService(client=genre_client),
        )

        payload = pipeline.generate_graph(
            GraphGenerateRequest(
                user_id="user-5",
                time_range="medium_term",
                access_token="token",
                force_refresh=True,
            )
        )

        requested_ids = {artist["id"] for artist in genre_client.requested}
        self.assertIn("artist-a", requested_ids)
        self.assertIn("artist-feat", requested_ids)
        requested_names = {
            artist["id"]: artist["name"] for artist in genre_client.requested
        }
        self.assertEqual(requested_names["artist-feat"], "Featured Artist")
        self.assertGreater(payload.stats.artists, 0)

    def test_uncategorized_artists_are_assigned_by_genre_overlap(self) -> None:
        clustering = ClusteringResult(
            positions={
                "artist-a": (0.0, 0.0),
                "artist-b": (1.0, 0.0),
                "orphan-rap": (0.5, 0.5),
                "no-genres": (-1.0, 0.0),
            },
            cluster_ids={
                "artist-a": "cluster-1",
                "artist-b": "cluster-2",
                "orphan-rap": "uncategorized",
                "no-genres": "uncategorized",
            },
            raw_labels={
                "artist-a": 0,
                "artist-b": 1,
                "orphan-rap": -1,
                "no-genres": -1,
            },
            clusters=[
                ClusterRecord(
                    id="cluster-1",
                    label="Cluster 1",
                    color="#111111",
                    size=1,
                ),
                ClusterRecord(
                    id="cluster-2",
                    label="Cluster 2",
                    color="#222222",
                    size=1,
                ),
                ClusterRecord(
                    id="uncategorized",
                    label="Uncategorized",
                    color="#999999",
                    size=2,
                ),
            ],
            fallback_used=False,
            n_neighbors=5,
        )
        genres_by_artist = {
            "artist-a": ["hip hop"],
            "artist-b": ["jazz"],
            "orphan-rap": ["rage rap"],
            "no-genres": [],
        }

        assignments = _assign_uncategorized_by_genre(clustering, genres_by_artist)

        self.assertEqual(assignments, 1)
        self.assertEqual(clustering.cluster_ids["orphan-rap"], "cluster-1")
        self.assertEqual(clustering.cluster_ids["no-genres"], "uncategorized")
        sizes = {cluster.id: cluster.size for cluster in clustering.clusters}
        self.assertEqual(sizes["cluster-1"], 2)
        self.assertEqual(sizes["cluster-2"], 1)
        self.assertEqual(sizes["uncategorized"], 1)


if __name__ == "__main__":
    unittest.main()
