# CHANGELOG

## Unreleased

## 0.1.33 - 2026-03-16

### Changed
- Version bump to test update dialog layering above fixture detail dialog.

## 0.1.32 - 2026-03-16

### Fixed
- Block Escape key on the update dialog (`cancel` event preventDefault) so operators
  cannot accidentally dismiss it without choosing Update Now or Later.

## 0.1.31 - 2026-03-16

### Fixed
- Update dialog now always appears above the fixture detail dialog.
  Replaced PrimeNG `p-dialog` with native `<dialog showModal()>` so the update
  dialog enters the browser top layer and wins regardless of z-index.
  Side effect: removes PrimeNG DialogModule + ButtonModule from AppComponent (~35 kB bundle saving).

## 0.1.30 - 2026-03-16

### Changed
- Version bump to test update dialog z-index fix.

## 0.1.29 - 2026-03-16

### Changed
- Version bump to test full PWA update dialog cycle.

## 0.1.28 - 2026-03-16

### Fixed
- Update dialog now appears above fixture dialogs (added `baseZIndex: 10000`).

## 0.1.27 - 2026-03-16

### Changed
- Header "update available" badge now shows the new version number (e.g. "↑ update available v0.1.27").

## 0.1.26 - 2026-03-16

### Changed
- Version bump to test the PWA update-available dialog behaviour.

## 0.1.25 - 2026-03-16

### Changed
- Version bump and deploy refresh for the coordinated firmware/frontend `2.22.32` release cycle.

## 0.1.24 - 2026-03-16

### Added
- Update dialog now shows the new version number (e.g. "BAUKLANK Studio v0.1.24 is ready").
- Deploy script writes `appData.version` into `ngsw-config.json` before each build so the version is available in `VersionReadyEvent.latestVersion.appData`.

## 0.1.23 - 2026-03-16

### Changed
- Update dialog grace period reduced to 2 min for testing (was 10 min).

## 0.1.22 - 2026-03-16

### Changed
- Version bump to test update-available dialog end-to-end.

## 0.1.21 - 2026-03-16

### Added
- Update-available dialog (PrimeNG): when a new version is detected, a modal prompts the user to update now or later instead of silently reloading.
- "Later" defers the update for a configurable grace period (default 10 min); dialog reappears after each grace period.
- Users can postpone up to 3 times; after the 3rd Later the page reloads automatically when the next grace period expires.
- Header badge "↑ update available" shown while update is pending and dialog is dismissed; clicking it reloads immediately.
- Dialog shows the grace period and remaining postpones so the user knows what to expect.

## 0.1.20 - 2026-03-16

### Changed
- `checkForUpdate()` moved from a dedicated 5-minute `setInterval` in `AppComponent` into the Commander's existing 30-second health poll timer — version checks now piggyback on the health poll instead of running a separate interval.

## 0.1.19 - 2026-03-16

### Changed
- Version bump to test SW auto-reload across all clients (browser, desktop PWA, iOS PWA).

## 0.1.18 - 2026-03-16

### Changed
- Service worker now polls for a new version every 5 minutes (`checkForUpdate()`), so long-running open PWAs pick up deploys without needing a navigation event.

## 0.1.17 - 2026-03-16

### Changed
- Version bump to verify service worker auto-reload on new deploy (end-to-end PWA release test).

## 0.1.16 - 2026-03-16

### Added
- iOS install hint banner: a dismissable fixed bottom bar prompts Safari users to tap Share → Add to Home Screen. Only shown on iOS when not already installed as a PWA. Dismissal stored in localStorage.

## 0.1.15 - 2026-03-16

### Added
- Angular service worker (`ngsw-worker.js`) registered in production builds — caches app shell (JS, CSS, manifest, icons) for faster loads and future offline support.
- Auto-reload on new version: app silently reloads when the service worker detects a new build is ready, keeping installed PWA in sync with deployments.

## 0.1.14 - 2026-03-16

### Added
- Web App Manifest (`manifest.webmanifest`) — name, icons, dark theme, standalone display mode.
- PWA icons at 180×180, 192×192, 512×512 (placeholder BK monogram; replace with final artwork).
- iOS meta tags: `apple-mobile-web-app-capable`, status bar style, `apple-touch-icon`, `theme-color`.
- App is now installable via Safari Share → Add to Home Screen on iOS; Chrome/Edge desktop install icon appears when served over HTTPS.

## 0.1.13 - 2026-03-16

### Changed
- App renamed to **BAUKLANK Studio** — browser tab title, toolbar heading, and PWA manifest name updated; internal directory and package names unchanged.

## 0.1.11 - 2026-03-16

