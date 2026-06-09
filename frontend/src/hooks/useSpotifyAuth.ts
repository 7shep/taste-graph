import { useState } from "react";
import { getSpotifyLoginUrl } from "../lib/api";

const DEFAULT_ERROR =
  "Could not start Spotify login. Please try again in a moment.";

export function useSpotifyAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beginLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { url } = await getSpotifyLoginUrl();
      window.location.assign(url);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : DEFAULT_ERROR,
      );
      setIsLoading(false);
    }
  };

  return {
    beginLogin,
    error,
    isLoading,
  };
}
