# Connect the Uncategorized Artists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the ~47-artist "Uncategorized" blob by feeding featured-artist co-occurrence and genre/sub-genre signals into embeddings, clustering, and edges.

**Architecture:** Session sequences include all credited artists per track (not just `artists[0]`). A new batch `/v1/artists` fetch supplies genres for every artist. Genre + parent-genre tokens blend into every embedding vector (ratio 0.3). The HDBSCAN soft-assign threshold drops to 0.08. Orphan nodes (zero listening edges) get faint `kind="genre"` edges via Jaccard similarity, rendered dashed/dim on the frontend.

**Tech Stack:** Python (FastAPI backend, gensim/umap/hdbscan optional), pydantic-style schemas in `backend/models/schemas.py`, React + d3-force canvas frontend.

**Spec:** `docs/superpowers/specs/2026-06-09-uncategorized-clustering-design.md`

**Test runner:** `python -m pytest backend/tests/<file> -v` (if pytest is unavailable, `python -m unittest backend.tests.<module> -v` works — all tests are unittest-style).

---

### Task 1: Multi-artist session sequences

**Files:**
- Modify: `backend/services/spotify.py` (`segment_sessions`, ~lines 47–64)
- Modify: `backend/services/pipeline.py` (`_build_session_records`, ~lines 62–67)
- Test: `backend/tests/test_spotify.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_spotify.py` inside `SpotifyServiceTests`:

```python
    def test_segment_sessions_includes_all_credited_artists(self) -> None:
        recently_played = [
            {
                "played_at": "2026-06-08T10:00:00Z",
                "track": {
                    "artists": [
                        {"id": "imagine-dragons"},
                        {"id": "jid"},
                    ]
                },
            },
            {
                "played_at": "2026-06-08T10:05:00Z",
                "track": {"artists": [{"id": "artist-b"}]},
            },
        ]

        sessions = segment_sessions(recently_played)

        self.assertEqual(sessions, [["imagine-dragons", "jid", "artist-b"]])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_spotify.py -v`
Expected: `test_segment_sessions_includes_all_credited_artists` FAILS (got `[["imagine-dragons", "artist-b"]]`).

- [ ] **Step 3: Implement in `segment_sessions`**

In `backend/services/spotify.py`, replace the body of the `for item in sorted_items:` loop:

```python
    for item in sorted_items:
        played_at = _parse_timestamp(str(item.get("played_at")))
        track = item.get("track", {}) or {}
        artists = track.get("artists", []) or []
        artist_ids = [
            str(artist.get("id") or "") for artist in artists if artist.get("id")
        ]
        if not artist_ids:
            continue

        if (
            previous_timestamp is not None
            and (played_at - previous_timestamp).total_seconds() > gap_minutes * 60
            and current_session
        ):
            sessions.append(current_session)
            current_session = []

        current_session.extend(artist_ids)
        previous_timestamp = played_at
```

- [ ] **Step 4: Mirror the change in `_build_session_records`**

In `backend/services/pipeline.py`, replace the artist-extraction loop inside `for session in sessions:`:

```python
    for session in sessions:
        artist_sequence: list[str] = []
        for item in session:
            artists = ((item.get("track") or {}).get("artists") or [])
            for artist in artists:
                artist_id = str(artist.get("id") or "")
                if artist_id:
                    artist_sequence.append(artist_id)
        if artist_sequence:
```

(The `records.append(...)` block below stays unchanged.)

- [ ] **Step 5: Run the backend test suite**

Run: `python -m pytest backend/tests -v`
Expected: all PASS (existing single-artist tests are unaffected; multi-artist test passes).

- [ ] **Step 6: Commit**

```bash
git add backend/services/spotify.py backend/services/pipeline.py backend/tests/test_spotify.py
git commit -m "feat: include featured artists in session sequences"
```

---

### Task 2: Batch artist fetch (`SpotifyService.get_artists`)

**Files:**
- Modify: `backend/services/spotify.py` (add method to `SpotifyService`)
- Test: `backend/tests/test_spotify.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_spotify.py` (new test class; also add `from backend.services.spotify import SpotifyService` to imports):

