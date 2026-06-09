import type { GraphEdge, NormalizedGraphNode } from "../types/graph";

interface NodeCardProps {
  node: NormalizedGraphNode | null;
  nodes: NormalizedGraphNode[];
  edges: GraphEdge[];
  onSelectNode: (nodeId: string) => void;
}

interface NeighborSummary {
  id: string;
  name: string;
  color: string;
  weight: number;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildTrend(seedValue: string) {
  let seed = hashString(seedValue);
  const points: number[] = [];

  for (let index = 0; index < 26; index += 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const noise = (seed / 4294967296 - 0.5) * 0.22;
    const slope = index / 42;
    const wave = Math.sin(index / 3.2) * 0.08;
    points.push(Math.max(0.12, 0.45 + slope + wave + noise));
  }

  return points;
}

function buildPath(values: number[], width: number, height: number) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y =
        height - ((value - minimum) / (maximum - minimum || 1)) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function getNeighbors(
  node: NormalizedGraphNode,
  nodes: NormalizedGraphNode[],
  edges: GraphEdge[],
): NeighborSummary[] {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const neighbors: NeighborSummary[] = [];

  for (const edge of edges) {
    if (edge.source === node.id && byId.has(edge.target)) {
      const target = byId.get(edge.target)!;
      neighbors.push({
        id: target.id,
        name: target.name,
        color: target.color,
        weight: edge.weight,
      });
    } else if (edge.target === node.id && byId.has(edge.source)) {
      const source = byId.get(edge.source)!;
      neighbors.push({
        id: source.id,
        name: source.name,
        color: source.color,
        weight: edge.weight,
      });
    }
  }

  return neighbors.sort((left, right) => right.weight - left.weight);
}

export default function NodeCard({
  node,
  nodes,
  edges,
  onSelectNode,
}: NodeCardProps) {
  if (!node) {
    return (
      <div className="tg-rail-state">
        <p>Select an artist to inspect its neighborhood.</p>
      </div>
    );
  }

  const allPlays = nodes.reduce((sum, current) => sum + current.playCount, 0);
  const playShare = allPlays === 0 ? 0 : node.playCount / allPlays;
  const neighbors = getNeighbors(node, nodes, edges);
  const topNeighbors = neighbors.slice(0, 6);
  const trend = buildTrend(node.id);
  const trendWidth = 320;
  const trendHeight = 42;
  const peakIndex = trend.indexOf(Math.max(...trend));
  const weeksAgo = trend.length - 1 - peakIndex;
  const sparklinePath = buildPath(trend, trendWidth, trendHeight);

  return (
    <>
      <section
        className="tg-detail-hero"
        style={{ ["--accent" as string]: node.color }}
      >
        <div className="tg-detail-kicker">Now selected - Anchor artist</div>
        <h2>{node.name}</h2>
        <p className="tg-detail-cluster">
          <span>{node.clusterLabel}</span>
          <span className="tg-detail-separator">-</span>
          <span>{(playShare * 100).toFixed(1)}% of all plays</span>
        </p>

        <div className="tg-detail-stats-grid">
          <div className="tg-detail-stat">
            <span>Plays</span>
            <strong>{node.playCount.toLocaleString()}</strong>
          </div>
          <div className="tg-detail-stat">
            <span>Hours</span>
            <strong>
              {node.listeningHours?.toLocaleString() ?? "-"}
              {node.listeningHours ? "h" : ""}
            </strong>
          </div>
          <div className="tg-detail-stat">
            <span>Edges</span>
            <strong>{neighbors.length}</strong>
          </div>
        </div>

        <div className="tg-spark-card">
          <div className="tg-spark-header">
            <span>Last 26 weeks</span>
            <span>
              peak {weeksAgo === 0 ? "this week" : `${weeksAgo}w ago`}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${trendWidth} ${trendHeight}`}
            className="tg-sparkline"
            preserveAspectRatio="none"
          >
            <path d={sparklinePath} />
          </svg>
        </div>
      </section>

      {node.topTracks && node.topTracks.length > 0 ? (
        <section className="tg-rail-section">
          <h3>
            <span>Top tracks</span>
            <button type="button">View all</button>
          </h3>
          <div className="tg-track-list">
            {node.topTracks.map((track, index) => (
              <article
                key={`${node.id}-${track.title}`}
                className="tg-track-row"
              >
                <span className="tg-track-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="tg-track-copy">
                  <strong>{track.title}</strong>
                  <span>{track.subtitle || "Track metadata pending"}</span>
                </div>
                <span className="tg-track-count">
                  {track.playCount?.toLocaleString() ?? "-"}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="tg-rail-section">
        <h3>
          <span>Co-listened with</span>
          <span>{neighbors.length} total</span>
        </h3>
        <div className="tg-neighbor-list">
          {topNeighbors.map((neighbor) => (
            <button
              key={neighbor.id}
              type="button"
              className="tg-neighbor-row"
              onClick={() => onSelectNode(neighbor.id)}
            >
              <span className="tg-neighbor-name">{neighbor.name}</span>
              <span className="tg-neighbor-strength">
                <i
                  style={{
                    width: `${neighbor.weight * 100}%`,
                    backgroundColor: neighbor.color,
                  }}
                />
              </span>
              <span className="tg-neighbor-score">
                {formatPercent(neighbor.weight)}
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
