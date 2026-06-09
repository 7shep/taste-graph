import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Force,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import type {
  GraphEdge,
  LabelMode,
  NormalizedGraphCluster,
  NormalizedGraphNode,
} from "../types/graph";

export interface GraphHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  reheat: () => void;
}

interface GraphProps {
  clusters: NormalizedGraphCluster[];
  edges: GraphEdge[];
  hiddenClusterIds: string[];
  labelMode: LabelMode;
  nodes: NormalizedGraphNode[];
  onSelectNode: (nodeId: string) => void;
  onZoomChange: (percent: number) => void;
  selectedNodeId: string | null;
}

interface GraphSimulationNode extends SimulationNodeDatum, NormalizedGraphNode {
  radius: number;
  hero: boolean;
}

interface GraphSimulationLink extends SimulationLinkDatum<GraphSimulationNode> {
  id: string;
  source: GraphSimulationNode;
  target: GraphSimulationNode;
  weight: number;
  crossCluster: boolean;
}

interface GraphTransform {
  x: number;
  y: number;
  k: number;
}

interface TooltipState {
  left: number;
  top: number;
  node: NormalizedGraphNode;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Radius is scaled relative to the listener's own top artist so real Spotify
// data (small play counts) still produces the 6px–24px spread from the spec.
function radiusForPlayCount(playCount: number, maxPlayCount: number) {
  if (maxPlayCount <= 0) {
    return 6;
  }
  return clamp(6 + 18 * Math.sqrt(playCount / maxPlayCount), 6, 24);
}

function rgbaFromHex(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildClusterAnchors(
  clusters: NormalizedGraphCluster[],
  width: number,
  height: number,
) {
  const map = new Map<string, { x: number; y: number }>();
  if (clusters.length === 0) {
    return map;
  }

  const centerX = width / 2;
  const centerY = height / 2;

  if (clusters.length === 1) {
    map.set(clusters[0].id, { x: centerX, y: centerY });
    return map;
  }

  if (clusters.length === 2) {
    map.set(clusters[0].id, { x: width * 0.34, y: centerY });
    map.set(clusters[1].id, { x: width * 0.66, y: centerY });
    return map;
  }

  const radiusX = width * (clusters.length <= 4 ? 0.25 : 0.29);
  const radiusY = height * (clusters.length <= 4 ? 0.22 : 0.27);

  clusters.forEach((cluster, index) => {
    const angle = -Math.PI / 2 + (index / clusters.length) * Math.PI * 2;
    map.set(cluster.id, {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  });

  return map;
}

function createClusterForce(
  anchors: Map<string, { x: number; y: number }>,
  strength: number,
): Force<GraphSimulationNode, undefined> {
  let nodes: GraphSimulationNode[] = [];

  function force(alpha: number) {
    for (const node of nodes) {
      const anchor = anchors.get(node.clusterId);
      if (!anchor) {
        continue;
      }

      node.vx =
        (node.vx || 0) + (anchor.x - (node.x || anchor.x)) * strength * alpha;
      node.vy =
        (node.vy || 0) + (anchor.y - (node.y || anchor.y)) * strength * alpha;
    }
  }

  force.initialize = (incomingNodes: GraphSimulationNode[]) => {
    nodes = incomingNodes;
  };

  return force;
}

function getGraphCoordinates(
  transform: GraphTransform,
  clientX: number,
  clientY: number,
) {
  return {
    x: (clientX - transform.x) / transform.k,
    y: (clientY - transform.y) / transform.k,
  };
}

function getNeighbors(nodeId: string | null, links: GraphSimulationLink[]) {
  const neighbors = new Set<string>();
  if (!nodeId) {
    return neighbors;
  }

  for (const link of links) {
    if (link.source.id === nodeId) {
      neighbors.add(link.target.id);
    } else if (link.target.id === nodeId) {
      neighbors.add(link.source.id);
    }
  }

  return neighbors;
}

const Graph = forwardRef<GraphHandle, GraphProps>(function Graph(
  {
    clusters,
    edges,
    hiddenClusterIds,
    labelMode,
    nodes,
    onSelectNode,
    onZoomChange,
    selectedNodeId,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<Simulation<
    GraphSimulationNode,
    undefined
  > | null>(null);
  const nodesRef = useRef<GraphSimulationNode[]>([]);
  const linksRef = useRef<GraphSimulationLink[]>([]);
  const transformRef = useRef<GraphTransform>({ x: 0, y: 0, k: 1 });
  const tooltipFrameRef = useRef<number | null>(null);
  const drawSceneRef = useRef<() => void>(() => {});
  const pointerStateRef = useRef<{ nodeId: string | null; moved: boolean }>({
    nodeId: null,
    moved: false,
  });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const hiddenClusterSet = useMemo(
    () => new Set(hiddenClusterIds),
    [hiddenClusterIds],
  );

  const getVisibleNode = useCallback(
    (graphX: number, graphY: number) => {
      for (let index = nodesRef.current.length - 1; index >= 0; index -= 1) {
        const node = nodesRef.current[index];
        if (hiddenClusterSet.has(node.clusterId)) {
          continue;
        }

        const dx = graphX - (node.x || 0);
        const dy = graphY - (node.y || 0);
        if (dx * dx + dy * dy <= node.radius * node.radius) {
          return node;
        }
      }

      return null;
    },
    [hiddenClusterSet],
  );

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (
      !canvas ||
      !container ||
      canvasSize.width === 0 ||
      canvasSize.height === 0
    ) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);

    const transform = transformRef.current;
    const focusedNodeId = selectedNodeId || hoveredNodeId;
    const neighborIds = getNeighbors(focusedNodeId, linksRef.current);

    context.save();
    context.translate(transform.x, transform.y);
    context.scale(transform.k, transform.k);

    for (const link of linksRef.current) {
      if (
        hiddenClusterSet.has(link.source.clusterId) ||
        hiddenClusterSet.has(link.target.clusterId)
      ) {
        continue;
      }

      const isFocused =
        focusedNodeId &&
        (link.source.id === focusedNodeId || link.target.id === focusedNodeId);
      const isDimmed = focusedNodeId && !isFocused;
      const alpha = isDimmed
        ? 0.04
        : isFocused
          ? 0.55 + link.weight * 0.35
          : 0.1 + link.weight * 0.22;
      const width = isDimmed
        ? 0.5
        : isFocused
          ? 1.2 + link.weight * 1.8
          : 0.5 + link.weight * 1.1;
      const gradient = context.createLinearGradient(
        link.source.x || 0,
        link.source.y || 0,
        link.target.x || 0,
        link.target.y || 0,
      );

      gradient.addColorStop(0, rgbaFromHex(link.source.color, alpha));
      gradient.addColorStop(1, rgbaFromHex(link.target.color, alpha));

      context.strokeStyle = gradient;
      context.lineWidth = width;
      context.setLineDash(link.crossCluster && !isDimmed ? [3, 3] : []);
      context.beginPath();
      context.moveTo(link.source.x || 0, link.source.y || 0);
      context.lineTo(link.target.x || 0, link.target.y || 0);
      context.stroke();
    }
    context.setLineDash([]);

    for (const node of nodesRef.current) {
      if (hiddenClusterSet.has(node.clusterId)) {
        continue;
      }

      const isFocused = focusedNodeId === node.id;
      const isNeighbor = focusedNodeId ? neighborIds.has(node.id) : false;
      const shouldDim = focusedNodeId ? !isFocused && !isNeighbor : false;
      const alpha = shouldDim ? 0.22 : 1;

      const x = node.x || 0;
      const y = node.y || 0;
      const glowRadius = node.radius + (isFocused ? 18 : 9);
      const glow = context.createRadialGradient(
        x,
        y,
        node.radius * 0.4,
        x,
        y,
        glowRadius,
      );
      glow.addColorStop(0, rgbaFromHex(node.color, 0.55 * alpha));
      glow.addColorStop(1, rgbaFromHex(node.color, 0));

      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, glowRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = rgbaFromHex(node.color, alpha);
      context.beginPath();
      context.arc(x, y, node.radius, 0, Math.PI * 2);
      context.fill();

      const highlight = context.createRadialGradient(
        x - node.radius * 0.35,
        y - node.radius * 0.45,
        0,
        x,
        y,
        node.radius,
      );
      highlight.addColorStop(0, `rgba(255, 255, 255, ${0.35 * alpha})`);
      highlight.addColorStop(0.6, "rgba(255, 255, 255, 0)");
      context.fillStyle = highlight;
      context.beginPath();
      context.arc(x, y, node.radius, 0, Math.PI * 2);
      context.fill();

      if (isFocused) {
        context.strokeStyle = rgbaFromHex(node.color, 0.85);
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(x, y, node.radius + 6, 0, Math.PI * 2);
        context.stroke();
        // outer faint ring
        context.strokeStyle = rgbaFromHex(node.color, 0.25);
        context.lineWidth = 1;
        context.beginPath();
        context.arc(x, y, node.radius + 12, 0, Math.PI * 2);
        context.stroke();
      }

      const shouldShowLabel =
        labelMode === "all" ? !shouldDim : node.hero || isFocused;

      if (shouldShowLabel) {
        const fontSize = node.hero ? 13 : 11;
        context.font = `${node.hero ? "600" : "500"} ${fontSize}px "DM Sans", system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "top";
        const labelY = y + node.radius + 7;
        const labelWidth = context.measureText(node.name).width;
        context.fillStyle = `rgba(10, 10, 13, ${0.5 * alpha})`;
        context.fillRect(
          x - labelWidth / 2 - 5,
          labelY - 1,
          labelWidth + 10,
          fontSize + 4,
        );
        context.fillStyle = `rgba(244, 237, 227, ${0.95 * alpha})`;
        context.fillText(node.name, x, labelY);
      }
    }

    context.restore();
  }, [
    canvasSize.height,
    canvasSize.width,
    hiddenClusterSet,
    hoveredNodeId,
    labelMode,
    selectedNodeId,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn() {
        const nextScale = clamp(transformRef.current.k * 1.15, 0.65, 2.4);
        const centerX = canvasSize.width / 2;
        const centerY = canvasSize.height / 2;
        transformRef.current.x =
          centerX -
          ((centerX - transformRef.current.x) / transformRef.current.k) *
            nextScale;
        transformRef.current.y =
          centerY -
          ((centerY - transformRef.current.y) / transformRef.current.k) *
            nextScale;
        transformRef.current.k = nextScale;
        onZoomChange(Math.round(nextScale * 100));
        drawScene();
      },
      zoomOut() {
        const nextScale = clamp(transformRef.current.k / 1.15, 0.65, 2.4);
        const centerX = canvasSize.width / 2;
        const centerY = canvasSize.height / 2;
        transformRef.current.x =
          centerX -
          ((centerX - transformRef.current.x) / transformRef.current.k) *
            nextScale;
        transformRef.current.y =
          centerY -
          ((centerY - transformRef.current.y) / transformRef.current.k) *
            nextScale;
        transformRef.current.k = nextScale;
        onZoomChange(Math.round(nextScale * 100));
        drawScene();
      },
      resetZoom() {
        transformRef.current = { x: 0, y: 0, k: 1 };
        onZoomChange(100);
        drawScene();
      },
      reheat() {
        simulationRef.current?.alpha(0.9).restart();
      },
    }),
    [canvasSize.height, canvasSize.width, drawScene, onZoomChange],
  );

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) {
      return;
    }

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;

      canvas.width = Math.max(1, Math.floor(bounds.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(bounds.height * pixelRatio));
      canvas.style.width = `${bounds.width}px`;
      canvas.style.height = `${bounds.height}px`;
      setCanvasSize({ width: bounds.width, height: bounds.height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (canvasSize.width === 0 || canvasSize.height === 0) {
      return;
    }

    simulationRef.current?.stop();

    const anchors = buildClusterAnchors(
      clusters,
      canvasSize.width,
      canvasSize.height,
    );
    const maxPlayCount = nodes.reduce(
      (max, node) => Math.max(max, node.playCount),
      0,
    );
    // Hero artists (relative to the listener's own top artist) render larger
    // with bolder labels, like the four anchors in the design.
    const heroCutoff = maxPlayCount * 0.55;
    const nodeItems: GraphSimulationNode[] = nodes.map((node) => {
      const anchor = anchors.get(node.clusterId) || {
        x: canvasSize.width / 2,
        y: canvasSize.height / 2,
      };
      const seed = hashString(node.id);
      const angle = ((seed % 360) / 180) * Math.PI;
      const distance = 18 + (seed % 70);
      const hero = maxPlayCount > 0 && node.playCount >= heroCutoff;

      return {
        ...node,
        hero,
        radius:
          radiusForPlayCount(node.playCount, maxPlayCount) * (hero ? 1.15 : 1),
        x: node.x ?? anchor.x + Math.cos(angle) * distance,
        y: node.y ?? anchor.y + Math.sin(angle) * distance,
      };
    });

    const nodeById = new Map(nodeItems.map((node) => [node.id, node]));
    const linkItems: GraphSimulationLink[] = [];
    for (const [index, edge] of edges.entries()) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) {
        continue;
      }

      linkItems.push({
        id: `edge-${index}`,
        source,
        target,
        weight: edge.weight,
        crossCluster: source.clusterId !== target.clusterId,
      });
    }

    nodesRef.current = nodeItems;
    linksRef.current = linkItems;

    const simulation = forceSimulation<GraphSimulationNode>(nodeItems)
      .force(
        "link",
        forceLink<GraphSimulationNode, GraphSimulationLink>(linkItems)
          .distance((link: GraphSimulationLink) =>
            link.crossCluster ? 210 : 90 + (1 - link.weight) * 70,
          )
          .strength((link: GraphSimulationLink) =>
            link.crossCluster ? 0.06 : 0.12 + link.weight * 0.14,
          ),
      )
      .force("charge", forceManyBody().strength(-170))
      .force(
        "collide",
        forceCollide<GraphSimulationNode>()
          .radius((node: GraphSimulationNode) => node.radius + 12)
          .strength(0.9),
      )
      .force("center", forceCenter(canvasSize.width / 2, canvasSize.height / 2))
      .force("cluster", createClusterForce(anchors, 0.22))
      .alpha(1)
      .alphaDecay(0.045)
      .on("tick", () => drawSceneRef.current());

    simulationRef.current = simulation;
    drawSceneRef.current();

    return () => {
      simulation.stop();
    };
  }, [canvasSize.height, canvasSize.width, clusters, edges, nodes]);

  // Keep the latest drawScene in a ref so the simulation effect can redraw on
  // tick without depending on drawScene's identity (which changes on hover).
  useEffect(() => {
    drawSceneRef.current = drawScene;
    drawScene();
  }, [drawScene]);

  useEffect(
    () => () => {
      if (tooltipFrameRef.current !== null) {
        cancelAnimationFrame(tooltipFrameRef.current);
      }
    },
    [],
  );

  const updateTooltip = useCallback(
    (node: GraphSimulationNode | null, clientX: number, clientY: number) => {
      if (!node) {
        setTooltip(null);
        return;
      }

      if (tooltipFrameRef.current !== null) {
        cancelAnimationFrame(tooltipFrameRef.current);
      }

      tooltipFrameRef.current = requestAnimationFrame(() => {
        setTooltip({
          left: clientX,
          top: clientY,
          node,
        });
      });
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - bounds.left;
      const localY = event.clientY - bounds.top;
      const graphPoint = getGraphCoordinates(
        transformRef.current,
        localX,
        localY,
      );
      const currentNode = getVisibleNode(graphPoint.x, graphPoint.y);

      const draggedNodeId = pointerStateRef.current.nodeId;
      if (draggedNodeId) {
        pointerStateRef.current.moved = true;
        const draggedNode = nodesRef.current.find(
          (node) => node.id === draggedNodeId,
        );
        if (draggedNode) {
          draggedNode.fx = graphPoint.x;
          draggedNode.fy = graphPoint.y;
          simulationRef.current?.alphaTarget(0.25).restart();
          drawScene();
        }
        return;
      }

      setHoveredNodeId(currentNode?.id || null);
      updateTooltip(currentNode, localX, localY);
    },
    [drawScene, getVisibleNode, updateTooltip],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - bounds.left;
      const localY = event.clientY - bounds.top;
      const graphPoint = getGraphCoordinates(
        transformRef.current,
        localX,
        localY,
      );
      const currentNode = getVisibleNode(graphPoint.x, graphPoint.y);
      pointerStateRef.current = {
        nodeId: currentNode?.id || null,
        moved: false,
      };
      if (currentNode) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [getVisibleNode],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const draggedNodeId = pointerStateRef.current.nodeId;
      if (draggedNodeId) {
        const draggedNode = nodesRef.current.find(
          (node) => node.id === draggedNodeId,
        );
        if (draggedNode) {
          draggedNode.fx = null;
          draggedNode.fy = null;
        }

        if (!pointerStateRef.current.moved) {
          onSelectNode(draggedNodeId);
        }

        simulationRef.current?.alphaTarget(0);
      }

      pointerStateRef.current = { nodeId: null, moved: false };
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onSelectNode],
  );

  const handlePointerLeave = useCallback(() => {
    if (!pointerStateRef.current.nodeId) {
      setHoveredNodeId(null);
      setTooltip(null);
    }
  }, []);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - bounds.left;
      const localY = event.clientY - bounds.top;
      const nextScale = clamp(
        transformRef.current.k * (event.deltaY > 0 ? 0.94 : 1.06),
        0.65,
        2.4,
      );
      const graphPoint = getGraphCoordinates(
        transformRef.current,
        localX,
        localY,
      );

      transformRef.current = {
        x: localX - graphPoint.x * nextScale,
        y: localY - graphPoint.y * nextScale,
        k: nextScale,
      };

      onZoomChange(Math.round(nextScale * 100));
      drawScene();
    },
    [drawScene, onZoomChange],
  );

  return (
    <div className="tg-graph-shell" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="tg-graph-canvas"
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />
      {tooltip ? (
        <div
          className="tg-tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <strong>{tooltip.node.name}</strong>
          <span>
            {tooltip.node.playCount.toLocaleString()} plays ·{" "}
            {tooltip.node.clusterLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
});

export default Graph;