### Added
- Commander health panel now shows `commander fqbn` from `/health` (`commander.fqbn`).

### Changed
- Regenerated CMDR OpenAPI TypeScript models to include `CommanderHealthStatus.fqbn`.

## 0.1.10 - 2026-03-16

### Added
- Fixture modal now renders metadata-driven custom controls from `summary.fixtures[].custom_command_ui` (`button`, `slider`, `number`, and `checkbox` control support).
- PALESP32 (`PALETTE_ESP32`) custom controls now appear in the modal from fixture metadata: `startupSequence`, per-player `setVolume`, and per-player `playTracks`.

### Changed
- Regenerated CMDR OpenAPI TypeScript models to include `custom_command_ui` and custom command UI schema types.
- Custom-command template validation now rejects undeclared `{placeholders}` before send, instead of silently sending unresolved keys.
- Added explicit number-input class for custom args (`.commander__custom-arg-number`) for stable styling hooks.
- Custom command cards now hide the `Run` button when `send_on_release` is enabled (slider release is the only trigger for those commands).

## 0.1.9 - 2026-03-15

### Changed
- Direct tab is hidden on iOS and Android (Web Serial API not available); navigating to `/direct` on those platforms redirects to `/commander`.

## 0.1.8 - 2026-03-15

### Changed
- Clicking the health refresh button now resets the 30 s auto-poll timer, so the next automatic poll is always a full 30 s after the manual refresh.

## 0.1.7 - 2026-03-14

### Added
- "empty list" text link above Full Discovery button — clears all fixtures from store and resets discovery timings from localStorage. Only visible when the list is non-empty.

## 0.1.6 - 2026-03-14

### Fixed
- Modal cursor is now default inside the panel; `cursor: pointer` moved to `::backdrop` pseudo-element only.

## 0.1.5 - 2026-03-14

### Added
- Full Discovery button now shows last run time and rolling avg (10 datapoints) persisted in `localStorage`; estimate shown while running.
- Bold firmware version (`vX.X.XX`) in fixture modal header.

### Fixed
- Modal backdrop click now uses bounding-box hit test instead of `event.target` check — prevents accidental close when clicking on text/padding inside the modal (copy-paste safe).

## 0.1.4 - 2026-03-14

### Added
- Clicking outside the fixture detail modal (on the backdrop) now closes it; works on Safari iOS via `cursor: pointer` on the `<dialog>` element.

## 0.1.3 - 2026-03-14

### Changed
- Patch release — no functional changes; version bump + Pi deploy.

## 0.1.2 - 2026-03-14

### Changed
- Fixture version badge now distinguishes direction: fixture version > release shows blue "API outdated · release: v<X>" instead of orange "outdated".

## 0.1.1 - 2026-03-14

### Changed
- Player capabilities label renamed from "analog vol: on|off" → "Analog volume: yes|no".

## 0.1.0 - 2026-03-14

### Added
- `FixturePlayerControlsComponent` (`src/app/shared/fixture-player-controls/`) — standalone shared component for rendering player capabilities; shows capability detail when `player.attached` is true, "No player attached" when the player object is present but not attached.
- Fixture modal header now shows `fw_version` next to the fixture name, with an "outdated" / "up to date" label compared against `health.api.release_version`; "outdated" is highlighted in orange and shows the latest available version.
- `PlayerCapabilities` and `FixtureCapabilities` Pydantic models added to `CMDR_hello_api.py`; `player` field typed on `FixtureCapabilities`. Types regenerated in `cmdr-api.types.ts`, aliases added to `cmdr-models.ts`.
- Plan trigger / stop buttons in fixture modal are now gated on `capabilities.plan_controls.trigger.available` / `stop.available`; buttons hidden when the capability is absent.

### Changed
- Player capabilities label renamed from "volume sw" → "volume control".

## 0.0.14 - 2026-03-14
### Added
- Added generated CMDR API TypeScript models at `src/app/api/generated/cmdr-api.types.ts`, sourced from `CMDR_hello_api.py` OpenAPI output.

### Changed
- Added `npm run generate:cmdr-types` to regenerate frontend API models from backend OpenAPI in one step.
- Updated deploy docs/guidance for the in-repo frontend location (`/Users/hanskerkhof/bauklank-micros/frontend/serial-logger`).
- Updated deploy default behavior docs to reflect in-repo target resolution for `web/serial-logger-app`.

## 0.0.13 - 2026-03-14
### Fixed
- Committed the actual subscription-management code for the fixture modal HTTP cancellation fix (the v0.0.12 release commit missed `commander.component.ts`). Tracks `modalQuerySub` and unsubscribes on modal close or re-query to prevent stale responses landing after the dialog is dismissed.

