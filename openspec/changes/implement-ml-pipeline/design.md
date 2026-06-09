# Design: Implement the ML Pipeline

## Overview
This change adds the missing backend data and ML stack for Taste Graph. The system will collect a user's Spotify listening data through a single Spotify service boundary, segment it into sessions, train artist embeddings with Word2Vec, reduce them to two dimensions with UMAP, cluster them with HDBSCAN, label clusters with Anthropic, serialize the result into graph JSON, and cache that JSON in Supabase.

The design follows the constraints in `AGENT.md`:
- Spotify API access is centralized in `services/spotify.py`
- pipeline orchestration lives in `services/pipeline.py`
- embeddings, clustering, and labeling remain isolated and testable
- `/api/graph/generate` is the only expensive graph-generation endpoint
- UMAP uses `random_state=42`
- HDBSCAN noise is retained as an `Uncategorized` cluster with a fixed gray color

## Source-of-Truth Constraints
- Keep FastAPI route failures structured as `{ error: string, detail: string }`.
- Put all Pydantic models in `backend/models/schemas.py`.
- Keep raw Supabase access inside `backend/db/supabase.py`.
- Never retrain the pipeline on every request when a cached graph exists for `user_id + time_range`.
- Treat low-data users as a supported path, not an exception path.
- Normalize UMAP coordinates to `[-1, 1]` before serialization.

## Proposed File Changes

### New files
- `backend/main.py`
- `backend/requirements.txt`
- `backend/routers/auth.py`
- `backend/routers/graph.py`
- `backend/routers/share.py`
- `backend/services/spotify.py`
- `backend/services/pipeline.py`
- `backend/services/embeddings.py`
- `backend/services/clustering.py`
- `backend/services/labeling.py`
- `backend/models/schemas.py`
- `backend/db/supabase.py`
- `backend/tests/test_embeddings.py`
- `backend/tests/test_clustering.py`
- `backend/tests/test_pipeline.py`
- `supabase/migrations/001_initial.sql`

### Updated files
- `README.md`
- `frontend/src/lib/api.ts`
- `frontend/src/types/graph.ts`

## Architecture

### API layer
- `backend/main.py` creates the FastAPI app and mounts routers.
- `backend/routers/graph.py` exposes `POST /api/graph/generate`.
- `backend/routers/auth.py` and `backend/routers/share.py` can start as minimal stubs so the backend structure matches `PLAN.md` without expanding this change's scope.
- The graph route validates input with Pydantic, calls `services/pipeline.py`, and translates failures into structured API errors.

### Data layer
- `backend/db/supabase.py` owns:
  - creating the Supabase client
  - reading cached graphs by `user_id` and `time_range`
  - writing users, session rows, and graph JSON
  - generating or storing share metadata later without changing router code
- `supabase/migrations/001_initial.sql` creates `users`, `graphs`, and `sessions` as described in `PLAN.md`.

### Spotify service layer
- `services/spotify.py` owns:
  - refresh-aware authorized requests
  - exponential backoff on `429`
  - pagination for `recently_played`
  - fetching `top_artists` and `top_tracks`
  - segmentation of recently played items into sessions using the 30-minute gap rule
- Routers and pipeline code depend on typed helper functions instead of raw HTTP calls.

### ML service layer
- `services/embeddings.py`
  - input: `list[list[str]]` artist sequences
  - output: `dict[str, list[float]]` embedding map plus supporting stats
  - implementation:
    - use `gensim.models.Word2Vec`
    - `vector_size=64`
    - `window=3`
    - `min_count=1`
    - `sg=1`
  - low-data handling:
    - if fewer than 20 sessions, log a warning and activate fallback mode
    - if fewer than 50 unique artists, supplement similarity structure with genre co-occurrence derived from `top_artists`

### Clustering layer
- `services/clustering.py`
  - accepts the embedding matrix and artist order
  - computes `n_neighbors = max(5, min(15, n_artists // 5))`
  - runs UMAP with `random_state=42`
  - runs HDBSCAN with `min_cluster_size=3`
  - emits:
    - normalized 2D coordinates
    - cluster assignments
    - cluster metadata with a fixed accessible palette
  - maps `-1` labels into an `Uncategorized` pseudo-cluster colored `#9CA3AF`
  - if the dataset is too small for stable clustering, returns raw-layout coordinates and a single fallback cluster instead of failing

