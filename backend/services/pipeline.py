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
from backend.services.clustering import cluster_artist_embeddings
from backend.services.embeddings import EmbeddingResult, train_artist_embeddings
from backend.services.labeling import ClusterLabelingService
from backend.services.spotify import SpotifyAPIError, SpotifyService, segment_sessions


class GraphGenerationError(RuntimeError):
    pass


def _parse_played_at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


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
    for track in top_tracks:
        artists = track.get("artists", []) or []
        album = track.get("album", {}) or {}
        graph_track = GraphTrack(
            title=str(track.get("name") or "Unknown Track"),
            subtitle=str(album.get("name") or "") or None,
            play_count=int(track.get("popularity") or 0),
        )
        for artist in artists:
            artist_id = str(artist.get("id") or "")
            if artist_id and len(tracks_by_artist[artist_id]) < 3:
                tracks_by_artist[artist_id].append(graph_track)
    return tracks_by_artist


def _artist_metadata(
    recently_played_items: list[dict[str, Any]],
    top_artists: list[dict[str, Any]],
    top_tracks: list[dict[str, Any]],
    embedding_result: EmbeddingResult,
) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    tracks_by_artist = _top_tracks_by_artist(top_tracks)

    for artist in top_artists:
        artist_id = str(artist.get("id") or "")
        if not artist_id:
            continue
        metadata[artist_id] = {
            "id": artist_id,
            "name": str(artist.get("name") or artist_id),
            "image_url": ((artist.get("images") or [{}])[0] or {}).get("url"),
            "genres": artist.get("genres", []) or [],
            "play_count": embedding_result.play_counts.get(artist_id, 0),
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
                    "play_count": 0,
                    "top_tracks": tracks_by_artist.get(artist_id, []),
                },
            )
            existing["play_count"] = embedding_result.play_counts.get(artist_id, 0)
            if not existing.get("image_url"):
                existing["image_url"] = image_url

    for artist_id, play_count in embedding_result.play_counts.items():
        metadata.setdefault(
            artist_id,
            {
                "id": artist_id,
                "name": artist_id,
                "image_url": None,
                "genres": [],
                "play_count": play_count,
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

        try:
            user_profile, top_artists, top_tracks, recently_played = self._fetch_spotify_bundle(
                request.access_token, request.time_range
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
                    user_profile, top_artists, top_tracks, recently_played = (
                        self._fetch_spotify_bundle(
                            refreshed_access_token, request.time_range
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

        embedding_result = train_artist_embeddings(session_sequences, top_artists)
        clustering_result = cluster_artist_embeddings(embedding_result.vectors)
        artist_metadata = _artist_metadata(
            recently_played, top_artists, top_tracks, embedding_result
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

        payload = GraphPayload(
            nodes=nodes,
            edges=_normalize_edge_weights(embedding_result.edge_weights),
            clusters=clusters,
            stats=GraphStats(
                artists=len(nodes),
                edges=len(embedding_result.edge_weights),
                clusters=len(clusters),
            ),
            metadata={
                "time_range": request.time_range,
                "fallback_used": embedding_result.fallback_used
                or clustering_result.fallback_used,
                "fallback_reasons": embedding_result.fallback_reasons,
            },
        )

        self.repository.save_graph(request.user_id, request.time_range, payload)
        return payload