## 0.0.12 - 2026-03-12
### Fixed
- Closing the fixture detail modal while a "Run query" request is in flight now cancels the HTTP request immediately (unsubscribes the RxJS subscription) instead of letting it complete silently in the background.

### Changed
- Added `AGENTS.md` to the repo with agent guidelines, release checklist, and a mutual sync note with `CLAUDE.md`.
- Added release checklist and `AGENTS.md` sync note to `CLAUDE.md`.

## 0.0.11 - 2026-03-12
### Changed
- Fixture query row: replaced free-text input with a `p-select` dropdown populated from the `plan_groups` endpoint (`fixture_names`); auto-selects first fixture when the list loads or the stored value is no longer present.
- Plan and Plan group dropdown selections now persist in `localStorage` (`cmdr.selectedPlan`, `cmdr.selectedPlanGroup`, `cmdr.selectedFixture`) and are restored on page load.
- Fixture modal "Query fixture" button relabelled to "Run query" with `pi pi-play` icon and PrimeNG `[loading]` spinner, matching the style of the main query buttons.
- All three query dropdowns (Fixture, Plan, Plan group) trigger a translucent backdrop overlay when open, matching the visual effect of the fixture detail dialog.
- "Last seen" in the fixture detail modal now uses browser-local time (`lastUpdatedAt`) instead of the backend `last_seen_at` Unix timestamp, eliminating clock-skew artefacts where "0s ago" would linger longer than expected.

### Verified
- `npm run build`

## 0.0.10 - 2026-03-10
### Changed
- Switched the app style pipeline from CSS to SCSS in Angular workspace configuration and active components.
- Removed all app-specific global and component styling to return the UI to a clean baseline before a new component-library pass.
- Replaced active `.css` stylesheets with empty `.scss` files for the root app, Direct page, Commander page, and Commander console.
- Installed PrimeNG, PrimeIcons, and the default Aura preset, and wired PrimeNG providers into app bootstrap.
- Reintroduced a minimal app-shell layout and Commander two-column layout after the styling reset so the workspace remains usable during the component migration.
- Migrated the Commander page buttons, main text inputs, query selects, and top-level app tabs to PrimeNG components.
- Increased the Angular initial bundle warning/error budgets to reflect the heavier PrimeNG-based UI baseline.
- Replaced app shell `<header>` with PrimeNG `p-toolbar` (title in `#start`, mode tabs in `#end`).
- Fixture modal: removed raw JSON `<pre>` block from the detail dialog body.
- Commander console: applied terminal-style dark theme (dark background, monospace font, color-coded timestamps/types/request IDs, custom scrollbar).
- Added shared `.console-log` global utility class for terminal-style log windows; applied to both the Commander console body and the Direct page `#logArea` textarea.
- Direct page `#logArea` textarea given explicit 400 px height via component SCSS.
- Commander console Auto-scroll and Heartbeat controls replaced with PrimeNG `p-toggleswitch` components.
- Commander query rows (Fixture, Plan, Plan group) migrated to PrimeNG `p-inputgroup` / `p-inputgroup-addon` layout, placing label, input/select, and action button on a single fused line.
- Added `gap: 0.5rem` flex column layout to `.commander__query-panel` for consistent spacing between input groups.
- Removed inline query result JSON `<pre>` block and action result JSON from the Commander query panel and fixture modal.
- Fixture detail modal given minimum height (`20rem`) to consistently show header + body + footer; `display: flex` scoped to `dialog[open]` to preserve native close behaviour.
- Commander query buttons shortened to "Run" with a `pi pi-play` icon on the right; `[loading]` spinner replaces the icon during execution to keep button size stable.
- Full Discovery button also given `pi pi-play` icon and `[loading]` spinner.
- Added `backendBusy` computed signal (`discoveryLoading || queryLoading`) to cross-disable all backend action buttons while any request is in flight.
- Replaced inline "Running..." status paragraphs with a PrimeNG `p-toast` (top-center, sticky, non-closable) driven by an `effect()` that reacts to the loading signals.
- Added a second PrimeNG toast channel for query results so fixture, plan, plan-group, and discovery queries report concise upsert outcomes after completion.
- `FixtureStoreService.upsertFixtures()` now returns `{ added, updated }` counts so the Commander page can surface how many fixtures were inserted or refreshed from each query response.
- Commander health block wrapped in a collapsible `p-panel` (starts collapsed); header shows "Heartbeat: {utc}" and clicking anywhere on the header row expands/collapses the full key-value detail.
- Direct page controls migrated to PrimeNG components: baud select now uses `p-select`, the command row uses `p-inputgroup` with `pInputText`, and connect/history actions use PrimeNG buttons and icon buttons.
- Direct page history dialog actions now use PrimeNG buttons and PrimeIcons, and the page regained minimal SCSS layout so the serial log, controls, and dialog content remain usable after the SCSS reset.

