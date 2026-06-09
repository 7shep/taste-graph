import { useEffect, useMemo, useRef, useState } from "react";
import ClusterLegend from "../components/ClusterLegend";
import Graph, { type GraphHandle } from "../components/Graph";
import NodeCard from "../components/NodeCard";
import ShareBanner from "../components/ShareBanner";
import TimeRangeToggle from "../components/TimeRangeToggle";
import { useGraphData } from "../hooks/useGraphData";
import {
  clearSpotifyAuthSession,
  getSpotifyAuthErrorMessage,
  persistSpotifyAuthSessionFromHash,
  readSpotifyAuthError,
  readSpotifyAuthSession,
} from "../lib/auth";
import type { LabelMode, TimeRange } from "../types/graph";

function BrandMark() {
  return (
    <span className="tg-brand-mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="6" cy="6" r="3.5" fill="#EF8A6B" />
        <circle cx="16" cy="7" r="2.5" fill="#E9BD5A" />
        <circle cx="7" cy="16" r="2.5" fill="#7FD4A8" />
        <circle cx="15.5" cy="15.5" r="3" fill="#9AA9EE" />
        <path
          d="M6 6 L16 7 M6 6 L7 16 M16 7 L15.5 15.5 M7 16 L15.5 15.5"
          stroke="#F4EDE3"
          strokeOpacity="0.35"
          strokeWidth="0.8"
        />
      </svg>
    </span>
  );
}

function EmptyStage({ message }: { message: string }) {
  return (
    <div className="tg-stage-state">
      <p>{message}</p>
    </div>
  );
}

