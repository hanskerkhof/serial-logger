# CHANGELOG

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
