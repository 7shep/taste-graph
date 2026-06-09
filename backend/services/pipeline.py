from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from backend.db.supabase import SupabaseRepository
from backend.models.schemas import (
    GraphCluster,
    GraphEdge,
    GraphGenerateRequest,
    GraphNode,
    GraphPayload,
    GraphStats,
    GraphTrack,
    SessionRecord,
    UserRecord,
)
from backend.services.clustering import (
    ClusterRecord,
    ClusteringResult,
    UNCATEGORIZED_COLOR,
    cluster_artist_embeddings,
)
from backend.services.embeddings import (
    EmbeddingResult,
    expand_genre_tokens,
    train_artist_embeddings,
)
from backend.services.labeling import ClusterLabelingService
from backend.services.spotify import SpotifyAPIError, SpotifyService, segment_sessions


GENRE_EDGE_MIN_SIMILARITY = 0.2
GENRE_ASSIGN_MIN_SIMILARITY = 0.2
GENRE_EDGE_MAX_PER_NODE = 3
GENRE_EDGE_MIN_WEIGHT = 0.05
GENRE_EDGE_MAX_WEIGHT = 0.25
ARTIST_RANK_SCORE_MAX = 1000
ARTIST_RANK_SCORE_MIN = 80
TRACK_RANK_SCORE_MAX = 100
TRACK_RANK_SCORE_MIN = 10


class GraphGenerationError(RuntimeError):
    pass


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _genre_edges_for_orphans(
    artist_ids: list[str],
    genres_by_artist: dict[str, list[str]],
    listening_edges: list[GraphEdge],
) -> list[GraphEdge]:
    """Give zero-edge nodes faint edges to their closest genre relatives."""
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


def _assign_uncategorized_by_genre(
    clustering_result: ClusteringResult,
    genres_by_artist: dict[str, list[str]],
) -> int:
    """Move HDBSCAN noise into an existing cluster when genres clearly match."""
    token_sets = {
        artist_id: set(expand_genre_tokens(genres_by_artist.get(artist_id, [])))
        for artist_id in clustering_result.cluster_ids
    }

    cluster_members: dict[str, list[str]] = defaultdict(list)
    for artist_id, cluster_id in clustering_result.cluster_ids.items():
        if cluster_id != "uncategorized":
            cluster_members[cluster_id].append(artist_id)

    if not cluster_members:
        return 0

    assignments = 0
    for artist_id, cluster_id in list(clustering_result.cluster_ids.items()):
        if cluster_id != "uncategorized":
            continue

        tokens = token_sets[artist_id]
        if not tokens:
            continue

        best_similarity = 0.0
        best_cluster_id: str | None = None
        for candidate_cluster_id, member_ids in cluster_members.items():
            similarity = max(
                (_jaccard(tokens, token_sets[member_id]) for member_id in member_ids),
                default=0.0,
            )
            if similarity > best_similarity:
                best_similarity = similarity
                best_cluster_id = candidate_cluster_id

        if best_cluster_id and best_similarity >= GENRE_ASSIGN_MIN_SIMILARITY:
            clustering_result.cluster_ids[artist_id] = best_cluster_id
            cluster_members[best_cluster_id].append(artist_id)
            assignments += 1

    if assignments:
        _sync_cluster_sizes(clustering_result)

    return assignments


