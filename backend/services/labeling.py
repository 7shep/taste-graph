from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error as urllib_error
from urllib import parse, request


SYSTEM_PROMPT = "You are a music taste analyst. Respond only with the label, nothing else."
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


@dataclass
class ClusterLabelingService:
    api_key: str | None = None
    client: Any | None = None
    model: str = "gemini-2.5-flash"

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
