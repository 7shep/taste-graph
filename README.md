# taste-graph

Taste Graph visualizes a listener's Spotify history as clustered artist neighborhoods.

## Backend

The backend now includes a FastAPI-oriented graph-generation pipeline under `backend/`. It is designed to:

- fetch Spotify profile, recent listening, top artists, and top tracks through `services/spotify.py`
- train or synthesize artist embeddings in `services/embeddings.py`
- reduce and cluster artists in `services/clustering.py`
- label clusters in `services/labeling.py`
- cache serialized graph JSON through `db/supabase.py`

Install the Python dependencies from `backend/requirements.txt`, configure the env vars listed in `PLAN.md`, and serve `backend.main:app` with your ASGI runner of choice.
