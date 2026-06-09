from __future__ import annotations

import unittest

from backend.services.spotify import SpotifyService, segment_sessions


class SpotifyServiceTests(unittest.TestCase):
    def test_segment_sessions_splits_on_thirty_minute_gap(self) -> None:
        recently_played = [
            {
                "played_at": "2026-06-08T10:00:00Z",
                "track": {"artists": [{"id": "artist-a"}]},
            },
            {
                "played_at": "2026-06-08T10:10:00Z",
                "track": {"artists": [{"id": "artist-b"}]},
            },
            {
                "played_at": "2026-06-08T11:00:01Z",
                "track": {"artists": [{"id": "artist-c"}]},
            },
        ]

        sessions = segment_sessions(recently_played)

        self.assertEqual(sessions, [["artist-a", "artist-b"], ["artist-c"]])

    def test_segment_sessions_includes_all_credited_artists(self) -> None:
        recently_played = [
            {
                "played_at": "2026-06-08T10:00:00Z",
                "track": {
                    "artists": [
                        {"id": "imagine-dragons"},
                        {"id": "jid"},
                    ]
                },
            },
            {
                "played_at": "2026-06-08T10:05:00Z",
                "track": {"artists": [{"id": "artist-b"}]},
            },
        ]

        sessions = segment_sessions(recently_played)

        self.assertEqual(sessions, [["imagine-dragons", "jid", "artist-b"]])


class GetArtistsTests(unittest.TestCase):
    def test_get_artists_chunks_ids_in_batches_of_fifty(self) -> None:
        service = SpotifyService()
        requested_urls: list[str] = []

        def fake_request_json(method, url, **kwargs):
            requested_urls.append(url)
            from urllib import parse

            query = parse.parse_qs(parse.urlsplit(url).query)
            ids = query["ids"][0].split(",")
            return {"artists": [{"id": artist_id, "genres": []} for artist_id in ids]}

        service._request_json = fake_request_json  # type: ignore[method-assign]

        ids = [f"artist-{index}" for index in range(60)] + ["artist-0", ""]
        artists = service.get_artists("token", ids)

        self.assertEqual(len(requested_urls), 2)
        self.assertEqual(len(artists), 60)
        self.assertEqual(artists[0]["id"], "artist-0")


if __name__ == "__main__":
    unittest.main()
