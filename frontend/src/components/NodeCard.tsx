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

const MOOD_POOLS = [
  ["🌃 late nights", "🚶 walks", "🎧 headphones on"],
  ["☕ mornings", "🚗 long drives", "📝 writing"],
  ["🌅 golden hour", "🔥 the gym", "🎯 focus"],
  ["🌙 after midnight", "🌧️ rainy days", "💫 feels"],
] as const;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

// Playful header chip copy, relative to the listener's own top artist.
function rotationLabel(playCount: number, maxPlayCount: number) {
  const share = maxPlayCount === 0 ? 0 : playCount / maxPlayCount;
  if (share >= 0.66) {
    return { label: "on heavy rotation", glyph: "♪" };
  }
  if (share >= 0.4) {
    return { label: "a regular favorite", glyph: "♪" };
  }
  if (share >= 0.15) {
    return { label: "in steady rotation", glyph: "·" };
  }
  return { label: "a quiet pick", glyph: "·" };
}

// Pseudo-random but stable 26-week trend, seeded per artist (decorative,
// mirrors the design prototype until real weekly data exists).
function buildTrend(seedValue: string, peak: number) {
  let seed = hashString(seedValue) % 233280;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const points: number[] = [];
  const length = 26;
  for (let index = 0; index < length; index += 1) {
    const x = index / (length - 1);
    const bell = Math.exp(-(((x - peak) * 2.4) ** 2));
    const noise = (random() - 0.5) * 0.3;
    points.push(Math.max(0.05, 0.25 + bell + noise));
  }

  return points;
}

function buildSparkGeometry(values: number[], width: number, height: number) {
  const pad = 4;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const xs = values.map(
    (_, index) => pad + (index / (values.length - 1)) * (width - pad * 2),
  );
  const ys = values.map(
    (value) =>
      pad +
      (1 - (value - minimum) / (maximum - minimum || 1)) * (height - pad * 2),
  );
  const line = xs
    .map(
      (x, index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${ys[index].toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L ${xs[xs.length - 1].toFixed(1)} ${height} L ${xs[0].toFixed(1)} ${height} Z`;

  return {
    line,
    area,
    endX: xs[xs.length - 1],
    endY: ys[ys.length - 1],
  };
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
  const maxPlays = nodes.reduce(
    (max, current) => Math.max(max, current.playCount),
    0,
  );
  const playShare = allPlays === 0 ? 0 : node.playCount / allPlays;
  const rankSignal = Math.max(
    1,
    Math.round((node.playCount / (maxPlays || 1)) * 100),
  );
  const neighbors = getNeighbors(node, nodes, edges);
  const topNeighbors = neighbors.slice(0, 6);

  const eyebrow = rotationLabel(node.playCount, maxPlays);
  const isHero = maxPlays > 0 && node.playCount / maxPlays >= 0.4;

  const seed = hashString(node.id);
  const moodPool = MOOD_POOLS[hashString(node.clusterId) % MOOD_POOLS.length];
  const moods = moodPool.slice(0, isHero ? 3 : 2);
  const sinceMonth = MONTHS[seed % 12];
  const sinceYear = node.playCount / (maxPlays || 1) >= 0.5 ? "’25" : "’26";

  const trend = buildTrend(node.id, isHero ? 0.7 : 0.5);
  const trendWidth = 308;
  const trendHeight = 42;
  const peakIndex = trend.indexOf(Math.max(...trend));
  const weeksAgo = trend.length - 1 - peakIndex;
  const spark = buildSparkGeometry(trend, trendWidth, trendHeight);
  const gradientId = `tg-spark-${seed % 9973}`;

  return (
    <>
      <section
        className="tg-detail-hero"
        style={{ ["--accent" as string]: node.color }}
      >
        <div className="tg-corner-glyph">♪</div>
        <div className="tg-detail-eye">
          <span className="tg-eye-glyph">{eyebrow.glyph}</span>
          {eyebrow.label}
        </div>
        <h2 className="tg-detail-name">{node.name}</h2>
        <div className="tg-detail-cluster">
          <span className="tg-chip">
            <span className="tg-chip-dot" />
            {node.clusterLabel}
          </span>
          <span className="tg-chip is-mono">
            {(playShare * 100).toFixed(1)}% of graph score
          </span>
        </div>

        <div className="tg-moods">
          {moods.map((mood) => (
            <span key={mood} className="tg-mood">
              {mood}
            </span>
          ))}
        </div>

        <div className="tg-detail-bars">
          <div className="tg-bar-stat">
            <span>Score</span>
            <strong>{node.playCount.toLocaleString()}</strong>
          </div>
          <div className="tg-bar-stat">
            <span>Signal</span>
            <strong>
              {rankSignal.toLocaleString()}
              <em>%</em>
            </strong>
          </div>
          <div className="tg-bar-stat">
            <span>Friends</span>
            <strong>{neighbors.length}</strong>
          </div>
        </div>

        <div className="tg-sparkbox">
          <div className="tg-sparkbox-h">
            <span className="l">
              In rotation since {sinceMonth} {sinceYear}
            </span>
            <span className="r">
              peak {weeksAgo === 0 ? "this week" : `${weeksAgo} wks ago`}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${trendWidth} ${trendHeight}`}
            className="tg-sparkline"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={node.color} stopOpacity="0.32" />
                <stop offset="100%" stopColor={node.color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={spark.area} fill={`url(#${gradientId})`} />
            <path
              d={spark.line}
              fill="none"
              stroke={node.color}
              strokeWidth="1.4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle cx={spark.endX} cy={spark.endY} r="2.5" fill={node.color} />
          </svg>
        </div>
      </section>

      {node.topTracks && node.topTracks.length > 0 ? (
        <section
          className="tg-rail-section"
          style={{ ["--accent" as string]: node.color }}
        >
          <h3>
            <span className="tg-h3-label">
              Top tracks
              <span className="tg-squiggle" />
            </span>
            <span>ranked by Spotify</span>
          </h3>
          <div className="tg-track-list">
            {node.topTracks.map((track, index) => (
              <article
                key={`${node.id}-${track.title}`}
                className="tg-track-row"
              >
                <span className="tg-track-index">{index + 1}</span>
                <div className="tg-track-copy">
                  <strong>{track.title}</strong>
                  <span>{track.subtitle || "Single"}</span>
                </div>
                <span className="tg-track-count">
                  {track.playCount?.toLocaleString() ?? "—"}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="tg-rail-section">
        <h3>
          <span className="tg-h3-label">
            Often plays alongside
            <span className="tg-squiggle" />
          </span>
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
                    width: `${Math.round(neighbor.weight * 100)}%`,
                    backgroundColor: neighbor.color,
                  }}
                />
              </span>
              <span className="tg-neighbor-score">
                {Math.round(neighbor.weight * 100)}%
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="tg-rail-foot">made from your listening</div>
    </>
  );
}
