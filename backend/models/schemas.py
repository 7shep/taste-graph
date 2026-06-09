from __future__ import annotations

from typing import Any, Literal

from backend._compat import BaseModel, Field

TimeRange = Literal["short_term", "medium_term", "long_term"]


class ErrorResponse(BaseModel):
    error: str
    detail: str


class SpotifyTokens(BaseModel):
    access_token: str
    refresh_token: str | None = None
    expires_in: int | None = None


class GraphGenerateRequest(BaseModel):
    user_id: str
    time_range: TimeRange = "medium_term"
    access_token: str
    refresh_token: str | None = None
    force_refresh: bool = False


class GraphTrack(BaseModel):
    title: str
    subtitle: str | None = None
    play_count: int | None = None


class GraphNode(BaseModel):
    id: str
    name: str
    image_url: str | None = None
    play_count: int
    cluster_id: str
    cluster_label: str
    x: float
    y: float
    top_tracks: list[GraphTrack] = Field(default_factory=list)


class GraphEdge(BaseModel):
    source: str
    target: str
    weight: float
    kind: Literal["listening", "genre"] = "listening"


class GraphCluster(BaseModel):
    id: str
    label: str
    color: str
    size: int


class GraphStats(BaseModel):
    artists: int
    edges: int
    clusters: int


class GraphPayload(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    clusters: list[GraphCluster] = Field(default_factory=list)
    stats: GraphStats
    metadata: dict[str, Any] = Field(default_factory=dict)


class CachedGraphRecord(BaseModel):
    user_id: str
    time_range: TimeRange
    graph_json: GraphPayload | dict[str, Any]
    share_slug: str | None = None
    is_public: bool = False


class UserRecord(BaseModel):
    id: str
    display_name: str | None = None
    email: str | None = None
    avatar_url: str | None = None


class SessionRecord(BaseModel):
    user_id: str
    session_date: str
    artist_sequence: list[str] = Field(default_factory=list)
