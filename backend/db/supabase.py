from __future__ import annotations

from copy import deepcopy
from typing import Any

from backend.models.schemas import CachedGraphRecord, GraphPayload, SessionRecord, UserRecord


class SupabaseRepository:
    """Cache and persistence boundary for users, sessions, and graphs.

    The production path is expected to use the Supabase Python client. For local
    tests and offline development, this class falls back to an in-memory store.
    """

    def __init__(self, client: Any | None = None) -> None:
        self.client = client
        self._graph_cache: dict[tuple[str, str], dict[str, Any]] = {}
        self._users: dict[str, dict[str, Any]] = {}
        self._sessions: dict[str, list[dict[str, Any]]] = {}

    def get_cached_graph(self, user_id: str, time_range: str) -> GraphPayload | None:
        cached = self._graph_cache.get((user_id, time_range))
        if not cached:
            return None

        payload = cached["graph_json"]
        if isinstance(payload, GraphPayload):
            return payload
        return GraphPayload.model_validate(payload)

    def save_graph(
        self,
        user_id: str,
        time_range: str,
        graph_payload: GraphPayload,
        *,
        share_slug: str | None = None,
        is_public: bool = False,
    ) -> CachedGraphRecord:
        record = CachedGraphRecord(
            user_id=user_id,
            time_range=time_range,
            graph_json=graph_payload,
            share_slug=share_slug,
            is_public=is_public,
        )
        self._graph_cache[(user_id, time_range)] = record.model_dump()
        return record

    def upsert_user(self, user_record: UserRecord) -> UserRecord:
        self._users[user_record.id] = deepcopy(user_record.model_dump())
        return user_record

    def replace_sessions(
        self, user_id: str, session_records: list[SessionRecord]
    ) -> list[SessionRecord]:
        self._sessions[user_id] = [deepcopy(record.model_dump()) for record in session_records]
        return session_records

    def list_sessions(self, user_id: str) -> list[SessionRecord]:
        return [
            SessionRecord.model_validate(record)
            for record in self._sessions.get(user_id, [])
        ]

