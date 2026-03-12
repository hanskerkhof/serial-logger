# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Dev server on http://localhost:4210
npm test               # Run tests with Karma/Jasmine
npm run build          # Production build (output: dist/serial-logger/)
npm run build:prod     # Same as build
npm run deploy:bauklank  # Build + copy dist to ../bauklank-micros/web/serial-logger-app/
```

The dev server runs on port **4210** (not the default 4200).

Tests use Karma with Jasmine (`ng test`). There is currently only one spec file: `src/app/app.spec.ts`.

## Architecture

This is an Angular 21 standalone app (no NgModules). UI is built with **PrimeNG v21** using the **Aura** theme preset from `@primeuix/themes`. All styles use SCSS. The app is bootstrapped in `src/main.ts` with `provideHttpClient()`, `provideRouter()`, and `providePrimeNG()`.

### Two modes (routes)

The app has two top-level routes, toggled by tabs in `AppComponent`:

- **`/commander`** (default) — HTTP-based control UI for a "Bauklank Commander" API backend. Lets you query fixture/plan versions, run commands on fixtures, and watch a live SSE stream.
- **`/direct`** — Raw Web Serial terminal. Opens a serial port via the browser's Web Serial API and provides a send/receive text console with command history.

### Key services

- **`SerialService`** (`src/app/serial.service.ts`) — Wraps the Web Serial API. Manages port open/close/read/write lifecycle. Emits incoming text via `log$` (Subject), connection state via `connected$`, baud via `baud$`. Uses `NgZone.run()` to push serial data back into Angular's change detection.

- **`CommanderApiService`** (`src/app/commander-api.service.ts`) — HTTP client for the Commander REST API. Persists the selected `apiBaseUrl` in `localStorage` (`cmdr.api.baseUrl`). Auto-detects same-origin API when served from the Pi/Mac on port 8080. Contains hardcoded target URLs for MacBook (`100.88.15.68:8080`) and Raspberry Pi (`100.78.180.13:8080`). Also opens an SSE stream at `/commander/stream` via native `EventSource`.

- **`FixtureStoreService`** (`src/app/fixture-store.service.ts`) — Signal-based in-memory + localStorage store for discovered fixture records. Persists under `cmdr.fixtureStore.v1`. Provides `fixturesGroupedByPlanName` (computed) for the UI list.

- **`HistoryService`** (`src/app/history.service.ts`) — Saves/loads the command history for the Direct terminal in `localStorage` (`bauklank-serial-command-history`).

### Commander feature

`CommanderComponent` is the main controller. It:
1. Calls `CommanderApiService` for health, exposed plans, LAN groups, fixture/plan queries, and fixture commands.
2. Passes query results to `FixtureStoreService.upsertFixtures()` after extracting fixture payloads from `result.summary`.
3. Renders a `<app-commander-console>` child that independently opens the SSE stream and displays live events.

Wire commands sent to fixtures are prefixed automatically: `tcmd;<fixture_name>;<command>` unless the command already starts with `tcmd;` or `ack;tcmd;`.

### Deploy

`scripts/deploy-bauklank.mjs` copies the production build into a sibling repo at `../bauklank-micros/web/serial-logger-app/`. The target path can be overridden via `BAUKLANK_DEPLOY_TARGET` env var.

## Release checklist

When bumping the version (patch, minor, or major), always do **all** of the following before committing:

1. `npm version <new-version> --no-git-tag-version` — updates `package.json` and `package-lock.json`.
2. Update `src/app/build-info.ts` — set `APP_VERSION` and `BUILD_DATE` to match.
3. Add a new section to `CHANGELOG.md` — `## <version> - <date>` with `### Changed` / `### Fixed` / `### Added` bullets summarising every change since the previous release. Move items from `## Unreleased` if any exist.
4. Commit all four files together.

## Conventions

- All new components should be **standalone** with **SCSS** styles and **OnPush** change detection (configured as Angular CLI defaults in `angular.json`).
- State is managed with Angular **signals** (`signal()`, `computed()`, `linkedSignal()`). Avoid introducing new RxJS `BehaviorSubject` patterns — `SerialService` is a legacy exception.
- Use `inject()` over constructor injection for new code.
- Prettier config: `printWidth: 100`, `singleQuote: true`, Angular HTML parser for templates.
