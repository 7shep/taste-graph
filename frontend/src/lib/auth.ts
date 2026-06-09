export interface SpotifyAuthSession {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  userId: string;
}

const STORAGE_KEY = "taste-graph.spotify-session";

function readFragmentParams(hash: string) {
  return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

export function readSpotifyAuthSession(): SpotifyAuthSession | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SpotifyAuthSession;
    if (!parsed.accessToken || !parsed.userId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function persistSpotifyAuthSession(session: SpotifyAuthSession) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSpotifyAuthSession() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function readSpotifyAuthError(hash: string): string | null {
  const params = readFragmentParams(hash);
  return params.get("auth_error");
}

export function getSpotifyAuthErrorMessage(
  errorCode: string | null,
): string | null {
  if (!errorCode) {
    return null;
  }

  switch (errorCode) {
    case "access_denied":
      return "Spotify login was cancelled or denied.";
    case "callback_unavailable":
      return "Spotify returned to the app, but the callback could not be completed.";
    case "spotify_auth_unavailable":
      return "Spotify OAuth is not configured on the backend.";
    case "token_exchange_failed":
      return "Spotify accepted the login, but the app could not finish the token exchange. Check the client ID, client secret, and redirect URI.";
    default:
      return `Spotify login failed (${errorCode}).`;
  }
}

export function persistSpotifyAuthSessionFromHash(
  hash: string,
): SpotifyAuthSession | null {
  const params = readFragmentParams(hash);
  const accessToken = params.get("access_token");
  const userId = params.get("user_id");

  if (!accessToken || !userId) {
    return null;
  }

  const session: SpotifyAuthSession = {
    accessToken,
    refreshToken: params.get("refresh_token"),
    expiresIn: params.get("expires_in")
      ? Number.parseInt(params.get("expires_in") || "", 10)
      : null,
    userId,
  };
  persistSpotifyAuthSession(session);
  return session;
}
