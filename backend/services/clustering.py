from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Iterable, Sequence

try:
    import hdbscan  # type: ignore[import-not-found]
    import numpy as np  # type: ignore[import-not-found]
    import umap  # type: ignore[import-not-found]
except ModuleNotFoundError:  # pragma: no cover - optional in tests
    hdbscan = None  # type: ignore[assignment]
    np = None  # type: ignore[assignment]
    umap = None  # type: ignore[assignment]


ACCESSIBLE_CLUSTER_PALETTE = [
    "#EF8A6B",
    "#E9BD5A",
    "#7FD4A8",
    "#9AA9EE",
    "#C79DF0",
    "#6ED5E6",
    "#F28BB8",
    "#B6A0FF",
]
UNCATEGORIZED_COLOR = "#9CA3AF"
# Minimum soft-cluster membership probability required to pull an HDBSCAN
# noise point into its most likely cluster. The lower bar is intentional now
# that vectors carry genre signal, so a mild lean is meaningful.
SOFT_ASSIGN_THRESHOLD = 0.08


@dataclass
class ClusterRecord:
    id: str
    label: str
    color: str
    size: int


@dataclass
class ClusteringResult:
    positions: dict[str, tuple[float, float]]
    cluster_ids: dict[str, str]
    raw_labels: dict[str, int]
    clusters: list[ClusterRecord]
    fallback_used: bool
    n_neighbors: int


