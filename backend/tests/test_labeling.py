from __future__ import annotations

import unittest

from backend.services.labeling import ClusterLabelingService


class FakeGenreClient:
    def __init__(self, genres_by_id: dict[str, list[str]]) -> None:
        self.genres_by_id = genres_by_id
        self.received_artists: list[dict[str, str]] | None = None

    def generate_genres(self, artists, system_prompt, model):
        self.received_artists = list(artists)
        return self.genres_by_id


class FailingGenreClient:
    def generate_genres(self, artists, system_prompt, model):
        raise RuntimeError("gemini down")


class InferArtistGenresTests(unittest.TestCase):
    def test_returns_genres_from_injected_client(self) -> None:
        client = FakeGenreClient(
            {
                "artist-a": ["Hip Hop", "rage rap"],
                "artist-b": ["jazz"],
            }
        )
        service = ClusterLabelingService(client=client)

        genres = service.infer_artist_genres(
            [
                {"id": "artist-a", "name": "Artist A"},
                {"id": "artist-b", "name": "Artist B"},
            ]
        )

        self.assertEqual(genres["artist-a"], ["hip hop", "rage rap"])
        self.assertEqual(genres["artist-b"], ["jazz"])
        self.assertEqual(len(client.received_artists), 2)

    def test_only_returns_requested_artist_ids(self) -> None:
        client = FakeGenreClient(
            {
                "artist-a": ["pop"],
                "artist-hallucinated": ["polka"],
            }
        )
        service = ClusterLabelingService(client=client)

        genres = service.infer_artist_genres([{"id": "artist-a", "name": "Artist A"}])

        self.assertEqual(set(genres), {"artist-a"})

    def test_failure_returns_empty_mapping(self) -> None:
        service = ClusterLabelingService(client=FailingGenreClient())

        genres = service.infer_artist_genres([{"id": "artist-a", "name": "Artist A"}])

        self.assertEqual(genres, {})

    def test_empty_input_returns_empty_mapping_without_calls(self) -> None:
        service = ClusterLabelingService(client=FailingGenreClient())

        self.assertEqual(service.infer_artist_genres([]), {})


if __name__ == "__main__":
    unittest.main()
