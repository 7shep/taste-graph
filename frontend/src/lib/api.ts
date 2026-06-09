import { readSpotifyAuthSession, type SpotifyAuthSession } from "./auth";
import type {
  GraphApiPayload,
  GraphApiErrorShape,
  GraphGenerateRequest,
  GraphPayload,
  SpotifyLoginStartResponse,
  TimeRange,
} from "../types/graph";

export class GraphApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, error: string, detail: string) {
    super(error);
    this.name = "GraphApiError";
    this.status = status;
    this.detail = detail;
  }
}

export class AuthStartError extends Error {
  code: "network" | "response";

  constructor(code: "network" | "response", message: string) {
    super(message);
    this.name = "AuthStartError";
    this.code = code;
  }
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildApiUrl(endpoint: string) {
  if (
    import.meta.env.DEV &&
    endpoint.startsWith("/") &&
    !endpoint.startsWith("//")
  ) {
    return new URL(endpoint, window.location.origin);
  }

  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const path = endpoint.startsWith("http")
    ? endpoint
    : `${baseUrl ? trimTrailingSlash(baseUrl) : ""}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  return new URL(path, window.location.origin);
}

function buildGraphUrl(timeRange: TimeRange) {
  const endpoint =
    import.meta.env.VITE_GRAPH_ENDPOINT?.trim() || "/api/graph/generate";
  return buildApiUrl(endpoint).toString();
}

function getFallbackAuthSession(): SpotifyAuthSession | null {
  const accessToken = import.meta.env.VITE_SPOTIFY_ACCESS_TOKEN?.trim();
  const userId = import.meta.env.VITE_SPOTIFY_USER_ID?.trim();
  if (!accessToken || !userId) {
    return null;
  }

  return {
    accessToken,
    refreshToken: import.meta.env.VITE_SPOTIFY_REFRESH_TOKEN?.trim() || null,
    expiresIn: null,
    userId,
  };
}

function buildGraphRequest(timeRange: TimeRange): GraphGenerateRequest {
  const authSession = readSpotifyAuthSession() || getFallbackAuthSession();
  if (!authSession) {
    throw new Error("Spotify login is required before loading the dashboard.");
  }

  return {
    user_id: authSession.userId,
    access_token: authSession.accessToken,
    refresh_token: authSession.refreshToken,
    time_range: timeRange,
  };
}

function normalizeGraphPayload(payload: GraphApiPayload): GraphPayload {
  return {
    nodes: payload.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      imageUrl: node.image_url ?? null,
      playCount: node.play_count,
      clusterId: node.cluster_id,
      clusterLabel: node.cluster_label,
      x: node.x,
      y: node.y,
      topTracks: node.top_tracks?.map((track) => ({
        title: track.title,
        subtitle: track.subtitle ?? null,
        playCount: track.play_count ?? null,
      })),
    })),
    edges: payload.edges,
    clusters: payload.clusters.map((cluster) => ({
      id: cluster.id,
      label: cluster.label,
      color: cluster.color ?? null,
      size: cluster.size,
    })),
    stats: payload.stats,
  };
}

export async function fetchGraphPayload(
  timeRange: TimeRange,
  signal?: AbortSignal,
): Promise<GraphPayload> {
  const response = await fetch(buildGraphUrl(timeRange), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildGraphRequest(timeRange)),
    signal,
  });

  if (!response.ok) {
    let errorShape: GraphApiErrorShape | null = null;
    try {
      errorShape = (await response.json()) as GraphApiErrorShape;
    } catch {
      errorShape = null;
    }

    throw new GraphApiError(
      response.status,
      errorShape?.error || "Failed to load graph",
      errorShape?.detail || "The graph request did not complete successfully.",
    );
  }

  return normalizeGraphPayload((await response.json()) as GraphApiPayload);
}

export async function getSpotifyLoginUrl(
  returnTo: string,
  signal?: AbortSignal,
): Promise<SpotifyLoginStartResponse> {
  const endpoint =
    import.meta.env.VITE_SPOTIFY_AUTH_START_ENDPOINT?.trim() ||
    "/api/auth/spotify/login";
  const url = buildApiUrl(endpoint);
  url.searchParams.set("return_to", returnTo);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal,
    });
  } catch (caughtError) {
    if (caughtError instanceof TypeError) {
      throw new AuthStartError(
        "network",
        "Backend auth server is unavailable. Start the API on http://localhost:8000 and try again.",
      );
    }
    throw caughtError;
  }

  if (!response.ok) {
    let errorShape: GraphApiErrorShape | null = null;
    try {
      errorShape = (await response.json()) as GraphApiErrorShape;
    } catch {
      errorShape = null;
    }

    throw new AuthStartError(
      "response",
      errorShape?.detail ||
        errorShape?.error ||
        "Unable to start Spotify login.",
    );
  }

  const payload = (await response.json()) as Partial<SpotifyLoginStartResponse>;
  if (!payload.url || typeof payload.url !== "string") {
    throw new AuthStartError(
      "response",
      "Spotify login response did not include a redirect URL.",
    );
  }

  return { url: payload.url };
}
