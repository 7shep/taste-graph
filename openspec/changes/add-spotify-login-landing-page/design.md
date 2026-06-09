# Design: Add a Spotify Login Landing Page

## Overview
This change introduces a dedicated auth-first entry route to the React frontend. The user lands on a minimal branded page with one action, `Log in with Spotify`, and that action starts Spotify OAuth through the backend API boundary.

The design keeps responsibilities clean:
- frontend handles route selection, button state, and redirect initiation
- `lib/api.ts` owns the auth handoff call shape
- backend auth routes remain the only layer that communicates with Spotify

## Source-of-Truth Constraints
- Follow `AGENT.md` guidance that Spotify API access must go through backend services rather than frontend direct calls.
- Preserve the existing graph experience as a separate page instead of mixing login UI into `Graph.tsx`.
- Keep the landing page intentionally minimal because the user asked for a separate page where the only thing is a Spotify login button.

## Proposed File Changes

### New files
- `frontend/src/pages/Home.tsx`
- `frontend/src/hooks/useSpotifyAuth.ts`

### Updated files
- `frontend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/index.css`

## Routing Approach
The current app renders `GraphPage` directly from `App.tsx`, so a separate page needs an explicit route boundary.

Recommended approach:
1. Add `react-router-dom`.
2. Route `/` to `Home.tsx`.
3. Route `/graph` to the existing `Graph.tsx`.

This is the smallest clean change that creates a real separate page without introducing ad hoc pathname checks.

## Auth Flow Contract
The frontend should not construct Spotify OAuth URLs itself. It should start auth through the API layer.

Preferred contract:
- `lib/api.ts` exports `getSpotifyLoginUrl()` or `startSpotifyLogin()`
- the function calls the backend auth endpoint
- the backend either:
  - returns a JSON payload with a `url` field, and the frontend redirects with `window.location.assign(url)`, or
  - responds from a known redirect endpoint that the frontend navigates to directly

Preferred frontend implementation detail:
- use a small `useSpotifyAuth.ts` hook to centralize:
  - pending state
  - error state
  - redirect initiation

## UI Structure

### `pages/Home.tsx`
- Full-viewport layout
- Brand treatment centered or near-centered
- Single CTA button labeled `Log in with Spotify`
- Optional compact error text below the button if auth startup fails
- No search, graph, stats, rail, or secondary actions

### Visual direction
- Reuse the existing dark editorial background language from the graph page
- Keep the page sparse, with visual focus on the CTA
- Use Spotify green on the button, with the rest of the palette staying aligned with Taste Graph

## Component and Hook Responsibilities

### `App.tsx`
- Register routes
- Keep routing concerns out of page components

### `pages/Home.tsx`
- Render the landing page
- Call `useSpotifyAuth`
- Disable the button while auth startup is in progress

### `hooks/useSpotifyAuth.ts`
- Expose `beginLogin`, `isLoading`, and `error`
- Call the API helper
- Perform the redirect handoff

### `lib/api.ts`
- Define the frontend-facing auth endpoint helper
- Keep endpoint URLs and response parsing out of UI components

## Failure Handling
- If the auth request fails, keep the user on the landing page and show a concise error message.
- If the backend response is missing a usable URL, treat it as an error instead of attempting a partial redirect.
- Keep retry behavior simple: the user can click the button again.

## Environment and Integration Notes
- Expect a frontend API base URL to remain configurable through environment variables already planned in `PLAN.md`.
- The eventual backend auth route should own Spotify client ID usage, PKCE, state, and redirect URI handling.
- The frontend should not store Spotify secrets or perform token exchange.

## Testing Strategy
- Manually verify `/` renders only the login landing page.
- Manually verify `/graph` still renders the existing graph experience.
- Verify the login button enters a loading state and calls the API helper.
- Verify failed auth startup shows a user-visible error.
- Verify successful auth startup redirects the browser to the backend-provided Spotify login URL.

## Implementation Notes for `/opsx:apply`
- Add routing before building the page so the graph screen does not remain the default app entry.
- Keep the landing page deliberately narrow in scope; avoid turning it into a marketing homepage.
- If the backend auth endpoint does not exist yet, implement the frontend contract with a clearly isolated placeholder or environment-gated fallback and document the missing backend dependency.
