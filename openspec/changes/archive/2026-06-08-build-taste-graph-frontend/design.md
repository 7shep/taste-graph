# Design: Build the Taste Graph Frontend Display

## Overview
This change converts the approved Anthropic prototype into a real frontend foundation using React + TypeScript. The resulting implementation will preserve the editorial dark dashboard aesthetic while replacing prototype constants with typed graph data from the future FastAPI backend.

The exported prototype is treated as a visual reference, not a source of truth for data or architecture. The implementation should borrow layout, styling, spacing, typography, motion, and interaction patterns from the handoff, but all graph content must come from application state.

## Source-of-Truth Constraints
- Follow the frontend boundaries in `AGENT.md`:
  - D3 only in `frontend/src/components/Graph.tsx`
  - API requests only in `frontend/src/lib/api.ts`
  - graph state only in `frontend/src/hooks/useGraphData.ts`
- Do not hardcode cluster membership, cluster labels, node positions, top tracks, or co-listened relationships from the exported prototype.
- Keep the visual simplifications requested in the chat transcript:
  - no title copy overlay on the graph
  - no account avatar
  - no extra nav items
  - no beta treatment
  - no command hint in search
  - no rail pulse lights or cluster dot
  - no "From your patterns" section

## Proposed File Layout

### New frontend scaffold
- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/vite.config.ts`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/index.css`

### Core graph experience
- `frontend/src/pages/Graph.tsx`
- `frontend/src/components/Graph.tsx`
- `frontend/src/components/ClusterLegend.tsx`
- `frontend/src/components/NodeCard.tsx`
- `frontend/src/components/TimeRangeToggle.tsx`
- `frontend/src/components/ShareBanner.tsx`
- `frontend/src/hooks/useGraphData.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/types/graph.ts`

## Data Contract
The UI should consume a graph response compatible with the shape described in `PLAN.md`, expanded slightly for the selected-artist rail.

```ts
type GraphNode = {
  id: string;
  name: string;
  imageUrl?: string | null;
  playCount: number;
  listeningHours?: number | null;
  clusterId: string;
  clusterLabel: string;
  x?: number | null;
  y?: number | null;
  topTracks?: Array<{
    title: string;
    subtitle?: string | null;
    playCount?: number | null;
  }>;
};

type GraphEdge = {
  source: string;
  target: string;
  weight: number;
};

type GraphCluster = {
  id: string;
  label: string;
  color?: string | null;
  size: number;
};

type GraphStats = {
  artists: number;
  edges: number;
  clusters: number;
};

type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  stats?: GraphStats;
};
```

### Notes
- `color` is optional because the frontend may need to assign palette entries when the backend does not provide one.
- The frontend should treat cluster IDs as dynamic values, not a fixed enum from the prototype.
- If backend positions are absent, D3 force simulation should compute them client-side.

## Component Responsibilities

### `pages/Graph.tsx`
- Own the page shell.
- Call `useGraphData`.
- Coordinate selected node, active cluster filters, and time-range selection.
- Render loading, empty, and error states.

### `components/Graph.tsx`
- Own all D3/canvas graph rendering and graph interactions.
- Render nodes, edges, labels, hover states, cluster dimming, drag behavior, and zoom.
- Accept typed nodes/edges/clusters and callbacks instead of reading data directly.
- Prefer canvas rendering for nodes and edges, matching the prototype performance profile.

### `components/ClusterLegend.tsx`
- Render dynamic cluster rows from `clusters`.
- Toggle cluster visibility/highlight state.
- Show derived counts from data.

### `components/NodeCard.tsx`
- Render the right rail selected-artist panel.
- Display selected artist summary, stats, sparkline, top tracks, and co-listened artists.
- Show co-listened values as percentages.
- Avoid prototype-only decorative indicators that the user asked removed.

### `components/TimeRangeToggle.tsx`
- Render the bottom-left range selector.
- Drive `short_term`, `medium_term`, `long_term`, or app-specific aliases mapped in `useGraphData`.

### `hooks/useGraphData.ts`
- Fetch graph data through `lib/api.ts`.
- Normalize payload shape.
- Compute derived stats when the backend does not provide them.
- Expose loading, error, and refresh actions.

### `lib/api.ts`
- Export the graph fetch client.
- Hide `fetch` details from components.

## Visual Translation Plan

### Layout
- Use a two-column shell with a fixed-height top bar and right rail.
- Preserve the dark ink palette, serif logotype treatment, mono data labels, and glassy overlay panels.
- Recreate the subtle vignette, grain, and cluster glow, but implement them through maintainable CSS rather than raw prototype structure.

### Graph Stage
- Keep the graph as the visual focus.
- Maintain concentric guide rings and restrained background gradients.
- Use node glow, weighted edges, dashed cross-cluster links, and cluster-aware labeling.
- Replace hardcoded quadrant anchors with data-derived or evenly distributed cluster attractor centers.

### Right Rail
- Keep the selected-artist presentation from the prototype:
  - artist name
  - cluster label
  - plays, hours, edge count
  - recent listening sparkline
  - top tracks
  - co-listened artists
- Make sections conditional when data is missing.

### Controls
- Keep search, refresh, share, time range, zoom, relayout, and label toggles visible.
- Allow nonessential controls to degrade gracefully if functionality is deferred.

## Dynamic Cluster Strategy
The prototype uses four named clusters with custom positions. Production cannot assume that.

Implementation approach:
1. Accept any number of clusters from the payload.
2. Assign colors from the accessible palette described in `AGENT.md` when colors are missing.
3. Derive cluster attractor points algorithmically.
4. Render legend rows from the cluster array.
5. Drive sidebar labels from the selected node plus cluster lookup.

### Cluster Placement
- For 1 cluster: center it.
- For 2 to 4 clusters: distribute around a circle or rounded grid.
- For more than 4 clusters: distribute evenly around a ring with a slightly inward pull to avoid edge collisions.
- Keep the "Uncategorized" cluster visually distinct if `clusterId` or label indicates noise.

## Interaction Model
- Hover node: show tooltip and emphasize its neighborhood.
- Click node: lock selection into the right rail.
- Drag node: reposition it within the simulation.
- Zoom controls: update graph scale.
- Re-simulate: reheat the simulation.
- Toggle labels: switch between reduced and expanded label density.
- Toggle cluster visibility from the legend.

## Empty, Loading, and Error States
- Loading: keep shell visible with muted placeholders.
- Empty: show a graph-stage message explaining that listening data is not ready yet.
- Error: show structured retry messaging consistent with the backend error format defined in `AGENT.md`.

## Testing Strategy
- Unit test payload normalization in `useGraphData.ts`.
- Component test the right rail with sparse and full node data.
- Manual browser QA for:
  - desktop layout fidelity
  - smaller laptop widths
  - dynamic cluster counts
  - long artist names
  - no-data and error states

## Implementation Notes for `/opsx:apply`
- Start by scaffolding the frontend app because the repo is currently empty.
- Use the Anthropic export as a visual reference only.
- If mock data is needed during development, isolate it to a local fixture file and remove it or clearly gate it before finalizing.
- Do not ship any production code that embeds the prototype's fixed cluster map as the app's live data model.