def _sync_cluster_sizes(clustering_result: ClusteringResult) -> None:
    counts: dict[str, int] = defaultdict(int)
    for cluster_id in clustering_result.cluster_ids.values():
        counts[cluster_id] += 1

    existing = {cluster.id: cluster for cluster in clustering_result.clusters}
    ordered_cluster_ids = [
        cluster.id
        for cluster in clustering_result.clusters
        if cluster.id != "uncategorized" and counts.get(cluster.id, 0) > 0
    ]
    ordered_cluster_ids.extend(
        sorted(
            cluster_id
            for cluster_id in counts
            if cluster_id != "uncategorized" and cluster_id not in ordered_cluster_ids
        )
    )

    clusters: list[ClusterRecord] = []
    for cluster_id in ordered_cluster_ids:
        current = existing.get(cluster_id)
        if current:
            clusters.append(
                ClusterRecord(
                    id=current.id,
                    label=current.label,
                    color=current.color,
                    size=counts[cluster_id],
                )
            )

    if counts.get("uncategorized", 0) > 0:
        current = existing.get("uncategorized")
        clusters.append(
            ClusterRecord(
                id="uncategorized",
                label=current.label if current else "Uncategorized",
                color=current.color if current else UNCATEGORIZED_COLOR,
                size=counts["uncategorized"],
            )
        )

    clustering_result.clusters = clusters


def _parse_played_at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _rank_score(index: int, total: int, *, minimum: int, maximum: int) -> int:
    if total <= 1:
        return maximum
    ratio = 1.0 - (index / (total - 1))
    return round(minimum + (maximum - minimum) * ratio)


def _artist_score_by_rank(
    top_artists: list[dict[str, Any]], play_counts: dict[str, int]
) -> dict[str, int]:
    scores: dict[str, int] = {}
    total = len(top_artists)
    for index, artist in enumerate(top_artists):
        artist_id = str(artist.get("id") or "")
        if not artist_id:
            continue
        scores[artist_id] = _rank_score(
            index,
            total,
            minimum=ARTIST_RANK_SCORE_MIN,
            maximum=ARTIST_RANK_SCORE_MAX,
        )

    # Recent plays are exact observations, but Spotify only exposes a small
    # recent window. Add them as a tie-breaker without pretending they are
    # lifetime totals.
    for artist_id, count in play_counts.items():
        scores[artist_id] = scores.get(artist_id, 0) + count

    return scores


def _build_session_records(
    user_id: str, recently_played_items: list[dict[str, Any]]
) -> list[SessionRecord]:
    sorted_items = sorted(
        recently_played_items,
        key=lambda item: _parse_played_at(str(item.get("played_at"))),
    )
    sessions: list[list[dict[str, Any]]] = []
    current_session: list[dict[str, Any]] = []
    previous_timestamp: datetime | None = None

    for item in sorted_items:
        played_at = _parse_played_at(str(item.get("played_at")))
        if (
            previous_timestamp is not None
            and (played_at - previous_timestamp).total_seconds() > 30 * 60
            and current_session
        ):
            sessions.append(current_session)
            current_session = []
        current_session.append(item)
        previous_timestamp = played_at

    if current_session:
        sessions.append(current_session)

    records: list[SessionRecord] = []
    for session in sessions:
        artist_sequence: list[str] = []
        for item in session:
            artists = ((item.get("track") or {}).get("artists") or [])
            for artist in artists:
                artist_id = str(artist.get("id") or "")
                if artist_id:
                    artist_sequence.append(artist_id)
        if artist_sequence:
            records.append(
                SessionRecord(
                    user_id=user_id,
                    session_date=_parse_played_at(str(session[-1].get("played_at"))).date().isoformat(),
                    artist_sequence=artist_sequence,
                )
            )

    return records


def _top_tracks_by_artist(top_tracks: list[dict[str, Any]]) -> dict[str, list[GraphTrack]]:
    tracks_by_artist: dict[str, list[GraphTrack]] = defaultdict(list)
    total = len(top_tracks)
    for index, track in enumerate(top_tracks):
        artists = track.get("artists", []) or []
        album = track.get("album", {}) or {}
        popularity = int(track.get("popularity") or 0)
        rank_score = _rank_score(
            index,
            total,
            minimum=TRACK_RANK_SCORE_MIN,
            maximum=TRACK_RANK_SCORE_MAX,
        )
        graph_track = GraphTrack(
            title=str(track.get("name") or "Unknown Track"),
            subtitle=str(album.get("name") or "") or None,
            play_count=max(popularity, rank_score),
        )
        for artist in artists:
            artist_id = str(artist.get("id") or "")
            if artist_id and len(tracks_by_artist[artist_id]) < 3:
                tracks_by_artist[artist_id].append(graph_track)
    return tracks_by_artist


