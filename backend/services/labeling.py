from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error as urllib_error
from urllib import parse, request


SYSTEM_PROMPT = "You are a music taste analyst. Respond only with the label, nothing else."
GENRE_SYSTEM_PROMPT = (
    "You are a music metadata expert. Respond only with a JSON object, nothing else."
)
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
MAX_GENRES_PER_ARTIST = 3


@dataclass
class ClusterLabelingService:
    api_key: str | None = None
    client: Any | None = None
    model: str = "gemini-2.5-flash"
    # Separate model for genre inference: free-tier quotas are tracked per
    # model, and cluster labeling already consumes the flash quota (one call
    # per cluster). flash-lite has a much higher free request budget.
    genre_model: str = "gemini-2.5-flash-lite"

    def _fallback_label(self, cluster_id: str, index: int) -> str:
        if cluster_id == "uncategorized":
            return "Uncategorized"
        return f"Cluster {index + 1}"

    def _request_label_from_client(self, artist_names: list[str]) -> str:
        if hasattr(self.client, "generate_label"):
            text = self.client.generate_label(
                artist_names=artist_names,
                system_prompt=SYSTEM_PROMPT,
                model=self.model,
            )
            if isinstance(text, str) and text.strip():
                return text.strip()
        raise RuntimeError("Injected Gemini client did not return a valid label")

    def _request_label_from_api(self, artist_names: list[str]) -> str:
        if not self.api_key:
            raise RuntimeError("Gemini API key unavailable")

        prompt = (
            "Given these artists: "
            + ", ".join(artist_names)
            + ", give this music taste cluster a short, evocative 2-4 word name. "
            + "Examples: 'Late Night Rap', 'Sunday Morning Indie', 'Gym Mode'. "
            + "Respond with only the name."
        )
        payload = {
            "system_instruction": {
                "parts": [{"text": SYSTEM_PROMPT}],
            },
            "contents": [
                {
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 24,
            },
        }
        url = f"{GEMINI_API_BASE}/{parse.quote(self.model)}:generateContent?key={parse.quote(self.api_key)}"
        req = request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )

        try:
            with request.urlopen(req) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(detail or "Gemini label request failed") from exc
        except urllib_error.URLError as exc:
            raise RuntimeError(str(exc.reason)) from exc

        candidates = body.get("candidates", []) or []
        if not candidates:
            raise RuntimeError("Gemini returned no candidates")

        parts = (((candidates[0] or {}).get("content") or {}).get("parts") or [])
        text = "".join(str(part.get("text") or "") for part in parts).strip()
        if not text:
            raise RuntimeError("Gemini returned empty label text")

        return text.strip().strip('"').strip("'")

    def _sanitize_genre_mapping(
        self, raw: Any, requested_ids: set[str]
    ) -> dict[str, list[str]]:
        if not isinstance(raw, dict):
            return {}
        genres_by_id: dict[str, list[str]] = {}
        for artist_id, genres in raw.items():
            if artist_id not in requested_ids or not isinstance(genres, list):
                continue
            cleaned = [
                str(genre).strip().lower()
                for genre in genres[:MAX_GENRES_PER_ARTIST]
                if str(genre).strip()
            ]
            if cleaned:
                genres_by_id[artist_id] = cleaned
        return genres_by_id

    def _request_genres_from_client(
        self, artists: list[dict[str, str]]
    ) -> dict[str, list[str]]:
        if hasattr(self.client, "generate_genres"):
            return self.client.generate_genres(
                artists=artists,
                system_prompt=GENRE_SYSTEM_PROMPT,
                model=self.genre_model,
            )
        raise RuntimeError("Injected Gemini client does not support genre inference")

    def _request_genres_from_api(
        self, artists: list[dict[str, str]]
    ) -> dict[str, list[str]]:
        if not self.api_key:
            raise RuntimeError("Gemini API key unavailable")

        listing = "\n".join(f"{artist['id']}: {artist['name']}" for artist in artists)
        prompt = (
            "For each music artist below, list 1-3 genres or sub-genres that best "
            "describe them (e.g. 'rage rap', 'uk drill', 'indie pop'). Use lowercase. "
            "If you do not recognize an artist, omit it.\n"
            "Respond with only a JSON object mapping each artist id to an array of "
            "genre strings.\n\nArtists (id: name):\n" + listing
        )
        payload = {
            "system_instruction": {
                "parts": [{"text": GENRE_SYSTEM_PROMPT}],
            },
            "contents": [
                {
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 8192,
                "responseMimeType": "application/json",
            },
        }
        url = f"{GEMINI_API_BASE}/{parse.quote(self.genre_model)}:generateContent?key={parse.quote(self.api_key)}"
        req = request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )

        try:
            with request.urlopen(req) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(detail or "Gemini genre request failed") from exc
        except urllib_error.URLError as exc:
            raise RuntimeError(str(exc.reason)) from exc

        candidates = body.get("candidates", []) or []
        if not candidates:
            raise RuntimeError("Gemini returned no candidates")

        parts = (((candidates[0] or {}).get("content") or {}).get("parts") or [])
        text = "".join(str(part.get("text") or "") for part in parts).strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)

    def infer_artist_genres(
        self, artists: list[dict[str, str]]
    ) -> dict[str, list[str]]:
        """Infer genres per artist id in one batched Gemini call.

        Spotify stopped exposing artist genres to development-mode apps, so this
        is the primary genre source. Returns {} on any failure: genres enrich
        clustering but must never break graph generation.
        """
        if not artists:
            return {}

        try:
            if self.client is not None:
                raw = self._request_genres_from_client(artists)
            else:
                raw = self._request_genres_from_api(artists)
        except Exception:
            return {}

        requested_ids = {artist["id"] for artist in artists}
        return self._sanitize_genre_mapping(raw, requested_ids)

    def _request_label(self, artist_names: list[str]) -> str:
        if self.client is not None:
            return self._request_label_from_client(artist_names)
        return self._request_label_from_api(artist_names)

    def label_clusters(
        self,
        cluster_members: dict[str, list[dict[str, Any]]],
    ) -> dict[str, str]:
        labels: dict[str, str] = {}
        ordered_cluster_ids = sorted(cluster_members)

        for index, cluster_id in enumerate(ordered_cluster_ids):
            if cluster_id == "uncategorized":
                labels[cluster_id] = "Uncategorized"
                continue

            artists = sorted(
                cluster_members[cluster_id],
                key=lambda artist: int(artist.get("play_count", 0)),
                reverse=True,
            )
            artist_names = [
                str(artist.get("name") or artist.get("id") or "").strip()
                for artist in artists[:5]
                if str(artist.get("name") or artist.get("id") or "").strip()
            ]

            try:
                labels[cluster_id] = self._request_label(artist_names)
            except Exception:
                labels[cluster_id] = self._fallback_label(cluster_id, index)

        return labels
