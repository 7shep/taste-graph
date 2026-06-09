# PLAN.md — Taste Graph

> A personal music DNA visualizer. Pull your Spotify listening history, train Word2Vec embeddings on your session sequences, cluster artists with UMAP + HDBSCAN, and render an interactive force-directed graph you can share like a Spotify Wrapped card.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + D3.js |
| Backend | FastAPI (Python 3.11+) |
| Auth + Data | Spotify OAuth 2.0 + Web API |
| Embeddings | Word2Vec via `gensim` |
| Dimensionality reduction | UMAP (`umap-learn`) |
| Clustering | HDBSCAN (`hdbscan`) |
| Cluster labeling | Anthropic API (claude-sonnet) |
| Storage | Supabase (Postgres + Storage) |
| Deploy | Vercel (frontend) + Railway (FastAPI) |

---

## Repository Structure

```
tastegraph/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Graph.tsx          # D3 force-directed graph
│   │   │   ├── NodeCard.tsx       # Hover card for artist details
│   │   │   ├── ClusterLegend.tsx  # Cluster color + label legend
│   │   │   ├── TimeRangeToggle.tsx
│   │   │   └── ShareBanner.tsx
│   │   ├── pages/
│   │   │   ├── Home.tsx           # Auth + generate flow
│   │   │   ├── Graph.tsx          # Logged-in user's live graph
│   │   │   └── Share.tsx          # Read-only shared snapshot
│   │   ├── hooks/
│   │   │   ├── useSpotifyAuth.ts
│   │   │   └── useGraphData.ts
│   │   └── lib/
│   │       ├── api.ts             # FastAPI client
│   │       └── supabase.ts
│   ├── package.json
│   └── vite.config.ts
│
├── backend/
│   ├── main.py                    # FastAPI app entrypoint
│   ├── routers/
│   │   ├── auth.py                # Spotify OAuth endpoints
│   │   ├── graph.py               # Graph generation endpoint
│   │   └── share.py               # Share snapshot endpoints
│   ├── services/
│   │   ├── spotify.py             # Spotify API client
│   │   ├── pipeline.py            # ML pipeline orchestrator
│   │   ├── embeddings.py          # Word2Vec training
│   │   ├── clustering.py          # UMAP + HDBSCAN
│   │   └── labeling.py            # Anthropic cluster labeling
│   ├── models/
│   │   └── schemas.py             # Pydantic models
│   ├── db/
│   │   └── supabase.py            # Supabase client + queries
│   └── requirements.txt
│
├── supabase/
│   └── migrations/
│       └── 001_initial.sql
│
├── PLAN.md
└── AGENT.md
```

---

## Database Schema

```sql
-- Users (keyed by Spotify user ID)
create table users (
  id           text primary key,           -- Spotify user ID
  display_name text,
  email        text,
  avatar_url   text,
  created_at   timestamptz default now()
);

-- Cached graph snapshots
create table graphs (
  id           uuid primary key default gen_random_uuid(),
  user_id      text references users(id),
  time_range   text not null,              -- short_term | medium_term | long_term
  graph_json   jsonb not null,             -- serialized nodes + edges + clusters
  share_slug   text unique,               -- short UUID for share URLs
  created_at   timestamptz default now(),
  is_public    boolean default false
);

-- Raw listening sessions (for re-training on fresh data)
create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      text references users(id),
  session_date date,
  artist_sequence text[],                 -- ordered artist IDs in the session
  created_at   timestamptz default now()
);
```

---

## ML Pipeline — Detailed

### 1. Data Collection (`services/spotify.py`)
- Pull `recently_played` (50 tracks, paginate to ~200)
- Pull `top_artists` for `short_term`, `medium_term`, `long_term`
- Pull `top_tracks` for audio features (valence, energy, danceability, tempo)
- Segment recently played into sessions: gap > 30 minutes = new session boundary

### 2. Word2Vec Training (`services/embeddings.py`)
- Input: list of sessions, each session is a list of artist IDs
- Train `gensim.models.Word2Vec` with:
  - `vector_size=64`, `window=3`, `min_count=1`, `sg=1` (skip-gram)
