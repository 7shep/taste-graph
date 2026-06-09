# Tasks: Implement the ML Pipeline

## Phase 1: Bootstrap the backend foundation
- [x] Create the `backend/` application structure defined in `PLAN.md`.
- [x] Add `backend/main.py`, router packages, service packages, schema modules, and requirements.
- [x] Add environment loading and startup validation for Spotify, Anthropic, and Supabase configuration.
- [x] Add `supabase/migrations/001_initial.sql` for `users`, `graphs`, and `sessions`.

## Phase 2: Build the data access and ingestion layers
- [x] Implement `backend/db/supabase.py` as the only Supabase access layer.
- [x] Implement `backend/services/spotify.py` as the only Spotify API boundary.
- [x] Add token refresh, 429 backoff, recently-played pagination, and session segmentation.
- [x] Persist fetched raw sessions so the pipeline can be inspected and retrained later.

## Phase 3: Build the ML services
- [x] Implement `backend/services/embeddings.py` with Word2Vec hyperparameters from `AGENT.md`.
- [x] Implement sparse-data fallback behavior for low-session and low-artist users.
- [x] Implement `backend/services/clustering.py` with deterministic UMAP and HDBSCAN post-processing.
- [x] Preserve HDBSCAN noise points as an `Uncategorized` cluster with a fixed gray color.
- [x] Implement `backend/services/labeling.py` with cached Anthropic-backed cluster naming and deterministic fallback labels.

## Phase 4: Orchestrate graph generation
- [x] Implement `backend/services/pipeline.py` as the cache-first graph orchestration entrypoint.
- [x] Add `POST /api/graph/generate` as the only route that can trigger a full pipeline run.
- [x] Return graph payloads that match the frontend node, edge, and cluster contract.
- [x] Return structured `{ error, detail }` responses on failure.

## Phase 5: Contract alignment and verification
- [x] Update `frontend/src/lib/api.ts` and `frontend/src/types/graph.ts` only as needed to consume the backend graph payload.
- [x] Add backend unit tests for embeddings, clustering, and pipeline orchestration.
- [x] Run backend formatting and import sorting before completion.
- [x] Verify cache-hit, cache-miss, sparse-data, and label-failure paths before closing the change.
