# AGENT.md — Taste Graph

This file defines how AI agents (Claude Code or any LLM-powered assistant) should behave when working on this codebase. Read this before making any changes.

---

## Project Orientation

**What this is:** A web app that trains Word2Vec embeddings on a user's Spotify listening sequences, clusters artists via UMAP + HDBSCAN, and renders the result as a shareable interactive D3 force-directed graph.

**What makes it non-trivial:**
- The ML pipeline (`embeddings.py`, `clustering.py`) must handle sparse data gracefully — users with fewer than 50 unique artists need a fallback path
- Spotify OAuth tokens expire; all API calls must go through the token refresh layer in `services/spotify.py`
- The D3 graph runs in React — keep D3 mutations scoped to a single `useEffect` ref; never let D3 and React fight over the DOM
- Graph JSON can be large; cache aggressively in Supabase, never re-run the pipeline on every page load

---

## Coding Standards

- **Language**: TypeScript (strict mode) on the frontend, Python 3.11+ on the backend
- **Formatting**: Prettier (frontend), Black + isort (backend) — run before every commit
- **Types**: All Pydantic schemas live in `backend/models/schemas.py`; all TypeScript types in `frontend/src/types/`
- **No any**: Do not use `any` in TypeScript. Do not skip Pydantic validation in FastAPI routes.
- **Error handling**: All FastAPI routes return structured `{ error: string, detail: string }` on failure — never let exceptions bubble raw to the client
- **Environment variables**: Never hardcode secrets. All secrets come from `.env` (backend) or Vite's `import.meta.env` (frontend). See `PLAN.md` for the full list.
- **Comments**: Write comments for *why*, not *what*. The ML pipeline steps are an exception — comment each step with the algorithm name and key hyperparameters.

---

## Architecture Rules

### Backend
- All Spotify API calls go through `services/spotify.py` — never call the Spotify API directly from a router
- The ML pipeline is orchestrated by `services/pipeline.py` — individual steps (embeddings, clustering, labeling) are pure functions that can be tested in isolation
- Supabase queries live in `db/supabase.py` — routers should not contain raw SQL or Supabase client calls
- The `/api/graph/generate` endpoint is the only endpoint that triggers the full ML pipeline; it is expensive and should check for a cached graph first

### Frontend
- D3 logic lives entirely in `components/Graph.tsx` — do not import D3 anywhere else
- All API calls go through `lib/api.ts` — never call `fetch` directly from a component
- `useGraphData.ts` is the single source of truth for graph state — do not duplicate graph state in component-level useState
- Share pages (`/share/:slug`) are read-only — they must not expose any mutation endpoints or auth flows beyond the "Make yours" CTA

### ML Pipeline
- Word2Vec training happens server-side, never in the browser
- UMAP `random_state=42` — keep results deterministic for the same input
- HDBSCAN noise points (cluster = -1) should be rendered as a separate grey "Uncategorized" cluster, not discarded
- Cluster colors are assigned from a fixed 8-color accessible palette defined in `services/clustering.py` — do not generate random colors

---

## OpenSpec Workflow

All non-trivial features follow the OpenSpec three-phase workflow before any code is written. This prevents wasted implementation work and keeps the agent and developer aligned.

### Commands

#### `/opsx:propose <feature>`
Triggered when starting work on a new feature or significant change.

The agent must produce a **spec document** in `specs/` with the following structure:

```
specs/{feature-slug}.md

## Summary
One paragraph describing what this feature does and why it exists.

## Scope
- What is IN scope for this change
- What is explicitly OUT of scope

## Technical approach
Step-by-step description of implementation. Include:
- Which files will be created or modified
- Data flow (inputs → transformations → outputs)
- Any new dependencies and why they were chosen over alternatives
- Edge cases and how they'll be handled

## Schema changes
Any new Supabase tables, columns, or migrations required.

## Open questions
Things that need a decision before implementation can start.
```

The agent does NOT write any implementation code during `/opsx:propose`. The spec is the only output.

**Example:**
```
/opsx:propose time-range-toggle
```
→ Creates `specs/time-range-toggle.md` with the full spec. No code.

---

#### `/opsx:apply <feature-slug>`
Triggered after the spec has been reviewed and approved (no open questions remaining).

The agent reads `specs/{feature-slug}.md` and implements exactly what the spec describes. Rules:
- Do not deviate from the spec without flagging it first
- If you discover something the spec missed, stop and add it to the spec as a note before continuing
- All new files must match the repo structure in `PLAN.md`
- Run the formatter before finishing (`black . && isort .` / `prettier --write .`)
- Update the spec file with `## Implementation notes` at the bottom — any decisions made during implementation that weren't in the spec