export default function GraphPage() {
  const graphRef = useRef<GraphHandle | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("medium_term");
  const [labelMode, setLabelMode] = useState<LabelMode>("all");
  const [hiddenClusterIds, setHiddenClusterIds] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    Boolean(
      readSpotifyAuthSession() ||
      (import.meta.env.VITE_SPOTIFY_ACCESS_TOKEN?.trim() &&
        import.meta.env.VITE_SPOTIFY_USER_ID?.trim()),
    ),
  );
  const { data, error, refresh, status } = useGraphData(
    timeRange,
    authReady && isAuthenticated && !authError,
  );

  useEffect(() => {
    const hashError = readSpotifyAuthError(window.location.hash);
    const hashErrorMessage = getSpotifyAuthErrorMessage(hashError);
    const sessionFromHash = persistSpotifyAuthSessionFromHash(
      window.location.hash,
    );
    const storedSession = readSpotifyAuthSession();

    if (window.location.hash) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (hashErrorMessage) {
      setAuthError(hashErrorMessage);
      setIsAuthenticated(false);
      setAuthReady(true);
      return;
    }

    setIsAuthenticated(
      Boolean(
        sessionFromHash ||
        storedSession ||
        (import.meta.env.VITE_SPOTIFY_ACCESS_TOKEN?.trim() &&
          import.meta.env.VITE_SPOTIFY_USER_ID?.trim()),
      ),
    );
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }

    if (
      !selectedNodeId ||
      !data.nodes.some((node) => node.id === selectedNodeId)
    ) {
      setSelectedNodeId(data.nodes[0].id);
    }
  }, [data, selectedNodeId]);

  const selectedNode = useMemo(
    () => data?.nodes.find((node) => node.id === selectedNodeId) || null,
    [data, selectedNodeId],
  );

  const filteredMatch = useMemo(() => {
    if (!data || !searchValue.trim()) {
      return null;
    }

    const normalizedQuery = searchValue.trim().toLowerCase();
    return (
      data.nodes.find((node) =>
        node.name.toLowerCase().includes(normalizedQuery),
      ) ||
      data.nodes.find((node) =>
        node.clusterLabel.toLowerCase().includes(normalizedQuery),
      ) ||
      null
    );
  }, [data, searchValue]);

  const handleSearchSubmit = () => {
    if (filteredMatch) {
      setSelectedNodeId(filteredMatch.id);
      setHiddenClusterIds([]);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Taste Graph", url });
        return;
      } catch {
        return;
      }
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    }
  };

  // Only offer logout for a real stored session; the env-token dev fallback
  // cannot be cleared from the UI.
  const hasStoredSession = useMemo(
    () => authReady && isAuthenticated && readSpotifyAuthSession() !== null,
    [authReady, isAuthenticated],
  );

  const handleLogout = () => {
    clearSpotifyAuthSession();
    window.location.assign("/");
  };

  const toggleCluster = (clusterId: string) => {
    setHiddenClusterIds((current) =>
      current.includes(clusterId)
        ? current.filter((value) => value !== clusterId)
        : [...current, clusterId],
    );
  };

  return (
    <div className="tg-app">
      <header className="tg-topbar">
        <div className="tg-brand">
          <BrandMark />
          <span className="tg-brand-name">
            Taste<em>Graph</em>
          </span>
          <span className="tg-brand-version">v0.1</span>
        </div>

        <label className="tg-search">
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="6" cy="6" r="4.5" />
            <path d="m9.5 9.5 3 3" />
          </svg>
          <input
            placeholder="Search the graph…"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSearchSubmit();
              }
            }}
          />
        </label>

        <button
          type="button"
          className="tg-icon-button"
          title="Refresh from Spotify"
          onClick={refresh}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M12 7a5 5 0 1 1-1.5-3.5" />
            <path d="M12 2v3h-3" />
          </svg>
        </button>
        <ShareBanner onShare={() => void handleShare()} />
        {hasStoredSession ? (
          <button
            type="button"
            className="tg-icon-button"
            title="Log out"
            aria-label="Log out"
            onClick={handleLogout}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M5.5 12H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2.5" />
              <path d="m9.5 4.5 2.5 2.5-2.5 2.5" />
              <path d="M12 7H5.5" />
            </svg>
          </button>
        ) : null}
      </header>

      <main className="tg-layout">
        <section className="tg-stage">
          <div className="tg-stats-card" aria-label="Graph stats">
            <div>
              <span>Artists</span>
              <strong>{data?.stats.artists ?? "-"}</strong>
            </div>
            <div>
              <span>Connections</span>
              <strong>{data?.stats.edges ?? "-"}</strong>
            </div>
            <div>
              <span>Neighborhoods</span>
              <strong>{data?.stats.clusters ?? "-"}</strong>
            </div>
          </div>

          {authReady && !isAuthenticated ? (
            <EmptyStage
              message={
                authError || "Log in with Spotify to open your dashboard."
              }
            />
          ) : null}
          {status === "error" ? (
            <EmptyStage message={error || "Unable to load graph data."} />
          ) : null}
          {authReady && status === "loading" ? (
            <EmptyStage message="Loading your taste graph..." />
          ) : null}
          {status === "success" && data && data.nodes.length === 0 ? (
            <EmptyStage message="Your listening graph is empty. Generate a graph to see artists and clusters." />
          ) : null}

          {status === "success" && data && data.nodes.length > 0 ? (
            <>
              <Graph
                ref={graphRef}
                clusters={data.clusters}
                edges={data.edges}
                hiddenClusterIds={hiddenClusterIds}
                labelMode={labelMode}
                nodes={data.nodes}
                onSelectNode={setSelectedNodeId}
                onZoomChange={setZoomPercent}
                selectedNodeId={selectedNodeId}
              />

              <div className="tg-stage-controls">
                <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
                <div className="tg-control-group">
                  <button
                    type="button"
                    className="tg-control-button"
                    onClick={() => graphRef.current?.reheat()}
                  >
                    Re-simulate
                  </button>
                  <span className="tg-control-divider" />
                  <button
                    type="button"
                    className="tg-control-button"
                    onClick={() => graphRef.current?.zoomOut()}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="tg-control-button"
                    onClick={() => graphRef.current?.resetZoom()}
                  >
                    {zoomPercent}%
                  </button>
                  <button
                    type="button"
                    className="tg-control-button"
                    onClick={() => graphRef.current?.zoomIn()}
                  >
                    +
                  </button>
                  <span className="tg-control-divider" />
                  <button
                    type="button"
                    className={`tg-control-button ${labelMode === "focus" ? "is-active" : ""}`}
                    onClick={() =>
                      setLabelMode((current) =>
                        current === "all" ? "focus" : "all",
                      )
                    }
                  >
                    Labels
                  </button>
                </div>
              </div>

              <div className="tg-stage-legend">
                <ClusterLegend
                  clusters={data.clusters}
                  hiddenClusterIds={hiddenClusterIds}
                  onToggleCluster={toggleCluster}
                />
              </div>
            </>
          ) : null}
        </section>

        <aside className="tg-rail">
          {status === "success" && data ? (
            <NodeCard
              node={selectedNode}
              nodes={data.nodes}
              edges={data.edges}
              onSelectNode={setSelectedNodeId}
            />
          ) : (
            <div className="tg-rail-state">
              <p>
                Artist details will appear here once the graph is available.
              </p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
