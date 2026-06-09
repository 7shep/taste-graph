from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations
from math import sqrt
from typing import Iterable

try:
    from gensim.models import Word2Vec
except ModuleNotFoundError:  # pragma: no cover - dependency is optional in tests
    Word2Vec = None  # type: ignore[assignment]


VECTOR_SIZE = 64
WINDOW_SIZE = 3
MIN_COUNT = 1
SKIP_GRAM = 1


@dataclass
class EmbeddingResult:
    vectors: dict[str, list[float]]
    play_counts: dict[str, int]
    edge_weights: dict[tuple[str, str], int]
    fallback_used: bool
    fallback_reasons: list[str]


def _normalize(values: list[float]) -> list[float]:
    magnitude = sqrt(sum(value * value for value in values)) or 1.0
    return [value / magnitude for value in values]


def _hash_bucket(token: str, size: int) -> int:
    return abs(hash(token)) % size


def _cooccurrence_vectors(
    sessions: list[list[str]], top_artists: list[dict[str, object]] | None = None
) -> dict[str, list[float]]:
    context: dict[str, Counter[str]] = defaultdict(Counter)

    for session in sessions:
        unique_session = list(dict.fromkeys(session))
        for index, artist_id in enumerate(session):
            start = max(0, index - WINDOW_SIZE)
            end = min(len(session), index + WINDOW_SIZE + 1)
            for neighbor in session[start:end]:
                if neighbor != artist_id:
                    context[artist_id][f"artist:{neighbor}"] += 1

        for artist_a, artist_b in combinations(unique_session, 2):
            context[artist_a][f"pair:{artist_b}"] += 1
            context[artist_b][f"pair:{artist_a}"] += 1

    for artist in top_artists or []:
        artist_id = str(artist.get("id") or "")
        if not artist_id:
            continue
        for genre in artist.get("genres", []) or []:
            context[artist_id][f"genre:{genre}"] += 3

    vectors: dict[str, list[float]] = {}
    for artist_id, tokens in context.items():
        bucketed = [0.0] * VECTOR_SIZE
        for token, weight in tokens.items():
            bucketed[_hash_bucket(token, VECTOR_SIZE)] += float(weight)
        vectors[artist_id] = _normalize(bucketed)

    return vectors


def _blend_vectors(
    base: dict[str, list[float]], supplement: dict[str, list[float]], ratio: float
) -> dict[str, list[float]]:
    merged: dict[str, list[float]] = {}
    artist_ids = set(base) | set(supplement)
    for artist_id in artist_ids:
        left = base.get(artist_id, [0.0] * VECTOR_SIZE)
        right = supplement.get(artist_id, [0.0] * VECTOR_SIZE)
        merged[artist_id] = _normalize(
            [
                ((1.0 - ratio) * left[index]) + (ratio * right[index])
                for index in range(VECTOR_SIZE)
            ]
        )
    return merged


def _train_word2vec_embeddings(sessions: list[list[str]]) -> dict[str, list[float]]:
    if Word2Vec is None:
        raise RuntimeError("gensim is not installed")

    model = Word2Vec(
        sentences=sessions,
        vector_size=VECTOR_SIZE,
        window=WINDOW_SIZE,
        min_count=MIN_COUNT,
        sg=SKIP_GRAM,
        workers=1,
        seed=42,
    )
    return {
        artist_id: [float(value) for value in model.wv[artist_id]]
        for artist_id in model.wv.index_to_key
    }


def _count_edge_weights(sessions: Iterable[list[str]]) -> dict[tuple[str, str], int]:
    weights: Counter[tuple[str, str]] = Counter()
    for session in sessions:
        unique_session = list(dict.fromkeys(session))
        for artist_a, artist_b in combinations(sorted(unique_session), 2):
            weights[(artist_a, artist_b)] += 1
    return dict(weights)


def train_artist_embeddings(
    sessions: list[list[str]],
    top_artists: list[dict[str, object]] | None = None,
) -> EmbeddingResult:
    sanitized_sessions = [
        [artist_id for artist_id in session if artist_id]
        for session in sessions
        if session
    ]
    sanitized_sessions = [session for session in sanitized_sessions if session]

    play_counts = Counter(
        artist_id for session in sanitized_sessions for artist_id in session
    )
    unique_artists = sorted(play_counts)
    fallback_reasons: list[str] = []

    fallback_used = False
    if len(sanitized_sessions) < 20:
        fallback_used = True
        fallback_reasons.append("fewer_than_20_sessions")
    if Word2Vec is None:
        fallback_used = True
        fallback_reasons.append("gensim_unavailable")
    if len(unique_artists) < 2:
        fallback_used = True
        fallback_reasons.append("insufficient_unique_artists")

    vectors: dict[str, list[float]]
    if fallback_used:
        vectors = _cooccurrence_vectors(sanitized_sessions, top_artists)
    else:
        try:
            vectors = _train_word2vec_embeddings(sanitized_sessions)
        except Exception:
            fallback_used = True
            fallback_reasons.append("word2vec_training_failed")
            vectors = _cooccurrence_vectors(sanitized_sessions, top_artists)

    if len(unique_artists) < 50:
        fallback_reasons.append("sparse_artist_history")
        genre_vectors = _cooccurrence_vectors([], top_artists)
        if genre_vectors:
            vectors = _blend_vectors(vectors, genre_vectors, 0.35)
        elif not vectors:
            vectors = {
                artist_id: _normalize(
                    [
                        1.0 if index == (_hash_bucket(artist_id, VECTOR_SIZE)) else 0.0
                        for index in range(VECTOR_SIZE)
                    ]
                )
                for artist_id in unique_artists
            }

    for artist_id in unique_artists:
        if artist_id not in vectors:
            bucketed = [0.0] * VECTOR_SIZE
            bucketed[_hash_bucket(artist_id, VECTOR_SIZE)] = 1.0
            vectors[artist_id] = bucketed
        vectors[artist_id] = _normalize(vectors[artist_id])

    return EmbeddingResult(
        vectors=vectors,
        play_counts=dict(play_counts),
        edge_weights=_count_edge_weights(sanitized_sessions),
        fallback_used=fallback_used or len(unique_artists) < 50,
        fallback_reasons=fallback_reasons,
    )

