import { useCallback, useEffect, useMemo, useState } from "react";
import { graphFixture } from "../fixtures/graph";
import { fetchGraphPayload, GraphApiError } from "../lib/api";
import type {
  GraphCluster,
  GraphPayload,
  GraphStats,
  NormalizedGraphCluster,
  NormalizedGraphNode,
  NormalizedGraphPayload,
  TimeRange,
} from "../types/graph";
import { DEFAULT_CLUSTER_PALETTE, UNCATEGORIZED_COLOR } from "../types/graph";

type GraphStatus = "idle" | "loading" | "success" | "error";
type GraphSource = "api" | "fixture";

interface UseGraphDataResult {
  data: NormalizedGraphPayload | null;
  error: string | null;
  status: GraphStatus;
  source: GraphSource | null;
  refresh: () => void;
}

function shouldUseFixtureFallback(caughtError: unknown) {
  const envValue = import.meta.env.VITE_USE_GRAPH_FIXTURE;
  if (envValue === "true") {
    return true;
  }
  if (envValue === "false") {
    return false;
  }

  if (import.meta.env.DEV) {
    return true;
  }

  if (caughtError instanceof GraphApiError) {
    return [404, 502, 503, 504].includes(caughtError.status);
  }

  return caughtError instanceof TypeError;
}

function deriveClusters(payload: GraphPayload) {
  const clusterMap = new Map<string, GraphCluster>();

  for (const cluster of payload.clusters) {
    clusterMap.set(cluster.id, cluster);
  }

  for (const node of payload.nodes) {
    if (!clusterMap.has(node.clusterId)) {
      clusterMap.set(node.clusterId, {
        id: node.clusterId,
        label: node.clusterLabel || node.clusterId,
        size: 0,
      });
    }
  }

  const counts = new Map<string, number>();
  for (const node of payload.nodes) {
    counts.set(node.clusterId, (counts.get(node.clusterId) || 0) + 1);
  }

  return Array.from(clusterMap.values()).map((cluster, index) => {
    const fallbackColor =
      cluster.id.toLowerCase() === "uncategorized" ||
      cluster.label.toLowerCase() === "uncategorized"
        ? UNCATEGORIZED_COLOR
        : DEFAULT_CLUSTER_PALETTE[index % DEFAULT_CLUSTER_PALETTE.length];

    return {
      ...cluster,
      size: counts.get(cluster.id) || cluster.size || 0,
      color: cluster.color || fallbackColor,
    } satisfies NormalizedGraphCluster;
  });
}

function deriveStats(
  payload: GraphPayload,
  clusters: NormalizedGraphCluster[],
): GraphStats {
  return (
    payload.stats || {
      artists: payload.nodes.length,
      edges: payload.edges.length,
      clusters: clusters.length,
    }
  );
}

function normalizePayload(payload: GraphPayload): NormalizedGraphPayload {
  const clusters = deriveClusters(payload);
  const clusterMap = new Map(clusters.map((cluster) => [cluster.id, cluster]));

  const nodes: NormalizedGraphNode[] = payload.nodes
    .map((node) => {
      const cluster = clusterMap.get(node.clusterId);
      return {
        ...node,
        clusterLabel: node.clusterLabel || cluster?.label || node.clusterId,
        color: cluster?.color || UNCATEGORIZED_COLOR,
      };
    })
    .sort((left, right) => right.playCount - left.playCount);

  return {
    nodes,
    edges: payload.edges,
    clusters,
    stats: deriveStats(payload, clusters),
  };
}

export function useGraphData(
  timeRange: TimeRange,
  enabled: boolean = true,
): UseGraphDataResult {
  const [data, setData] = useState<NormalizedGraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GraphStatus>("idle");
  const [source, setSource] = useState<GraphSource | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const loadGraph = async () => {
      setStatus("loading");
      setError(null);

      try {
        const payload = await fetchGraphPayload(timeRange, controller.signal);
        setData(normalizePayload(payload));
        setSource("api");
        setStatus("success");
      } catch (caughtError) {
        if (controller.signal.aborted) {
          return;
        }

        if (shouldUseFixtureFallback(caughtError)) {
          setData(normalizePayload(graphFixture));
          setSource("fixture");
          setStatus("success");
          return;
        }

        const message =
          caughtError instanceof GraphApiError
            ? `${caughtError.message}: ${caughtError.detail}`
            : caughtError instanceof Error && caughtError.message
              ? caughtError.message
              : "Unable to load graph data.";
        setError(message);
        setStatus("error");
      }
    };

    void loadGraph();

    return () => controller.abort();
  }, [enabled, refreshToken, timeRange]);

  return useMemo(
    () => ({
      data,
      error,
      status,
      source,
      refresh,
    }),
    [data, error, refresh, source, status],
  );
}
