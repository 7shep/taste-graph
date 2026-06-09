from __future__ import annotations

import unittest

from backend.services.spotify import segment_sessions


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


if __name__ == "__main__":
    unittest.main()