def _artist_metadata(
    recently_played_items: list[dict[str, Any]],
    top_artists: list[dict[str, Any]],
    fetched_artists: list[dict[str, Any]],
    top_tracks: list[dict[str, Any]],
    embedding_result: EmbeddingResult,
) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    tracks_by_artist = _top_tracks_by_artist(top_tracks)
    artist_scores = _artist_score_by_rank(top_artists, embedding_result.play_counts)

    for artist in [*top_artists, *fetched_artists]:
        artist_id = str(artist.get("id") or "")
        if not artist_id:
            continue
        metadata[artist_id] = {
            "id": artist_id,
            "name": str(artist.get("name") or artist_id),
            "image_url": ((artist.get("images") or [{}])[0] or {}).get("url"),
            "genres": artist.get("genres", []) or [],
            "play_count": artist_scores.get(artist_id, 0),
            "top_tracks": tracks_by_artist.get(artist_id, []),
        }

    for item in recently_played_items:
        track = item.get("track", {}) or {}
        artists = track.get("artists", []) or []
        image_url = (((track.get("album") or {}).get("images") or [{}])[0] or {}).get("url")
        for artist in artists:
            artist_id = str(artist.get("id") or "")
            if not artist_id:
                continue
            existing = metadata.setdefault(
                artist_id,
                {
                    "id": artist_id,
                    "name": str(artist.get("name") or artist_id),
                    "image_url": image_url,
                    "genres": [],
                    "play_count": artist_scores.get(artist_id, 0),
                    "top_tracks": tracks_by_artist.get(artist_id, []),
                },
            )
            existing["play_count"] = artist_scores.get(artist_id, 0)
            if not existing.get("image_url"):
                existing["image_url"] = image_url

    for artist_id, play_count in embedding_result.play_counts.items():
        score = artist_scores.get(artist_id, play_count)
        metadata.setdefault(
            artist_id,
            {
                "id": artist_id,
                "name": artist_id,
                "image_url": None,
                "genres": [],
                "play_count": score,
                "top_tracks": tracks_by_artist.get(artist_id, []),
            },
        )

    return metadata


def _normalize_edge_weights(
    edge_weights: dict[tuple[str, str], int]
) -> list[GraphEdge]:
    if not edge_weights:
        return []
    max_weight = max(edge_weights.values()) or 1
    return [
        GraphEdge(
            source=source,
            target=target,
            weight=round(weight / max_weight, 4),
        )
        for (source, target), weight in sorted(
            edge_weights.items(), key=lambda item: item[1], reverse=True
        )
    ]


