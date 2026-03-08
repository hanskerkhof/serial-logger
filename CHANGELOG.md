# CHANGELOG

## Unreleased
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
