import type {
  GraphApiErrorShape,
  GraphPayload,
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

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildApiUrl(endpoint: string) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const path = endpoint.startsWith("http")
    ? endpoint
    : `${baseUrl ? trimTrailingSlash(baseUrl) : ""}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  return new URL(path, window.location.origin);
}

function buildGraphUrl(timeRange: TimeRange) {
  const endpoint = import.meta.env.VITE_GRAPH_ENDPOINT?.trim() || "/api/graph";
  const url = buildApiUrl(endpoint);

  url.searchParams.set("time_range", timeRange);
  return url.toString();
}

export type SpotifyLoginStartResponse = {
  url: string;
};

export async function fetchGraphPayload(
  timeRange: TimeRange,
  signal?: AbortSignal,
): Promise<GraphPayload> {
  const response = await fetch(buildGraphUrl(timeRange), {
    headers: {
      Accept: "application/json",
    },
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

  return (await response.json()) as GraphPayload;
}

export async function getSpotifyLoginUrl(
  signal?: AbortSignal,
): Promise<SpotifyLoginStartResponse> {
  const endpoint =
    import.meta.env.VITE_SPOTIFY_AUTH_START_ENDPOINT?.trim() ||
    "/api/auth/spotify/login";
  const response = await fetch(buildApiUrl(endpoint), {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error("Unable to start Spotify login.");
  }

  const payload = (await response.json()) as Partial<SpotifyLoginStartResponse>;
  if (!payload.url || typeof payload.url !== "string") {
    throw new Error("Spotify login response did not include a redirect URL.");
  }

  return { url: payload.url };
}
