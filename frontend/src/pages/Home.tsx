import { useSpotifyAuth } from "../hooks/useSpotifyAuth";

function BrandMark() {
  return (
    <span className="tg-brand-mark" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 22 22" fill="none">
        <circle cx="6" cy="6" r="3.5" fill="#EF8A6B" />
        <circle cx="16" cy="7" r="2.5" fill="#E9BD5A" />
        <circle cx="7" cy="16" r="2.5" fill="#7FD4A8" />
        <circle cx="15.5" cy="15.5" r="3" fill="#9AA9EE" />
        <path
          d="M6 6 L16 7 M6 6 L7 16 M16 7 L15.5 15.5 M7 16 L15.5 15.5"
          stroke="#F4EDE3"
          strokeOpacity="0.35"
          strokeWidth="0.8"
        />
      </svg>
    </span>
  );
}

export default function HomePage() {
  const { beginLogin, error, isLoading } = useSpotifyAuth();

  return (
    <main className="tg-home-shell">
      <div className="tg-home-card">
        <div className="tg-home-brand" aria-label="Taste Graph">
          <BrandMark />
          <span className="tg-brand-name">
            Taste<em>Graph</em>
          </span>
        </div>

        <button
          type="button"
          className="tg-spotify-button"
          disabled={isLoading}
          onClick={() => void beginLogin()}
        >
          <span className="tg-spotify-button-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Zm4.816 15.137a.656.656 0 0 1-.903.218c-2.473-1.51-5.585-1.852-9.25-1.014a.655.655 0 1 1-.292-1.277c4.008-.915 7.447-.525 10.226 1.17a.655.655 0 0 1 .219.903Zm1.29-2.87a.82.82 0 0 1-1.129.273c-2.83-1.74-7.14-2.245-10.488-1.228a.82.82 0 1 1-.477-1.568c3.82-1.162 8.567-.596 11.823 1.404a.82.82 0 0 1 .272 1.128Zm.11-2.99C14.83 8.765 9.246 8.58 6.013 9.56a.983.983 0 0 1-.572-1.88c3.71-1.126 9.884-.907 13.803 1.412a.983.983 0 0 1-1.028 1.686Z" />
            </svg>
          </span>
          <span>{isLoading ? "Connecting..." : "Log in with Spotify"}</span>
        </button>

        {error ? (
          <p className="tg-home-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