**Example:**
```
/opsx:apply time-range-toggle
```
→ Implements the feature as specced. Updates `specs/time-range-toggle.md` with implementation notes.

---

#### `/opsx:archive <feature-slug>`
Triggered after the feature is merged and stable.

The agent moves `specs/{feature-slug}.md` → `specs/archive/{feature-slug}.md` and adds a front-matter block:

```
---
status: archived
merged: YYYY-MM-DD
---
```

This keeps the `specs/` root clean while preserving decision history.

**Example:**
```
/opsx:archive time-range-toggle
```
→ Moves and stamps the spec. No code changes.

---

### When to use OpenSpec

| Situation | Action |
|---|---|
| New feature (any size) | `/opsx:propose` first, always |
| Bug fix (< 20 lines) | Skip — fix directly, leave a comment |
| Refactor of a service | `/opsx:propose` — refactors have surprise blast radius |
| Changing ML hyperparameters | Skip — document in code comment, note in git commit |
| New Supabase migration | `/opsx:propose` — schema changes are irreversible |
| Updating dependencies | Skip — document in PR description |

---

## ML Pipeline — Agent Notes

The ML pipeline is the core of this project. Treat it carefully.

**Word2Vec (`services/embeddings.py`)**
- Input is a `list[list[str]]` — outer list is sessions, inner list is artist IDs in order
- Minimum viable corpus is 20 sessions. If a user has fewer, log a warning and use genre co-occurrence fallback
- Never retrain on every request — check if a cached model exists for this user + time_range combo in Supabase first
- Key hyperparameters: `vector_size=64`, `window=3`, `min_count=1`, `sg=1` (skip-gram, not CBOW)

**UMAP (`services/clustering.py`)**
- Always set `random_state=42` for reproducibility
- `n_neighbors` should scale with corpus size: `max(5, min(15, n_artists // 5))`
- Output is a numpy array of shape `(n_artists, 2)` — normalize to `[-1, 1]` before serializing to JSON

**HDBSCAN (`services/clustering.py`)**
- `min_cluster_size=3` — prevents single-artist "clusters"
- Artists with label `-1` (noise) go into an "Uncategorized" pseudo-cluster, color `#9CA3AF`
- Do not discard noise points — every artist the user listens to should appear in the graph

**Cluster labeling (`services/labeling.py`)**
- Send top 5 artists per cluster (by play count) to the Anthropic API
- System prompt: `"You are a music taste analyst. Respond only with the label, nothing else."`
- User prompt: `"Given these artists: {comma-separated names}, give this music taste cluster a short, evocative 2-4 word name. Examples: 'Late Night Rap', 'Sunday Morning Indie', 'Gym Mode'. Respond with only the name."`
- Cache the label in the graph JSON — don't re-call the API on every graph render

---

## Spotify API — Agent Notes

- Always use the token refresh wrapper in `services/spotify.py` — never call `requests.get` on Spotify endpoints directly
- `recently_played` returns max 50 items per call — paginate using `before` cursor to get up to 200 items
- `top_artists` and `top_tracks` accept `time_range`: `short_term` (4 weeks), `medium_term` (6 months), `long_term` (years)
- Rate limits: Spotify doesn't publish them, but treat 429 responses with exponential backoff (start at 1s, max 16s)
- Audio features (`/audio-features`) are available per track — batch requests in groups of 50

---

## Common Failure Modes

| Problem | Likely cause | Fix |
|---|---|---|
| Graph is empty | User has < 20 unique artists | Trigger genre fallback, show message |
| All artists in one cluster | UMAP collapsed — too few data points | Reduce `n_neighbors`, skip HDBSCAN, show raw UMAP layout |
| Cluster labels are generic | Anthropic prompt too vague | Pass genre tags alongside artist names |
| D3 and React fighting | D3 mutating outside the ref | Scope all D3 selections to `svgRef.current` |
| Share page slow | Graph JSON fetched on every render | Cache in React state, use SWR with long TTL |
| Token expired mid-pipeline | No refresh in Spotify client | All Spotify calls must go through the refresh wrapper |

---

## Out of Scope (do not implement in v1)

- Real-time listening updates via Spotify webhooks
- Social features (following users, comparing graphs)
- Non-Spotify sources (Last.fm, Apple Music)
- Mobile app or React Native version
- Playlist generation from clusters
