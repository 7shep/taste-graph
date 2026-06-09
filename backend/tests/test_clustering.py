from __future__ import annotations

import unittest

from backend.services.clustering import (
    SOFT_ASSIGN_THRESHOLD,
    UNCATEGORIZED_COLOR,
    build_clustering_result,
    cluster_artist_embeddings,
    soft_assign_noise,
)


class ClusteringTests(unittest.TestCase):
    def test_noise_points_are_mapped_to_uncategorized_cluster(self) -> None:
        artist_ids = ["artist-a", "artist-b", "artist-c"]
        coordinates = {
            "artist-a": (10.0, 0.0),
            "artist-b": (0.0, 5.0),
            "artist-c": (-10.0, -5.0),
        }

        result = build_clustering_result(
            artist_ids,
            coordinates,
            [0, -1, 0],
            fallback_used=False,
        )

        self.assertEqual(result.cluster_ids["artist-b"], "uncategorized")
        uncategorized = next(
            cluster for cluster in result.clusters if cluster.id == "uncategorized"
        )
        self.assertEqual(uncategorized.color, UNCATEGORIZED_COLOR)
        self.assertLessEqual(abs(result.positions["artist-a"][0]), 1.0)
        self.assertLessEqual(abs(result.positions["artist-c"][1]), 1.0)

    def test_soft_assign_noise_recovers_confident_points(self) -> None:
        labels = [0, 1, -1, -1]
        membership_vectors = [
            [0.9, 0.1],
            [0.05, 0.95],
            [0.6, 0.2],  # confident noise point -> cluster 0
            [0.05, 0.04],  # low confidence stays noise
        ]

        assigned = soft_assign_noise(labels, membership_vectors, threshold=0.15)

        self.assertEqual(assigned, [0, 1, 0, -1])

    def test_soft_assign_threshold_absorbs_mild_leaners(self) -> None:
        self.assertEqual(SOFT_ASSIGN_THRESHOLD, 0.08)

        labels = soft_assign_noise(
            [-1, -1],
            [[0.10, 0.02], [0.05, 0.03]],
            threshold=SOFT_ASSIGN_THRESHOLD,
        )

        self.assertEqual(labels, [0, -1])

    def test_soft_assign_noise_handles_empty_membership(self) -> None:
        self.assertEqual(soft_assign_noise([-1, -1], [[], []]), [-1, -1])

    def test_small_inputs_use_fallback_single_cluster(self) -> None:
        result = cluster_artist_embeddings(
            {
                "artist-a": [1.0, 0.0, 0.5],
                "artist-b": [0.8, 0.1, 0.4],
            }
        )

        self.assertTrue(result.fallback_used)
        self.assertEqual(result.cluster_ids["artist-a"], "cluster-1")
        self.assertEqual(len(result.clusters), 1)


if __name__ == "__main__":
    unittest.main()
