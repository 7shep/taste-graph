from __future__ import annotations

import unittest

from backend.services.embeddings import VECTOR_SIZE, train_artist_embeddings


class EmbeddingsTests(unittest.TestCase):
    def test_sparse_sessions_trigger_fallback_and_produce_vectors(self) -> None:
        sessions = [
            ["artist-a", "artist-b", "artist-c"],
            ["artist-a", "artist-b"],
            ["artist-c", "artist-a"],
        ]
        top_artists = [
            {"id": "artist-a", "genres": ["hip hop"]},
            {"id": "artist-b", "genres": ["hip hop", "rap"]},
            {"id": "artist-c", "genres": ["jazz"]},
        ]

        result = train_artist_embeddings(sessions, top_artists)

        self.assertTrue(result.fallback_used)
        self.assertIn("fewer_than_20_sessions", result.fallback_reasons)
        self.assertIn("sparse_artist_history", result.fallback_reasons)
        self.assertEqual(set(result.vectors), {"artist-a", "artist-b", "artist-c"})
        self.assertEqual(len(result.vectors["artist-a"]), VECTOR_SIZE)
        self.assertGreater(result.edge_weights[("artist-a", "artist-b")], 0)
        self.assertEqual(result.play_counts["artist-a"], 3)


if __name__ == "__main__":
    unittest.main()
