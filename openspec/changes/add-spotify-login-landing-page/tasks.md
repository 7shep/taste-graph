# Tasks: Add a Spotify Login Landing Page

## Phase 1: Add route structure
- [x] Add frontend routing support for separate pages.
- [x] Route `/` to a new login landing page.
- [x] Route `/graph` to the existing graph experience.
- [x] Confirm direct graph rendering is removed from `App.tsx`.

## Phase 2: Build the auth handoff layer
- [x] Add a typed auth helper in `frontend/src/lib/api.ts`.
- [x] Add `frontend/src/hooks/useSpotifyAuth.ts` to manage login startup state.
- [x] Define the expected backend response contract for starting Spotify OAuth.
- [x] Ensure the frontend never calls Spotify endpoints directly.

## Phase 3: Build the landing page
- [x] Implement `frontend/src/pages/Home.tsx`.
- [x] Render a single primary `Log in with Spotify` CTA.
- [x] Add minimal loading and error states around the button.
- [x] Style the page to match the existing Taste Graph visual language while keeping it intentionally sparse.

## Phase 4: Verification
- [x] Verify `/` shows only the login landing page.
- [x] Verify clicking the button starts the backend-driven auth flow.
- [x] Verify `/graph` still renders the existing graph page.
- [x] Verify auth-start failures leave the user on the landing page with a clear error message.
