from __future__ import annotations

import unittest

from backend.services.embeddings import (
    VECTOR_SIZE,
    expand_genre_tokens,
    train_artist_embeddings,
)


class ExpandGenreTokensTests(unittest.TestCase):
    def test_emits_sub_genre_and_parent_tokens(self) -> None:
        tokens = expand_genre_tokens(["UK Drill", "rage rap"])

        self.assertIn("genre:uk drill", tokens)
        self.assertIn("genre:rage rap", tokens)
        self.assertIn("parent:drill", tokens)
        self.assertIn("parent:hip hop", tokens)

    def test_handles_empty_and_blank_genres(self) -> None:
        self.assertEqual(expand_genre_tokens([]), [])
        self.assertEqual(expand_genre_tokens(["  "]), [])


class EmbeddingsTests(unittest.TestCase):
    def test_sparse_sessions_trigger_fallback_and_produce_vectors(self) -> None:
        sessions = [
            ["artist-a", "artist-b", "artist-c"],
            ["artist-a", "artist-b"],
            ["artist-c", "artist-a"],
        ]
        genres_by_artist = {
            "artist-a": ["hip hop"],
            "artist-b": ["hip hop", "rap"],
            "artist-c": ["jazz"],
        }

        result = train_artist_embeddings(sessions, genres_by_artist)

        self.assertTrue(result.fallback_used)
        self.assertIn("fewer_than_20_sessions", result.fallback_reasons)
        self.assertIn("sparse_artist_history", result.fallback_reasons)
        self.assertEqual(set(result.vectors), {"artist-a", "artist-b", "artist-c"})
        self.assertEqual(len(result.vectors["artist-a"]), VECTOR_SIZE)
        self.assertGreater(result.edge_weights[("artist-a", "artist-b")], 0)
        self.assertEqual(result.play_counts["artist-a"], 3)

    def test_genre_only_artist_gets_a_vector(self) -> None:
        sessions = [["artist-a", "artist-b"]]
        genres_by_artist = {
            "artist-a": ["hip hop"],
            "artist-z": ["uk drill"],
        }

        result = train_artist_embeddings(sessions, genres_by_artist)

        self.assertIn("artist-z", result.vectors)
        magnitude = sum(value * value for value in result.vectors["artist-z"])
        self.assertAlmostEqual(magnitude, 1.0, places=5)

    def test_shared_genres_pull_vectors_together(self) -> None:
        sessions = [["artist-a", "artist-b"], ["artist-c", "artist-z"]]
        genres_by_artist = {
            "artist-a": ["rage rap"],
            "artist-c": ["rage rap"],
            "artist-b": ["jazz"],
            "artist-z": ["classical"],
        }

        result = train_artist_embeddings(sessions, genres_by_artist)

        def cosine(left: str, right: str) -> float:
            return sum(
                a * b
                for a, b in zip(result.vectors[left], result.vectors[right])
            )

        self.assertGreater(cosine("artist-a", "artist-c"), cosine("artist-a", "artist-z"))


if __name__ == "__main__":
    unittest.main()