@dataclass
class GraphPipeline:
    repository: SupabaseRepository
    spotify_service: SpotifyService
    labeling_service: ClusterLabelingService

    def _fetch_spotify_bundle(
        self,
        access_token: str,
        time_range: str,
    ) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        user_profile = self.spotify_service.fetch_user_profile(access_token)
        top_artists = self.spotify_service.get_top_artists(access_token, time_range)
        top_tracks = self.spotify_service.get_top_tracks(access_token, time_range)
        recently_played = self.spotify_service.get_recently_played(access_token)
        return user_profile, top_artists, top_tracks, recently_played

    def generate_graph(self, request: GraphGenerateRequest) -> GraphPayload:
        if not request.force_refresh:
            cached = self.repository.get_cached_graph(request.user_id, request.time_range)
            if cached is not None:
                return cached

        access_token = request.access_token

        try:
            user_profile, top_artists, top_tracks, recently_played = self._fetch_spotify_bundle(
                access_token, request.time_range
            )
        except SpotifyAPIError as exc:
            if exc.status_code == 401 and request.refresh_token:
                try:
                    refreshed = self.spotify_service.refresh_access_token(
                        request.refresh_token
                    )
                    refreshed_access_token = str(refreshed.get("access_token") or "")
                    if not refreshed_access_token:
                        raise GraphGenerationError("Spotify token refresh failed")
                    access_token = refreshed_access_token
                    user_profile, top_artists, top_tracks, recently_played = (
                        self._fetch_spotify_bundle(
                            access_token, request.time_range
                        )
                    )
                except (SpotifyAPIError, GraphGenerationError) as refresh_exc:
                    raise GraphGenerationError(str(refresh_exc)) from refresh_exc
            else:
                raise GraphGenerationError(str(exc)) from exc

        self.repository.upsert_user(
            UserRecord(
                id=request.user_id,
                display_name=user_profile.get("display_name"),
                email=user_profile.get("email"),
                avatar_url=((user_profile.get("images") or [{}])[0] or {}).get("url"),
            )
        )

        session_sequences = segment_sessions(recently_played)
        session_records = _build_session_records(request.user_id, recently_played)
        self.repository.replace_sessions(request.user_id, session_records)

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
                # Genres enrich graph placement; generation should not fail on them.
                fetched_artists = []

        genres_by_artist: dict[str, list[str]] = {}
        for artist in [*top_artists, *fetched_artists]:
            artist_id = str(artist.get("id") or "")
            if artist_id:
                genres_by_artist[artist_id] = list(artist.get("genres", []) or [])

        embedding_result = train_artist_embeddings(session_sequences, genres_by_artist)
        clustering_result = cluster_artist_embeddings(embedding_result.vectors)
        genre_assignments = _assign_uncategorized_by_genre(
            clustering_result, genres_by_artist
        )
        artist_metadata = _artist_metadata(
            recently_played, top_artists, fetched_artists, top_tracks, embedding_result
        )

        cluster_members: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for artist_id, metadata in artist_metadata.items():
            cluster_id = clustering_result.cluster_ids.get(artist_id, "uncategorized")
            cluster_members[cluster_id].append(metadata)

        cluster_labels = self.labeling_service.label_clusters(cluster_members)
        clusters = [
            GraphCluster(
                id=cluster.id,
                label=cluster_labels.get(cluster.id, cluster.label),
                color=cluster.color,
                size=cluster.size,
            )
            for cluster in clustering_result.clusters
        ]

        nodes: list[GraphNode] = []
        for artist_id, metadata in sorted(
            artist_metadata.items(),
            key=lambda item: int(item[1].get("play_count", 0)),
            reverse=True,
        ):
            x, y = clustering_result.positions.get(artist_id, (0.0, 0.0))
            cluster_id = clustering_result.cluster_ids.get(artist_id, "uncategorized")
            nodes.append(
                GraphNode(
                    id=artist_id,
                    name=str(metadata.get("name") or artist_id),
                    image_url=metadata.get("image_url"),
                    play_count=int(metadata.get("play_count") or 0),
                    cluster_id=cluster_id,
                    cluster_label=cluster_labels.get(cluster_id, "Uncategorized"),
                    x=round(float(x), 4),
                    y=round(float(y), 4),
                    top_tracks=metadata.get("top_tracks", []),
                )
            )

        listening_edges = _normalize_edge_weights(embedding_result.edge_weights)
        genre_edges = _genre_edges_for_orphans(
            sorted(artist_metadata), genres_by_artist, listening_edges
        )
        all_edges = [*listening_edges, *genre_edges]

        payload = GraphPayload(
            nodes=nodes,
            edges=all_edges,
            clusters=clusters,
            stats=GraphStats(
                artists=len(nodes),
                edges=len(all_edges),
                clusters=len(clusters),
            ),
            metadata={
                "time_range": request.time_range,
                "fallback_used": embedding_result.fallback_used
                or clustering_result.fallback_used,
                "fallback_reasons": embedding_result.fallback_reasons,
                "genre_assignments": genre_assignments,
            },
        )

        self.repository.save_graph(request.user_id, request.time_range, payload)
        return payload