def compute_n_neighbors(n_artists: int) -> int:
    return max(5, min(15, max(1, n_artists) // 5))


def _normalize_coordinates(
    coordinates: dict[str, tuple[float, float]]
) -> dict[str, tuple[float, float]]:
    if not coordinates:
        return {}

    xs = [value[0] for value in coordinates.values()]
    ys = [value[1] for value in coordinates.values()]
    max_extent = max(max(abs(value) for value in xs), max(abs(value) for value in ys), 1.0)
    return {
        artist_id: (x / max_extent, y / max_extent)
        for artist_id, (x, y) in coordinates.items()
    }


def _fallback_project(vectors: dict[str, list[float]]) -> dict[str, tuple[float, float]]:
    positions: dict[str, tuple[float, float]] = {}
    for artist_id, vector in vectors.items():
        x = vector[0] if vector else 0.0
        y = vector[1] if len(vector) > 1 else 0.0
        if len(vector) > 3:
            x += (vector[2] * 0.35) - (vector[3] * 0.15)
        if len(vector) > 5:
            y += (vector[4] * 0.35) - (vector[5] * 0.15)
        positions[artist_id] = (x, y)
    return _normalize_coordinates(positions)


def _fallback_labels(
    artist_ids: list[str], coordinates: dict[str, tuple[float, float]]
) -> list[int]:
    count = len(artist_ids)
    if count < 5:
        return [0 for _ in artist_ids]

    ordered = sorted(artist_ids, key=lambda artist_id: coordinates[artist_id][0])
    cluster_count = max(1, min(4, count // 4))
    chunk_size = max(3, (count + cluster_count - 1) // cluster_count)

    label_map: dict[str, int] = {}
    label = 0
    for index, artist_id in enumerate(ordered):
        label_map[artist_id] = label
        if (index + 1) % chunk_size == 0 and label < cluster_count - 1:
            label += 1

    return [label_map[artist_id] for artist_id in artist_ids]


def soft_assign_noise(
    labels: list[int],
    membership_vectors: Sequence[Sequence[float]],
    threshold: float = SOFT_ASSIGN_THRESHOLD,
) -> list[int]:
    assigned: list[int] = []
    for label, memberships in zip(labels, membership_vectors, strict=False):
        if label != -1 or len(memberships) == 0:
            assigned.append(label)
            continue

        best_index = max(
            range(len(memberships)), key=lambda index: memberships[index]
        )
        if memberships[best_index] >= threshold:
            assigned.append(best_index)
        else:
            assigned.append(-1)
    return assigned


def _run_native_clustering(
    artist_ids: list[str], vectors: dict[str, list[float]]
) -> tuple[dict[str, tuple[float, float]], list[int]]:
    if np is None or umap is None or hdbscan is None:
        raise RuntimeError("Native clustering dependencies are unavailable")

    matrix = np.array([vectors[artist_id] for artist_id in artist_ids], dtype=float)
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=compute_n_neighbors(len(artist_ids)),
        min_dist=0.1,
        random_state=42,
    )
    embedding = reducer.fit_transform(matrix)
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=3, min_samples=1, prediction_data=True
    )
    labels = [int(value) for value in clusterer.fit_predict(embedding)]

    # HDBSCAN marks low-density points as noise (-1). Soft clustering lets us
    # recover the ones that clearly lean toward an existing cluster instead of
    # dumping them all into "uncategorized".
    if any(label == -1 for label in labels) and any(
        label != -1 for label in labels
    ):
        membership_vectors = np.asarray(
            hdbscan.all_points_membership_vectors(clusterer)
        )
        if membership_vectors.ndim == 1:
            # hdbscan returns a flat array when only one cluster exists.
            membership_vectors = membership_vectors.reshape(-1, 1)
        labels = soft_assign_noise(labels, membership_vectors)

    coordinates = {
        artist_id: (float(point[0]), float(point[1]))
        for artist_id, point in zip(artist_ids, embedding, strict=False)
    }
    return _normalize_coordinates(coordinates), [int(value) for value in labels]


def build_clustering_result(
    artist_ids: list[str],
    coordinates: dict[str, tuple[float, float]],
    raw_labels: Iterable[int],
    *,
    fallback_used: bool,
) -> ClusteringResult:
    normalized = _normalize_coordinates(coordinates)
    raw_labels_list = list(raw_labels)

    cluster_ids: dict[str, str] = {}
    label_counts: dict[str, int] = {}
    raw_label_map: dict[str, int] = {}

    for artist_id, raw_label in zip(artist_ids, raw_labels_list, strict=False):
        raw_label_map[artist_id] = int(raw_label)
        cluster_id = "uncategorized" if raw_label == -1 else f"cluster-{int(raw_label) + 1}"
        cluster_ids[artist_id] = cluster_id
        label_counts[cluster_id] = label_counts.get(cluster_id, 0) + 1

    ordered_cluster_ids = sorted(
        [cluster_id for cluster_id in label_counts if cluster_id != "uncategorized"]
    )
    clusters: list[ClusterRecord] = []

    for index, cluster_id in enumerate(ordered_cluster_ids):
        clusters.append(
            ClusterRecord(
                id=cluster_id,
                label=f"Cluster {index + 1}",
                color=ACCESSIBLE_CLUSTER_PALETTE[index % len(ACCESSIBLE_CLUSTER_PALETTE)],
                size=label_counts[cluster_id],
            )
        )

    if "uncategorized" in label_counts:
        clusters.append(
            ClusterRecord(
                id="uncategorized",
                label="Uncategorized",
                color=UNCATEGORIZED_COLOR,
                size=label_counts["uncategorized"],
            )
        )

    return ClusteringResult(
        positions=normalized,
        cluster_ids=cluster_ids,
        raw_labels=raw_label_map,
        clusters=clusters,
        fallback_used=fallback_used,
        n_neighbors=compute_n_neighbors(len(artist_ids)),
    )


def cluster_artist_embeddings(vectors: dict[str, list[float]]) -> ClusteringResult:
    artist_ids = list(vectors)
    if not artist_ids:
        return ClusteringResult(
            positions={},
            cluster_ids={},
            raw_labels={},
            clusters=[],
            fallback_used=True,
            n_neighbors=compute_n_neighbors(0),
        )

    if len(artist_ids) < 3:
        coordinates = _fallback_project(vectors)
        labels = [0 for _ in artist_ids]
        return build_clustering_result(
            artist_ids, coordinates, labels, fallback_used=True
        )

    try:
        coordinates, labels = _run_native_clustering(artist_ids, vectors)
        fallback_used = False
    except Exception:
        coordinates = _fallback_project(vectors)
        labels = _fallback_labels(artist_ids, coordinates)
        fallback_used = True

    return build_clustering_result(
        artist_ids,
        coordinates,
        labels,
        fallback_used=fallback_used,
    )