- Output: artist → 64-dim embedding vector
- Fallback: if < 50 unique artists, supplement with genre co-occurrence from top_artists

### 3. UMAP + HDBSCAN (`services/clustering.py`)
- UMAP: reduce 64-dim → 2-dim, `n_neighbors=10`, `min_dist=0.1`
- HDBSCAN: `min_cluster_size=3`, `min_samples=1`
- Output: each artist gets `(x, y)` coordinates + cluster ID

### 4. Cluster Labeling (`services/labeling.py`)
- For each cluster, collect top 5 artists by play count
- Send to Anthropic API: *"Given these artists: {names}, give this music taste cluster a short, evocative 2–4 word name (e.g. 'Late Night Rap', 'Sunday Morning Indie'). Respond with only the name."*
- Cache labels in graph_json

### 5. Graph Serialization
```json
{
  "nodes": [
    {
      "id": "spotify:artist:xxx",
      "name": "Kendrick Lamar",
      "image_url": "...",
      "play_count": 142,
      "cluster_id": 0,
      "cluster_label": "Late Night Rap",
      "x": 0.43,
      "y": -0.12,
      "top_tracks": ["DNA.", "HUMBLE.", "Money Trees"]
    }
  ],
  "edges": [
    { "source": "artist_a", "target": "artist_b", "weight": 17 }
  ],
  "clusters": [
    { "id": 0, "label": "Late Night Rap", "color": "#6C63FF", "size": 12 }
  ]
}
```

---

## Frontend — D3 Graph Spec

- **Nodes**: circles, radius scaled by `play_count` (min 6px, max 24px)
- **Edges**: lines, opacity + thickness scaled by `weight`
- **Colors**: one color per cluster, 8-color accessible palette
- **Interactions**:
  - Hover node → show `NodeCard` (artist image, name, top tracks, cluster label)
  - Click node → open Spotify artist page in new tab
  - Drag nodes freely
  - Scroll to zoom
  - Click cluster label → highlight that cluster, dim others
- **Time range toggle**: short / medium / long term — triggers re-fetch + re-render
- **"Regenerate" button**: re-runs the full pipeline with fresh Spotify data

---

## Share Flow

1. User clicks "Share My Graph"
2. Backend serializes current `graph_json` → stores in `graphs` table with `is_public = true`, generates `share_slug`
3. Frontend redirects to `tastegraph.app/share/{slug}`
4. Share page renders graph in read-only mode (no drag, no regenerate)
5. "Make yours" CTA at bottom → triggers Spotify OAuth

---

## Week-by-Week Build Plan

### Week 1 — Data Pipeline
- [ ] Set up repo structure, FastAPI skeleton, React + Vite scaffold
- [ ] Spotify OAuth 2.0 flow (PKCE, token refresh)
- [ ] Spotify data fetching: recently_played, top_artists, top_tracks
- [ ] Session segmentation logic
- [ ] Supabase schema + migrations
- [ ] Store raw sessions in DB

### Week 2 — ML Pipeline
- [ ] Word2Vec training on session corpus
- [ ] UMAP dimensionality reduction
- [ ] HDBSCAN clustering
- [ ] Anthropic API cluster labeling
- [ ] Graph JSON serialization
- [ ] `/api/graph/generate` endpoint end-to-end

### Week 3 — Frontend Viz
- [ ] D3 force-directed graph component
- [ ] Node hover cards
- [ ] Cluster legend + highlight interactions
- [ ] Time range toggle
- [ ] Auth flow + home page
- [ ] Connect frontend to backend

### Week 4 — Polish + Ship
- [ ] Share flow (slug generation, read-only share page)
- [ ] "Make yours" CTA on share page
- [ ] Loading states + error handling
- [ ] Mobile-responsive layout
- [ ] Deploy: Vercel + Railway
- [ ] README + demo GIF

---

## Environment Variables

```env
# Backend
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Frontend
VITE_SPOTIFY_CLIENT_ID=
VITE_API_BASE_URL=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

---

## Out of Scope (v1)

- Multi-user social features (following, comparing graphs)
- Real-time listening updates (webhooks)
- Mobile app
- Non-Spotify sources (Apple Music, Last.fm)
