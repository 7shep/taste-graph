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

function buildGraphUrl(timeRange: TimeRange) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const endpoint = import.meta.env.VITE_GRAPH_ENDPOINT?.trim() || "/api/graph";
  const path = endpoint.startsWith("http")
    ? endpoint
    : `${baseUrl ? trimTrailingSlash(baseUrl) : ""}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const url = new URL(path, window.location.origin);

  url.searchParams.set("time_range", timeRange);
  return url.toString();
}

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