```python
class GetArtistsTests(unittest.TestCase):
    def test_get_artists_chunks_ids_in_batches_of_fifty(self) -> None:
        service = SpotifyService()
        requested_urls: list[str] = []

        def fake_request_json(method, url, **kwargs):
            requested_urls.append(url)
            from urllib import parse

            query = parse.parse_qs(parse.urlsplit(url).query)
            ids = query["ids"][0].split(",")
            return {"artists": [{"id": artist_id, "genres": []} for artist_id in ids]}

        service._request_json = fake_request_json  # type: ignore[method-assign]

        ids = [f"artist-{index}" for index in range(60)] + ["artist-0", ""]
        artists = service.get_artists("token", ids)

        self.assertEqual(len(requested_urls), 2)
        self.assertEqual(len(artists), 60)
        self.assertEqual(artists[0]["id"], "artist-0")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_spotify.py -v`
Expected: FAIL with `AttributeError: 'SpotifyService' object has no attribute 'get_artists'`.

- [ ] **Step 3: Implement `get_artists`**

Add to `SpotifyService` in `backend/services/spotify.py` (after `get_top_tracks`):

```python
    def get_artists(
        self, access_token: str, artist_ids: list[str]
    ) -> list[dict[str, Any]]:
        unique_ids = list(
            dict.fromkeys(artist_id for artist_id in artist_ids if artist_id)
        )
        artists: list[dict[str, Any]] = []
        for start in range(0, len(unique_ids), 50):
            chunk = unique_ids[start : start + 50]
            url = f"{SPOTIFY_API_BASE}/artists?" + parse.urlencode(
                {"ids": ",".join(chunk)}
            )
            payload = self._request_json("GET", url, token=access_token)
            artists.extend(
                artist for artist in payload.get("artists", []) or [] if artist
            )
        return artists
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_spotify.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/spotify.py backend/tests/test_spotify.py
git commit -m "feat: add batch artist fetch for genre metadata"
```

---

### Task 3: Genre tokens for every artist in embeddings

**Files:**
- Modify: `backend/services/embeddings.py`
- Test: `backend/tests/test_embeddings.py`

This task changes `train_artist_embeddings`'s second parameter from `top_artists: list[dict]` to `genres_by_artist: dict[str, list[str]]`, adds parent-genre expansion, and blends genre vectors into every artist's vector on every path (ratio 0.3) instead of only the <50-artist fallback path.

- [ ] **Step 1: Write the failing tests**

Replace `backend/tests/test_embeddings.py` with:

```python
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
        sessions = [["artist-a", "artist-b"], ["artist-c", "artist-d"]]
        genres_by_artist = {
            "artist-a": ["rage rap"],
            "artist-c": ["rage rap"],
            "artist-b": ["jazz"],
            "artist-d": ["classical"],
        }

        result = train_artist_embeddings(sessions, genres_by_artist)

        def cosine(left: str, right: str) -> float:
            return sum(
                a * b
                for a, b in zip(result.vectors[left], result.vectors[right])
            )

        self.assertGreater(cosine("artist-a", "artist-c"), cosine("artist-a", "artist-d"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest backend/tests/test_embeddings.py -v`
Expected: FAIL with `ImportError: cannot import name 'expand_genre_tokens'`.

- [ ] **Step 3: Implement in `embeddings.py`**

In `backend/services/embeddings.py`:

3a. Add after the `SKIP_GRAM = 1` constant:

```python
GENRE_BLEND_RATIO = 0.3

# Keyword → parent-genre rules. A Spotify sub-genre containing any keyword on
# the left emits every parent token on the right, so "uk drill" and "rage rap"
# both attract toward "hip hop" even with zero shared listening sessions.
PARENT_GENRE_RULES: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
    (("hip hop", "rap",), ("hip hop",)),
    (("drill",), ("drill", "hip hop")),
    (("trap",), ("trap", "hip hop")),
    (("indie",), ("indie",)),
    (("rock",), ("rock",)),
    (("metal",), ("metal", "rock")),
    (("punk",), ("punk", "rock")),
    (("pop",), ("pop",)),
    (("r&b", "soul",), ("r&b",)),
    (
        ("house", "techno", "edm", "electronic", "dubstep", "drum and bass", "dnb"),
        ("electronic",),
    ),
    (("country",), ("country",)),
    (("jazz",), ("jazz",)),
    (("latin", "reggaeton", "corrido",), ("latin",)),
    (("folk", "americana",), ("folk",)),
    (("classical", "orchestral",), ("classical",)),
]


def expand_genre_tokens(genres: list[str]) -> list[str]:
    tokens: list[str] = []
    parents: set[str] = set()
    for genre in genres:
        normalized = genre.strip().lower()
        if not normalized:
            continue
        tokens.append(f"genre:{normalized}")
        for keywords, parent_names in PARENT_GENRE_RULES:
            if any(keyword in normalized for keyword in keywords):
                parents.update(parent_names)
    tokens.extend(sorted(f"parent:{parent}" for parent in parents))
    return tokens


def _genre_vectors(genres_by_artist: dict[str, list[str]]) -> dict[str, list[float]]:
    vectors: dict[str, list[float]] = {}
    for artist_id, genres in genres_by_artist.items():
        tokens = expand_genre_tokens(genres)
        if not tokens:
            continue
        bucketed = [0.0] * VECTOR_SIZE
        for token in tokens:
            bucketed[_hash_bucket(token, VECTOR_SIZE)] += 1.0
        vectors[artist_id] = _normalize(bucketed)
    return vectors
```

3b. Simplify `_cooccurrence_vectors` — remove the `top_artists` parameter and its genre loop (genres now arrive via the universal blend):

```python
def _cooccurrence_vectors(sessions: list[list[str]]) -> dict[str, list[float]]:
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

    vectors: dict[str, list[float]] = {}
    for artist_id, tokens in context.items():
        bucketed = [0.0] * VECTOR_SIZE
        for token, weight in tokens.items():
            bucketed[_hash_bucket(token, VECTOR_SIZE)] += float(weight)
        vectors[artist_id] = _normalize(bucketed)

    return vectors
```

3c. Rewrite `train_artist_embeddings`:

```python
def train_artist_embeddings(
    sessions: list[list[str]],
    genres_by_artist: dict[str, list[str]] | None = None,
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
        vectors = _cooccurrence_vectors(sanitized_sessions)
    else:
        try:
            vectors = _train_word2vec_embeddings(sanitized_sessions)
        except Exception:
            fallback_used = True
            fallback_reasons.append("word2vec_training_failed")
            vectors = _cooccurrence_vectors(sanitized_sessions)

    if len(unique_artists) < 50:
        fallback_reasons.append("sparse_artist_history")

    # Blend genre/sub-genre signal into every artist's vector. Artists with no
    # session vector (e.g. top artists absent from recent plays) end up with a
    # pure genre vector, which is enough for clustering to place them.
    genre_vectors = _genre_vectors(genres_by_artist or {})
    if genre_vectors:
        vectors = _blend_vectors(vectors, genre_vectors, GENRE_BLEND_RATIO)

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
```