### Verified
- `npm run build`

## 0.0.7 - 2026-03-07
### Changed
- Fixture modal now includes `Query fixture` action in the header.
- Modal header shows inline query state (`Running query...`) and short error text when query fails.
- Querying from modal refreshes the fixture payload in-store and updates modal JSON with latest data.
- Modal header action/status alignment refined to sit left, next to `Fixture: ...`.
- App patch version bumped to `0.0.7`.

### Verified
- `npm run deploy:bauklank-micros-api`

## 0.0.6 - 2026-03-07
### Changed
- Commander health panel now renders a compact no-spacing list with the key fields only: `ok`, `utc`, `service`, `commander detected`, `commander fixture`, `serial port`, `resolver source`, `proxy active`.
- Added FE type support for enriched `/health` payload diagnostics while keeping display intentionally minimal.
- App patch version bumped to `0.0.6`.

### Verified
- `npm run deploy:bauklank-micros-api`

## 0.0.5 - 2026-03-07
### Changed
- Commander API base URL now defaults to same-origin when the app is hosted by `CMDR_hello_api` (`http://<host>:8080`), preventing stale cross-host target errors.
- Added migration for persisted legacy default (`http://100.88.15.68:8080`) to same-origin when hosted on a different node (for example Pi).
- README updated to document same-origin default behavior and current default route/version.
- App patch version bumped to `0.0.5`.

### Verified
- `npm run build`
- `npm run deploy:bauklank-micros-api`


## 0.0.4 - 2026-03-06
### Changed
- Deployment default target switched from `.runtime/serial-logger-app` to committed `web/serial-logger-app` in `bauklank-micros`.
- Added explicit deploy script naming/docs for API-hosted frontend flow (`deploy:bauklank-micros-api`).
- App patch version bumped to `0.0.4`.

### Verified
- `npm run deploy:bauklank-micros-api` builds and copies artifacts into `bauklank-micros/web/serial-logger-app`.

## 0.0.3 - 2026-03-06
### Added
- Commander: Added exposed plans dropdown sourced from CMDR API `GET /plans` with `plan_group` optgroup rendering.
- Commander: Added plan-group query UI with a new dropdown and `Run plan group versions endpoint` action.
- Commander: Added LAN-group API wiring for `GET /lan-groups` and plan-group versions query support.

### Changed
- Commander: Fixture detail modal now shows richer fixture payload data (including `plan_group`, `universe`, `channel`, `wifi_mac_address`, and runtime status fields when present).
- Commander: Fixture detail modal size increased for better readability on large JSON payloads.
- Commander: Plan query selector migrated from free-text input to API-backed dropdown.
- Direct: Layout now accounts for app header/tabs so the bottom command input stays visible in viewport.
- App patch version bumped to `0.0.3`.

### Verified
- `npm run build` succeeds after commander endpoint wiring and direct-layout viewport fixes.

## 0.0.2 - 2026-03-06
### Added
- Commander mode fixture store (`FixtureStoreService`) using Angular signals, keyed by unique `fixture_name`.
- Commander sidebar listing fixtures grouped by `plan_name` and sorted by `plan_name` + `fixture_name`.
- Fixture selection modal (read-only JSON) that opens from sidebar selection and auto-fills fixture query input.

### Changed
- Commander page layout converted to two-column design (left fixture list, right query/health panels).
- Commander endpoint result ingestion now upserts fixture data into runtime store from both fixture and plan queries.
- Top mode tab active styling improved for clearer `Direct` vs `Commander` context.
- Commander in-page `h2` title removed to reduce duplicate page labeling.
- App patch version bumped to `0.0.2`.

### Fixed
- Commander error rendering now surfaces backend HTTP detail payloads (including `step` and `output_tail`) instead of generic unknown errors.

### Verified
- `npm run build` succeeds after store/sidebar/modal and UI updates.

## 0.0.1 - 2026-03-06
### Changed
- Upgraded Angular from 20.3.x to 21.2.1 (`@angular/core`, `@angular/cli`, and related framework/build packages).
- Applied Angular update migrations:
  - Updated bootstrap configuration in `src/main.ts`.
  - Updated TypeScript app config in `tsconfig.app.json`.
  - Updated Angular workspace config in `angular.json`.

### Verified
- `npm run build` succeeds after the upgrade.
