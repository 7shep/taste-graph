# Proposal: Build the Taste Graph Frontend Display

## Summary
Create the first production frontend slice of Taste Graph: a desktop-first React + TypeScript graph experience that reproduces the approved Anthropic handoff design while remaining fully data-driven. The implementation should translate the exported `Taste Graph.html` visual language into reusable app code, but it must not hardcode cluster definitions, artist nodes, or sidebar content from the prototype. Instead, the UI should render from API-backed graph data and be ready to connect to the backend graph-generation pipeline described in `PLAN.md`.

## Why
The current repository has planning docs but no application code. Starting with the frontend display gives the project a concrete surface area for the rest of the stack:

- It establishes the visual system and interaction model the backend must support.
- It forces an explicit graph JSON contract early, reducing rework later.
- It turns the design export into maintainable React code instead of leaving it as an isolated HTML prototype.
- It preserves an important product constraint from the user: do not hardcode clusters from the design prototype.

## Design Inputs Used
- Anthropic handoff `README.md`
- Anthropic chat transcript `chat1.md`
- Anthropic exported `Taste Graph.html`
- Anthropic exported `app.js`
- Local `AGENT.md`
- Local `PLAN.md`

## Scope

### In Scope
- Create the frontend app shell for the graph experience.
- Recreate the approved visual layout from the design export:
  - brand mark and top bar
  - search input
  - refresh and share controls
  - full-bleed graph stage
  - top-right stats overlay
  - bottom-left graph controls
  - bottom-right cluster legend
  - right-rail selected artist details
- Translate the design into React + TypeScript components aligned with the planned repo structure.
- Make graph rendering data-driven from a typed graph response model.
- Support dynamic cluster rendering from API data, including legend rows, node colors, and right-rail metadata.
- Preserve approved design revisions from the handoff chat:
  - no hero marketing copy overlay
  - no account/avatar UI
  - no beta label
  - no extra navbar links
  - no command hint in search
  - no light/dark toggle
  - no "From your patterns" section
  - no glowing rail indicators
  - co-listened scores shown as percentages
- Define a reasonable empty/loading/error behavior for when graph data is unavailable.
- Ensure the layout remains usable on smaller desktop and tablet widths without flattening the design language.

### Out of Scope
- Spotify OAuth implementation
- Backend graph generation
- Supabase persistence
- Cluster-label generation via Anthropic
- Share-page backend behavior
- Mobile-native redesign
- Final performance tuning on production-scale graphs

## Success Criteria
- The frontend can render a graph page from a typed JSON payload without prototype constants.
- Cluster count, labels, colors, nodes, edges, stats, and rail content all derive from data.
- The visual result matches the approved handoff closely enough to use as the product baseline.
- The structure aligns with the repo rules in `AGENT.md` and `PLAN.md`, especially:
  - D3 isolated to `components/Graph.tsx`
  - API access isolated to `lib/api.ts`
  - graph state centralized in `useGraphData.ts`

## Risks
- The design prototype uses canvas physics with hardcoded sample content; production data may have many more nodes and different topology.
- The prototype assumes a four-cluster editorial composition, but real clustering is variable and must not break the layout.
- Right-rail content in the prototype is richer than the baseline graph JSON currently described in `PLAN.md`, so the frontend contract must be normalized carefully.

## Open Questions
- Should the first implementation target the logged-in graph page only, or include the read-only share page shell at the same time?
- Should search be interactive in the first slice, or ship as presentational UI until graph-state search is implemented?
- What fallback should appear if a graph payload contains unlabeled or uncategorized nodes?