(Note: the old `elif not vectors:` hash-seed block is now covered by the per-artist `if artist_id not in vectors` loop, which already existed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest backend/tests/test_embeddings.py -v`
Expected: all PASS. Then run `python -m pytest backend/tests -v` — `test_pipeline.py` will FAIL because the pipeline still passes `top_artists`. That's expected; fixed in Task 5. If you want green now, temporarily skip ahead to Task 5 Step 3's one-line call-site change — otherwise proceed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/embeddings.py backend/tests/test_embeddings.py
git commit -m "feat: blend genre and parent-genre tokens into all artist embeddings"
```

---

### Task 4: Relax the soft-assign threshold

**Files:**
- Modify: `backend/services/clustering.py:31`
- Test: `backend/tests/test_clustering.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_clustering.py` (import `SOFT_ASSIGN_THRESHOLD` and `soft_assign_noise` from `backend.services.clustering` if not already imported):

```python
    def test_soft_assign_threshold_absorbs_mild_leaners(self) -> None:
        self.assertEqual(SOFT_ASSIGN_THRESHOLD, 0.08)

        labels = soft_assign_noise(
            [-1, -1],
            [[0.10, 0.02], [0.05, 0.03]],
            threshold=SOFT_ASSIGN_THRESHOLD,
        )

        self.assertEqual(labels, [0, -1])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_clustering.py -v`
Expected: FAIL with `AssertionError: 0.15 != 0.08`.

- [ ] **Step 3: Change the constant**

In `backend/services/clustering.py`, change:

```python
SOFT_ASSIGN_THRESHOLD = 0.08
```

and update the comment above it to note the lower bar (vectors now carry genre signal, so a mild lean is meaningful).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest backend/tests/test_clustering.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/clustering.py backend/tests/test_clustering.py
git commit -m "feat: lower HDBSCAN soft-assign threshold to 0.08"
```

---

### Task 5: Pipeline integration — genre fetch, edge kind, orphan genre edges

**Files:**
- Modify: `backend/models/schemas.py` (`GraphEdge`)
- Modify: `backend/services/pipeline.py`
- Test: `backend/tests/test_pipeline.py`

- [ ] **Step 1: Add `kind` to `GraphEdge`**

In `backend/models/schemas.py`:

```python
class GraphEdge(BaseModel):
    source: str
    target: str
    weight: float
    kind: Literal["listening", "genre"] = "listening"
```

(`Literal` is already imported in that file.)

- [ ] **Step 2: Write the failing tests**

In `backend/tests/test_pipeline.py`:

2a. Update `FakeSpotifyService.get_recently_played` so the first track has a featured artist with no other presence (the orphan-connector case lives in `artist-feat`):

```python
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
```

2b. Add `get_artists` to `FakeSpotifyService`:

```python
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
```

and initialize `self.requested_artist_ids: list[str] = []` in `__init__`.

2c. Add tests to `PipelineTests`:

```python
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
        # Batch fetch covers artists missing from top_artists, so the node
        # shows a real name instead of a raw Spotify ID.
        feat_node = next(node for node in payload.nodes if node.id == "artist-feat")
        self.assertEqual(feat_node.name, "Fetched artist-feat")
        self.assertIn("artist-feat", spotify.requested_artist_ids)
        # The featured artist co-occurs in a session, so it has listening edges.
        self.assertTrue(
            any(
                "artist-feat" in (edge.source, edge.target)
                and edge.kind == "listening"
                for edge in payload.edges
            )
        )

    def test_orphan_artists_get_faint_genre_edges(self) -> None:
        from backend.services.pipeline import _genre_edges_for_orphans

        from backend.models.schemas import GraphEdge

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
        # orphan-1 shares "rage rap" with artist-a.
        self.assertTrue(
            any({edge.source, edge.target} == {"artist-a", "orphan-1"} for edge in edges)
        )
        # no-genres has nothing to connect with — stays orphaned by design.
        self.assertFalse(
            any("no-genres" in (edge.source, edge.target) for edge in edges)
        )
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest backend/tests/test_pipeline.py -v`
Expected: FAIL — `_genre_edges_for_orphans` doesn't exist and the pipeline still calls `train_artist_embeddings(session_sequences, top_artists)`.

- [ ] **Step 4: Implement in `pipeline.py`**

4a. Add constants and helpers near the top of `backend/services/pipeline.py` (after the imports; also add `from backend.services.embeddings import expand_genre_tokens` to the existing embeddings import):

```python
GENRE_EDGE_MIN_SIMILARITY = 0.2
GENRE_EDGE_MAX_PER_NODE = 3
GENRE_EDGE_MIN_WEIGHT = 0.05
GENRE_EDGE_MAX_WEIGHT = 0.25


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _genre_edges_for_orphans(
    artist_ids: list[str],
    genres_by_artist: dict[str, list[str]],
    listening_edges: list[GraphEdge],
) -> list[GraphEdge]:
    """Give zero-edge nodes faint edges to their closest genre relatives.

    Only artists with no listening edges qualify, and only when genre overlap
    clears GENRE_EDGE_MIN_SIMILARITY — artists with no genre data stay
    unconnected by design.
    """
    connected: set[str] = set()
    for edge in listening_edges:
        connected.add(edge.source)
        connected.add(edge.target)

    token_sets = {
        artist_id: set(expand_genre_tokens(genres_by_artist.get(artist_id, [])))
        for artist_id in artist_ids
    }

    genre_edges: list[GraphEdge] = []
    seen_pairs: set[tuple[str, str]] = set()
    for artist_id in artist_ids:
        if artist_id in connected:
            continue
        tokens = token_sets[artist_id]
        if not tokens:
            continue

        scored = sorted(
            (
                (_jaccard(tokens, token_sets[other_id]), other_id)
                for other_id in artist_ids
                if other_id != artist_id
            ),
            reverse=True,
        )
        for similarity, other_id in scored[:GENRE_EDGE_MAX_PER_NODE]:
            if similarity < GENRE_EDGE_MIN_SIMILARITY:
                break
            pair = tuple(sorted((artist_id, other_id)))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            weight = GENRE_EDGE_MIN_WEIGHT + (
                GENRE_EDGE_MAX_WEIGHT - GENRE_EDGE_MIN_WEIGHT
            ) * min(1.0, similarity)
            genre_edges.append(
                GraphEdge(
                    source=pair[0],
                    target=pair[1],
                    weight=round(weight, 4),
                    kind="genre",
                )
            )

    return genre_edges
```

4b. In `generate_graph`, track the working access token through the refresh path. In the `except SpotifyAPIError` handler, after a successful refresh, keep the refreshed token in a local:

```python
        access_token = request.access_token
```
(insert right before the first `try:` that calls `_fetch_spotify_bundle`, and change both `_fetch_spotify_bundle(...)` calls to use `access_token`; in the refresh branch set `access_token = refreshed_access_token` before re-fetching.)

4c. After `session_sequences = segment_sessions(recently_played)` and before `train_artist_embeddings`, build the genre map and fetch missing artists:

```python
        known_artist_ids = {str(artist.get("id") or "") for artist in top_artists}
        session_artist_ids = {
            artist_id for session in session_sequences for artist_id in session
        }
        track_artist_ids = {
            str(artist.get("id") or "")
            for track in top_tracks
            for artist in track.get("artists", []) or []
        }
        missing_ids = sorted(
            (session_artist_ids | track_artist_ids) - known_artist_ids - {""}
        )

        fetched_artists: list[dict[str, Any]] = []
        if missing_ids:
            try:
                fetched_artists = self.spotify_service.get_artists(
                    access_token, missing_ids
                )
            except SpotifyAPIError:
                # Genres are an enhancement; never fail graph generation on them.
                fetched_artists = []

        genres_by_artist: dict[str, list[str]] = {}
        for artist in [*top_artists, *fetched_artists]:
            artist_id = str(artist.get("id") or "")
            if artist_id:
                genres_by_artist[artist_id] = list(artist.get("genres", []) or [])
```

4d. Change the embeddings call:

```python
        embedding_result = train_artist_embeddings(session_sequences, genres_by_artist)
```

4e. Feed `fetched_artists` into metadata so names/images/genres resolve. Change `_artist_metadata`'s signature and first loop:

```python
def _artist_metadata(
    recently_played_items: list[dict[str, Any]],
    top_artists: list[dict[str, Any]],
    fetched_artists: list[dict[str, Any]],
    top_tracks: list[dict[str, Any]],
    embedding_result: EmbeddingResult,
) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    tracks_by_artist = _top_tracks_by_artist(top_tracks)

    for artist in [*top_artists, *fetched_artists]:
```

(the loop body is unchanged) and update the call site:

```python
        artist_metadata = _artist_metadata(
            recently_played, top_artists, fetched_artists, top_tracks, embedding_result
        )
```

4f. Append orphan genre edges after listening edges are normalized. Replace the `edges=` line in the `GraphPayload(...)` construction:

```python
        listening_edges = _normalize_edge_weights(embedding_result.edge_weights)
        genre_edges = _genre_edges_for_orphans(
            sorted(artist_metadata), genres_by_artist, listening_edges
        )
        all_edges = [*listening_edges, *genre_edges]
```

and in `GraphPayload(...)`:

```python
            edges=all_edges,
            ...
            stats=GraphStats(
                artists=len(nodes),
                edges=len(all_edges),
                clusters=len(clusters),
            ),
```

- [ ] **Step 5: Run the full backend suite**

Run: `python -m pytest backend/tests -v`
Expected: all PASS (including Task 3's pipeline breakage, now resolved).

- [ ] **Step 6: Commit**

```bash
git add backend/models/schemas.py backend/services/pipeline.py backend/tests/test_pipeline.py
git commit -m "feat: genre fetch, edge kinds, and orphan genre edges in pipeline"
```

---

### Task 6: Frontend — render genre edges faint and dashed

**Files:**
- Modify: `frontend/src/types/graph.ts` (`GraphEdge`)
- Modify: `frontend/src/components/Graph.tsx` (`GraphSimulationLink`, link build ~line 533, draw loop ~line 283)

- [ ] **Step 1: Add `kind` to the edge type**

In `frontend/src/types/graph.ts`:

```typescript
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  kind?: "listening" | "genre";
}
```

(`api.ts` passes `payload.edges` through untouched, so no change needed there. Missing `kind` means `"listening"` — cached graphs keep working.)

- [ ] **Step 2: Carry `kind` onto simulation links**

In `frontend/src/components/Graph.tsx`, extend `GraphSimulationLink`:

```typescript
interface GraphSimulationLink extends SimulationLinkDatum<GraphSimulationNode> {
  id: string;
  source: GraphSimulationNode;
  target: GraphSimulationNode;
  weight: number;
  crossCluster: boolean;
  genre: boolean;
}
```

and in the link-building loop (~line 540):

```typescript
      linkItems.push({
        id: `edge-${index}`,
        source,
        target,
        weight: edge.weight,
        crossCluster: source.clusterId !== target.clusterId,
        genre: edge.kind === "genre",
      });
