# Design: Connect the Uncategorized Artists

**Date:** 2026-06-09
**Status:** Approved

## Problem

With a real Spotify account, the graph shows ~47 of 77 artists in an "Uncategorized" cluster with zero edges, floating as a disconnected gray blob.

### Root cause

1. `_artist_metadata` (`backend/services/pipeline.py`) builds graph nodes from **all** artists credited on recently-played tracks (including features) **plus** top artists.
2. But embeddings/clustering input comes only from session sequences, and `segment_sessions` (`backend/services/spotify.py`) / `_build_session_records` (`backend/services/pipeline.py`) take only `artists[0]` — the primary artist of each track.
3. Result: featured artists (e.g., JID on "Enemy") and top artists absent from recent plays get a node but no embedding vector, no edges, and no cluster → "uncategorized" at a default position.
4. Genres are only used as a weak blend signal for top artists, and only on the fallback path; all other artists have `genres: []`.

## Goals

- Featured artists connect to the artists they appear with (from the user's own listening data — no external catalog crawling).
- Every artist gets genre/sub-genre signal in its embedding vector so HDBSCAN can place it.
- Remaining noise points that lean toward a cluster get absorbed; truly unknown artists may stay uncategorized by design.
- No node floats with zero edges if it has any genre overlap with the rest of the graph.

## Non-goals

- Fetching artists' full catalogs to discover collaborations the user hasn't played.
- External knowledge graphs (MusicBrainz, Last.fm).
- Frontend layout/physics changes beyond styling the new edge kind.

## Design

### 1. Data collection (`spotify.py`, `pipeline.py`)

- **All credited artists per track** in session sequences: `segment_sessions` and `_build_session_records` emit every artist on a track, primary first, then features. A play of "Enemy" emits `[Imagine Dragons, JID]`, so co-occurrence and Word2Vec context connect them naturally.
- **New `SpotifyService.get_artists(access_token, ids)`**: batch `GET /v1/artists?ids=` in chunks of 50, returning full artist objects (name, images, genres). The pipeline calls it for every artist ID seen in sessions or top tracks that is not already in `top_artists` (~1–2 extra API calls per graph). This also fixes the existing bug where unknown artists render with their raw Spotify ID as their display name.

### 2. Embeddings (`embeddings.py`)

- `train_artist_embeddings` gains a `genres_by_artist: dict[str, list[str]]` parameter, built in the pipeline from `top_artists` plus the new batch fetch. (The existing `top_artists` parameter's genre role is subsumed by this.)
- **Genre tokens for every artist, on every path** — not just the <50-artist fallback:
  - Each Spotify genre becomes a sub-genre token (`genre:rage rap`).
  - A small keyword map (~15 rules, no external data) also emits parent-genre tokens: e.g., contains "rap" or "hip hop" → `parent:hip hop`; "drill" → `parent:drill` + `parent:hip hop`; similar rules for indie, rock, metal, pop, r&b, electronic, country, jazz, latin, etc.
- After base vectors (Word2Vec or co-occurrence) are built, blend genre vectors in at ratio **0.3** so listening behavior dominates when present. Artists with only genre data get pure genre vectors.
- Artists with neither sessions nor genres keep the current hash-bucket fallback vector and may remain uncategorized — genuinely unknowable.

### 3. Clustering (`clustering.py`)

- Lower `SOFT_ASSIGN_THRESHOLD` from `0.15` to `0.08`. Now that former noise points carry real vectors, even a slight lean toward a cluster is meaningful.
- No other clusterer changes: HDBSCAN decides whether new genre-driven clusters form ("let the data decide").

### 4. Edges (`schemas.py`, `pipeline.py`, frontend)

- `GraphEdge` gains `kind: Literal["listening", "genre"] = "listening"` so cached graphs deserialize unchanged.
- **Genre edges for orphans only**: after listening edges are built, any node with zero edges gets edges to its top-3 most genre-similar artists, using Jaccard similarity over genre token sets with minimum similarity **0.2**, weight scaled into **0.05–0.25** so they render faint.
- Frontend (`frontend/src/components/Graph.tsx`, `frontend/src/types/graph.ts`): edges with `kind === "genre"` render dashed / lower opacity. Missing `kind` is treated as `"listening"`.

### 5. Testing

- New unit tests: multi-artist session extraction; batch artist fetch chunking at 50; parent-genre keyword mapping; genre blend applied on the non-fallback path; orphan genre-edge generation (top-3, min similarity, weight range); soft-assign threshold behavior at 0.08.
- Update existing tests in `test_pipeline.py`, `test_clustering.py`, `test_embeddings.py` for new signatures.

## Expected outcome

Of the ~47 uncategorized artists: featured artists gain real session edges and cluster with their collaborators; top artists absent from recent plays get genre vectors and land near genre-mates; the small remainder with no genre data stay gray, gaining faint genre edges only if they have genre overlap. Truly unknown artists still float — by design.
