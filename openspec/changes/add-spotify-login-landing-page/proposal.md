# Proposal: Add a Spotify Login Landing Page

## Summary
Add a dedicated pre-auth landing page to the frontend with a single primary action: `Log in with Spotify`. This page should become the app entry point for unauthenticated users and should initiate Spotify sign-in through the backend auth API rather than talking to Spotify directly from the browser.

The current frontend opens directly into the graph experience. This change introduces the missing auth entry surface described in `PLAN.md` so the graph page can remain the logged-in destination while the home route focuses exclusively on getting the user into the Spotify OAuth flow.

## Why
- The product needs a clear first screen for new users instead of dropping them into an app shell that assumes graph data already exists.
- `PLAN.md` already defines a `Home.tsx` auth page and Spotify OAuth as a core system dependency, but the current implementation has no route or UI for that flow.
- `AGENT.md` requires Spotify access to go through backend services, so the frontend needs a button that hands control to the API-owned OAuth flow rather than embedding Spotify auth logic client-side.
- A minimal landing page keeps scope tight while unblocking later work on token handling, graph generation, and share flows.

## Design Inputs Used
- Local `AGENT.md`
- Local `PLAN.md`
- Current frontend entrypoint in `frontend/src/App.tsx`
- Current graph page in `frontend/src/pages/Graph.tsx`

## Scope

### In Scope
- Add a dedicated landing page route for unauthenticated entry.
- Render a minimal screen whose only interactive element is a `Log in with Spotify` button.
- Initiate login through the app API layer, with the browser redirected into the backend-managed Spotify OAuth flow.
- Separate the landing route from the logged-in graph route so the graph page remains focused on authenticated usage.
- Add loading and error handling around the login handoff.
- Keep the landing page visually consistent with the existing Taste Graph brand language while remaining intentionally sparse.

### Out of Scope
- Implementing the full backend OAuth stack if the backend is not yet present.
- Token persistence, refresh, and session restoration beyond the frontend integration point.
- Graph generation or post-login onboarding.
- Share-page CTA work.
- Additional marketing copy, product explainer sections, or multi-step onboarding.

## Success Criteria
- The frontend has a dedicated landing page separate from the graph page.
- The landing page contains a single clear Spotify login CTA.
- Clicking the CTA triggers the backend auth API flow rather than calling Spotify endpoints directly from frontend code.
- The graph experience is reachable as a separate page intended for authenticated users.
- Error states are explicit if the auth handoff cannot be started.

## Risks
- The backend auth endpoint shape is not yet implemented in this repo, so the frontend must define a contract that can be honored later.
- Introducing a separate page likely requires routing support that the current frontend does not yet use.
- Redirect-based auth flows are sensitive to environment configuration such as API base URLs and redirect URIs.

## Open Questions
- Should the backend expose a direct redirect endpoint such as `/api/auth/spotify/login`, or return a login URL from a JSON endpoint first?
- After auth completes, should the default return target be `/graph` or a future generation/loading route?
