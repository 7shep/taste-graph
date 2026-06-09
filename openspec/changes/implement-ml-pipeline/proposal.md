# Proposal: Implement the ML Pipeline

## Summary
Implement the backend ML pipeline that turns a user's Spotify listening history into cached graph data for the frontend. This change covers the Week 2 plan in `PLAN.md`: Spotify session ingestion, Word2Vec embeddings, UMAP dimensionality reduction, HDBSCAN clustering, Anthropic-powered cluster labeling, graph JSON serialization, and the `/api/graph/generate` API surface that orchestrates the flow through a cache-first pipeline.

The repo currently contains the frontend shell and no backend runtime. This proposal adds the missing backend structure and graph-generation path required to make Taste Graph produce real data instead of a fixture-driven visualization.

## Why
- `PLAN.md` defines the ML pipeline as the core differentiator of the product, but the repository does not yet contain the backend services that perform that work.
- `AGENT.md` requires pipeline orchestration in `services/pipeline.py`, pure step functions for embeddings and clustering, deterministic UMAP settings, and a fallback path for sparse listener histories.
- The frontend graph experience is already in place, so the next blocking capability is a stable graph payload that can be generated, cached, and reused across time ranges.
- A cache-first implementation prevents expensive retraining on every page load and gives the later share flow a consistent serialized graph artifact to persist.

## Design Inputs Used
- Local `AGENT.md`
- Local `PLAN.md`
- Existing frontend graph data contract under `frontend/src/types/graph.ts`
- Current repository state showing no `backend/` or `supabase/` implementation yet

## Scope

### In Scope
- Add the backend application skeleton required for graph generation.
- Add `services/spotify.py` as the only Spotify API boundary, including token refresh, pagination, and session segmentation helpers.
- Add `services/embeddings.py`, `services/clustering.py`, and `services/labeling.py` as pure ML/data transformation modules.
- Add `services/pipeline.py` as the cache-first orchestrator for graph generation.
- Add Pydantic schemas for graph-generation requests and responses in `backend/models/schemas.py`.
- Add Supabase access helpers in `backend/db/supabase.py` for users, sessions, and cached graphs.
- Add `/api/graph/generate` as the only endpoint that can trigger the full pipeline.
- Serialize graph output in a frontend-compatible JSON shape with nodes, edges, and clusters.
- Handle sparse data with the fallback path described in `AGENT.md` instead of failing with an empty graph.
- Add tests for the pure pipeline steps and basic API orchestration behavior.

### Out of Scope
- Frontend graph redesign or D3 interaction changes.
- Share-page persistence and slug routing.
- Deployment wiring for Railway, Vercel, or Supabase hosting.
- Real-time graph updates, scheduled retraining, or background job infrastructure.
- Non-Spotify data sources.

## Success Criteria
- The repo gains a `backend/` application structure aligned with `PLAN.md`.
- `/api/graph/generate` returns structured graph JSON or a structured error payload.
- All Spotify API calls flow through `services/spotify.py`; routers do not call Spotify directly.
- The pipeline checks Supabase for a cached graph before retraining.
- Word2Vec, UMAP, HDBSCAN, and cluster labeling each live in isolated service modules that can be tested independently.
- Users with limited listening history still receive a usable graph through the documented fallback path.
- HDBSCAN noise points are preserved in the output as an `Uncategorized` cluster instead of being dropped.

## Risks
- The repository does not yet include any backend runtime, so this change introduces multiple foundational files at once.
- UMAP and HDBSCAN are sensitive to small sample sizes, making sparse-user fallback behavior a correctness requirement rather than a polish item.
- Spotify and Anthropic dependencies add failure modes around token refresh, rate limiting, and partial downstream API outages.
- Graph payload generation spans several layers, so poorly defined schemas would make frontend integration brittle.

## Assumptions
- The first implementation can run the pipeline synchronously inside the FastAPI request lifecycle; background workers are not required yet.
- Cached graph JSON is the main persisted artifact; storing the trained Word2Vec model itself is not required for v1.
- The frontend can consume the graph shape already described in `PLAN.md` with only minor type refinements if needed.

## Open Questions
- None blocking for implementation. If model persistence becomes necessary later, it should be proposed as a follow-up change rather than folded into this scope.
