import type { NormalizedGraphCluster } from "../types/graph";

interface ClusterLegendProps {
  clusters: NormalizedGraphCluster[];
  hiddenClusterIds: string[];
  onToggleCluster: (clusterId: string) => void;
}

export default function ClusterLegend({
  clusters,
  hiddenClusterIds,
  onToggleCluster,
}: ClusterLegendProps) {
  const hiddenSet = new Set(hiddenClusterIds);

  return (
    <section className="tg-legend-card" aria-label="Cluster legend">
      <h3>Clusters</h3>
      <div className="tg-legend-list">
        {clusters.map((cluster) => {
          const isHidden = hiddenSet.has(cluster.id);
          return (
            <button
              key={cluster.id}
              type="button"
              className={`tg-legend-row ${isHidden ? "is-muted" : ""}`}
              onClick={() => onToggleCluster(cluster.id)}
            >
              <span
                className="tg-legend-swatch"
                style={{ backgroundColor: cluster.color }}
              />
              <span className="tg-legend-label">{cluster.label}</span>
              <span className="tg-legend-count">{cluster.size}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
