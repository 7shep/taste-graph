# Tasks: Build the Taste Graph Frontend Display

## Phase 1: Scaffold the frontend app
- [x] Create the `frontend/` React + TypeScript + Vite application structure described in `PLAN.md`.
- [x] Add base tooling and scripts for local development and formatting.
- [x] Create the initial route/page entry point for the graph experience.

## Phase 2: Define the graph contract
- [x] Add `frontend/src/types/graph.ts` for nodes, edges, clusters, stats, and time range.
- [x] Implement `frontend/src/lib/api.ts` with a typed graph fetch function.
- [x] Implement `frontend/src/hooks/useGraphData.ts` to fetch, normalize, and expose graph state.
- [x] Add temporary fixture support only if required to unblock UI work, and keep it separate from production code paths.

## Phase 3: Build the page shell
- [x] Implement the top bar with brand mark, search, refresh, and share actions.
- [x] Implement the full graph-stage layout and right rail.
- [x] Recreate the background gradients, grain, linework, and panel styling from the design export.
- [x] Add responsive behavior for smaller desktop widths without introducing a mobile redesign.

## Phase 4: Build graph visualization
- [x] Implement `components/Graph.tsx` with all D3 or canvas logic isolated to the component.
- [x] Render nodes, edges, labels, glow states, dashed cross-cluster edges, and zoom behavior.
- [x] Support drag, hover, click-to-select, label density toggle, and re-simulation.
- [x] Derive cluster attractor positions dynamically so the layout works for variable cluster counts.
- [x] Ensure cluster rendering does not depend on hardcoded prototype cluster IDs or artist sets.

## Phase 5: Build supporting UI
- [x] Implement `ClusterLegend.tsx` with dynamic rows and visibility toggles.
- [x] Implement `NodeCard.tsx` for the selected-artist rail.
- [x] Implement `TimeRangeToggle.tsx` for graph time-range selection.
- [x] Show co-listened strengths as percentages.
- [x] Omit the prototype sections and decorations the user explicitly removed.

## Phase 6: States and polish
- [x] Add loading, empty, and error states.
- [x] Handle missing optional node metadata cleanly.
- [x] Verify typography, spacing, and visual hierarchy against the handoff HTML.
- [x] Validate that the layout still works when the payload has fewer or more than four clusters.

## Phase 7: Verification
- [x] Run the frontend locally and verify the graph page renders.
- [x] Check interaction behavior for hover, selection, drag, zoom, legend toggles, and time-range switches.
- [x] Confirm there are no hardcoded production cluster definitions copied from the prototype.
- [x] Confirm component boundaries match `AGENT.md`.
