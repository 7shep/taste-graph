export type TimeRange = "short_term" | "medium_term" | "long_term";

export type LabelMode = "all" | "focus";

export interface GraphTrack {
  title: string;
  subtitle?: string | null;
  playCount?: number | null;
}

export interface GraphNode {
  id: string;
  name: string;
  imageUrl?: string | null;
  playCount: number;
  listeningHours?: number | null;
  clusterId: string;
  clusterLabel: string;
  x?: number;
  y?: number;
  topTracks?: GraphTrack[];
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphCluster {
  id: string;
  label: string;
  color?: string | null;
  size: number;
}

export interface GraphStats {
  artists: number;
  edges: number;
  clusters: number;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  stats?: GraphStats;
}

export interface NormalizedGraphCluster extends GraphCluster {
  color: string;
}

export interface NormalizedGraphNode extends GraphNode {
  color: string;
}

export interface NormalizedGraphPayload {
  nodes: NormalizedGraphNode[];
  edges: GraphEdge[];
  clusters: NormalizedGraphCluster[];
  stats: GraphStats;
}

export interface GraphApiErrorShape {
  error: string;
  detail: string;
}

export const DEFAULT_CLUSTER_PALETTE = [
  "#EF8A6B",
  "#E9BD5A",
  "#7FD4A8",
  "#9AA9EE",
  "#C79DF0",
  "#6ED5E6",
  "#F28BB8",
  "#B6A0FF",
] as const;

export const UNCATEGORIZED_COLOR = "#9CA3AF";

export const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: "short_term", label: "4w" },
  { value: "medium_term", label: "6m" },
  { value: "long_term", label: "All" },
];