```

- [ ] **Step 3: Style genre edges in the draw loop**

In the draw loop (~lines 295–317), dim genre edges and give them a tighter dash:

```typescript
      const baseAlpha = isDimmed
        ? 0.04
        : isFocused
          ? 0.55 + link.weight * 0.35
          : 0.1 + link.weight * 0.22;
      const alpha = link.genre ? baseAlpha * 0.6 : baseAlpha;
      const width = isDimmed
        ? 0.5
        : isFocused
          ? 1.2 + link.weight * 1.8
          : 0.5 + link.weight * 1.1;
```

and change the dash line:

```typescript
      context.setLineDash(
        link.genre
          ? [2, 4]
          : link.crossCluster && !isDimmed
            ? [3, 3]
            : [],
      );
```

- [ ] **Step 4: Soften the pull of genre edges in the simulation**

In the `forceLink` configuration (~line 556), treat genre links as long, weak tethers:

```typescript
          .distance((link: GraphSimulationLink) =>
            link.genre
              ? 240
              : link.crossCluster
                ? 210
                : 90 + (1 - link.weight) * 70,
          )
          .strength((link: GraphSimulationLink) =>
            link.genre
              ? 0.03
              : link.crossCluster
                ? 0.06
                : 0.12 + link.weight * 0.14,
          ),
```

- [ ] **Step 5: Type-check and build the frontend**

Run: `cd frontend; npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/graph.ts frontend/src/components/Graph.tsx
git commit -m "feat: render genre edges dashed and faint"
```

---

### Task 7: End-to-end verification

**Files:** none modified.

- [ ] **Step 1: Full backend suite**

Run: `python -m pytest backend/tests -v`
Expected: all PASS.

- [ ] **Step 2: Frontend build**

Run: `cd frontend; npm run build`
Expected: success.

- [ ] **Step 3: Manual smoke test**

Start backend + frontend, log in with Spotify, and regenerate the graph with **force refresh** (cached graphs predate these signals). Verify:
- "Uncategorized" count drops dramatically (47 → expect single digits).
- Featured artists (e.g., JID) sit near their collaborators with solid edges.
- Any remaining gray nodes with genres show faint dashed edges; only genre-less artists float free.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A
git commit -m "fix: post-verification adjustments for uncategorized clustering"
```