### Labeling layer
- `services/labeling.py`
  - groups artists by cluster
  - picks top five artists by play count
  - calls Anthropic with the prompt contract from `AGENT.md`
  - caches returned labels in the final graph JSON so render requests do not relabel existing graphs
  - if labeling fails, falls back to deterministic labels such as `Cluster 1`, `Cluster 2`, while preserving graph usability

### Pipeline orchestration
- `services/pipeline.py` becomes the sole entrypoint for graph generation.
- Order of operations:
  1. Validate the request and resolve the target user/time range.
  2. Check Supabase for an existing cached graph.
  3. If cached and refresh is not forced, return the cached artifact.
  4. Fetch Spotify data through `services/spotify.py`.
  5. Persist raw session sequences for observability and later retraining.
  6. Train or synthesize artist vectors through `services/embeddings.py`.
  7. Cluster artists and produce normalized coordinates through `services/clustering.py`.
  8. Label clusters through `services/labeling.py`.
  9. Serialize nodes, edges, and cluster metadata into graph JSON.
  10. Persist the graph JSON in Supabase and return it.

## Data Flow

### Inputs
- `user_id`
- `time_range` in `short_term | medium_term | long_term`
- Spotify access and refresh tokens supplied through the auth flow

### Transformations
- recently played tracks -> sessionized artist sequences
- session sequences -> artist embedding vectors
- embedding vectors -> 2D coordinates + cluster IDs
- cluster IDs + play counts -> labeled cluster metadata
- all intermediate outputs -> graph JSON

### Outputs
- persisted sessions in Supabase
- persisted cached graph JSON in Supabase
- API response payload for the frontend graph page

## Graph Serialization Contract
- `nodes`
  - `id`
  - `name`
  - `image_url`
  - `play_count`
  - `cluster_id`
  - `cluster_label`
  - `x`
  - `y`
  - `top_tracks`
- `edges`
  - `source`
  - `target`
  - `weight`
- `clusters`
  - `id`
  - `label`
  - `color`
  - `size`

Edge weights should be derived from artist co-occurrence within the segmented sessions so the graph reflects both placement and relationship strength.

## Dependencies
- `fastapi` and `uvicorn` for the API runtime
- `pydantic` for validation
- `supabase` for database access
- `httpx` for Spotify HTTP requests
- `gensim` for Word2Vec
- `numpy` and `scipy` for vector math
- `umap-learn` for dimensionality reduction
- `hdbscan` for clustering
- `anthropic` for label generation
- `python-dotenv` for local env loading during development

These dependencies match the system defined in `PLAN.md` and avoid introducing alternate ML frameworks that would complicate the implementation.

## Failure Handling
- Missing env vars fail fast at startup with clear error messages.
- Spotify failures are wrapped into structured graph-generation errors.
- Empty or very sparse listening histories return fallback graphs instead of uncaught exceptions.
- Label-generation failures do not block graph generation.
- Supabase write failures fail the request and return a structured error, but cached reads should still work independently.

## Testing Strategy
- Unit test Word2Vec preparation and fallback triggering in `test_embeddings.py`.
- Unit test UMAP/HDBSCAN post-processing, normalization, and uncategorized cluster handling in `test_clustering.py`.
- Unit test pipeline orchestration with mocked Spotify, Supabase, and Anthropic clients in `test_pipeline.py`.
- Add a lightweight API smoke test for `/api/graph/generate` if the backend test harness is established during implementation.

## Implementation Notes for `/opsx:apply`
- Build the backend skeleton before wiring the ML services so imports and schemas stay stable.
- Favor pure functions for embeddings and clustering outputs so the tests can use synthetic fixtures.
- Keep auth and share routers minimal unless pipeline work requires additional schema wiring.
- Do not expand scope into frontend visualization changes beyond whatever contract alignment is required for the API payload.
