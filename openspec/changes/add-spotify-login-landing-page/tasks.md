# Tasks: Add a Spotify Login Landing Page

## Phase 1: Add route structure
- [ ] Add frontend routing support for separate pages.
- [ ] Route `/` to a new login landing page.
- [ ] Route `/graph` to the existing graph experience.
- [ ] Confirm direct graph rendering is removed from `App.tsx`.

## Phase 2: Build the auth handoff layer
- [ ] Add a typed auth helper in `frontend/src/lib/api.ts`.
- [ ] Add `frontend/src/hooks/useSpotifyAuth.ts` to manage login startup state.
- [ ] Define the expected backend response contract for starting Spotify OAuth.
- [ ] Ensure the frontend never calls Spotify endpoints directly.

## Phase 3: Build the landing page
- [ ] Implement `frontend/src/pages/Home.tsx`.
- [ ] Render a single primary `Log in with Spotify` CTA.
- [ ] Add minimal loading and error states around the button.
- [ ] Style the page to match the existing Taste Graph visual language while keeping it intentionally sparse.

## Phase 4: Verification
- [ ] Verify `/` shows only the login landing page.
- [ ] Verify clicking the button starts the backend-driven auth flow.
- [ ] Verify `/graph` still renders the existing graph page.
- [ ] Verify auth-start failures leave the user on the landing page with a clear error message.
