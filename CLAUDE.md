# CLAUDE.md

> **Keep in sync with `AGENTS.md`** — both files must always reflect the same release checklist and conventions. When you update one, update the other in the same commit.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Dev server on http://localhost:4210
npm test               # Run tests with Karma/Jasmine
npm run build          # Production build (output: dist/serial-logger/)
npm run build:prod     # Same as build
npm run deploy:bauklank-studio  # Build + copy dist to ../../web/serial-logger-app/
npm run generate:cmdr-types  # Regenerate src/app/api/generated/cmdr-api.types.ts from FastAPI OpenAPI spec
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

- **`CommanderApiService`** (`src/app/commander-api.service.ts`) — HTTP client for the Commander REST API. Persists the selected `apiBaseUrl` in `localStorage` (`cmdr.api.baseUrl`). Auto-detects same-origin API when served from the Pi/Mac on port 8080. Contains hardcoded target URLs for MacBook (`100.88.15.68:8080`) and Raspberry Pi (`100.78.180.13:8080`). Also opens an SSE stream at `/commander/stream` via native `EventSource`. All HTTP method return types use generated OpenAPI schema aliases from `src/app/api/cmdr-models.ts`; SSE types (`CommanderStreamEvent`, `CommanderStreamHandlers`) remain handwritten. Regenerate types with `npm run generate:cmdr-types` after any CMDR API contract change.

- **`FixtureStoreService`** (`src/app/fixture-store.service.ts`) — Signal-based in-memory + localStorage store for discovered fixture records. Persists under `cmdr.fixtureStore.v1`. Provides `fixturesGroupedByPlanName` (computed) for the UI list.

- **`HistoryService`** (`src/app/history.service.ts`) — Saves/loads the command history for the Direct terminal in `localStorage` (`bauklank-serial-command-history`).

### Commander feature

`CommanderComponent` is the main controller. It:
1. Calls `CommanderApiService` for health, exposed plans, LAN groups, fixture/plan queries, and fixture commands.
2. Passes query results to `FixtureStoreService.upsertFixtures()` after extracting fixture payloads from `result.summary`.
3. Renders a `<app-commander-console>` child that independently opens the SSE stream and displays live events.

Wire commands sent to fixtures are prefixed automatically: `tcmd;<fixture_name>;<command>` unless the command already starts with `tcmd;` or `ack;tcmd;`.

### Deploy

`scripts/deploy-bauklank.mjs` copies the production build into `../../web/serial-logger-app/` when running in-repo (`bauklank-micros/frontend/serial-logger`). The target path can be overridden via `BAUKLANK_DEPLOY_TARGET` env var.

Before building, the script also auto-writes:
- `src/app/build-info.ts` — `APP_VERSION` and `BUILD_DATE`
- `ngsw-config.json` — `appData.version` (used by the SW update dialog to show the new version)

## Release checklist

When bumping the version (patch, minor, or major), always do **all** of the following before committing:

1. `npm version <new-version> --no-git-tag-version` — updates `package.json` and `package-lock.json`.
2. Update `src/app/build-info.ts` — set `APP_VERSION` and `BUILD_DATE` to match.
   `ngsw-config.json` (`appData.version`) is also auto-updated by the deploy script — no manual edit needed.
3. Add a new section to the **root** `../../CHANGELOG.md` — `## <FW version> / FE <version> - <date>` with `### Changed` / `### Fixed` / `### Added` bullets. Prefix every bullet with **FE**, **FW**, or **BE** to indicate scope. Move items from `## Unreleased` if any exist. Do NOT update `frontend/serial-logger/CHANGELOG.md` — it has been removed; the root changelog is the single source of truth.
4. Commit all changed files together.

## PWA & Service Worker

- `@angular/service-worker` v21.2.1 registered in production builds via `provideServiceWorker` in `src/main.ts`.
- SW only activates on **HTTPS**. On plain HTTP (local IP) `SwUpdate.isEnabled` is `false` — no update detection, no caching. The Tailscale URL (`https://bklk-cmdr-2-studio.tailad320e.ts.net`) is the HTTPS entry point.
- `checkForUpdate()` is called inside `CommanderComponent.startHealthPollTimer()` (every 30 s), not in a standalone interval. It only fires when `!loading() && !healthRefreshing() && swUpdate.isEnabled`.
- `VERSION_READY` triggers `onUpdateReady()` in `AppComponent` — never a silent `document.location.reload()`.

### Update dialog flow

- PrimeNG `p-dialog` (non-closable modal, `[closable]="false"` + `[closeOnEscape]="false"`).
- Shows new version from `VersionReadyEvent.latestVersion.appData.version`.
- **"Update Now"** → reloads immediately.
- **"Later"** → hides dialog, starts grace-period timer (`GRACE_PERIOD_MINUTES` constant in `app.component.ts`, currently 2 min for testing — restore to 10 for production), shows "↑ update available" badge in header.
- After timer: dialog reappears, or auto-reloads if `MAX_LATER_COUNT = 3` exhausted.
- Header badge shown when `updateAvailable() && !showUpdateDialog()`; clicking it reloads immediately.

## Pi update

Run `./scripts/update_studio_pi.sh` from the **root** `bauklank-micros` repo. The script:
- Auto-discards local Pi changes before pulling (`git checkout -- .`) — dirty Python files no longer block the pull.
- Restarts `cmdr-api.service` and verifies the frontend bundle.
- Requires a **clean Mac-side repo** — only the files being released need to be committed. Do **not** stash or commit unrelated dirty files (e.g. `arduino/BAUKLANK_FIXTURE_v2/Version.h`) just to satisfy the script; let them remain dirty and unstaged.
- The `curl` health check at the end sometimes fails due to boot timing; `active (running)` in the service status is the reliable indicator.

## Fixture capabilities access pattern

`FixtureRecord` stores all raw fixture data in `raw: Record<string, unknown>`. Capabilities are **not** a top-level field — always access via:

```ts
const caps = this.selectedFixture()?.raw['capabilities'] as CmdrFixtureCapabilities | undefined | null;
```

Sub-fields: `caps?.plan_controls` (`CmdrPlanControls`) and `caps?.player` (`CmdrPlayerCapabilities`).
Current `cmdr-models.ts` aliases: `CmdrFixtureCapabilities`, `CmdrPlanControls`, `CmdrPlayerCapabilities`.

## Firmware version status pattern

Compare `raw['fw_version']` (string) against `health().api.release_version` to derive up-to-date / outdated status via a `computed()` signal. "outdated" is shown in orange; when release version is unknown the status label is omitted.

## Shared components

- `src/app/shared/fixture-player-controls/` — `FixturePlayerControlsComponent`. Input: `player: CmdrPlayerCapabilities | null`. Renders capability detail when `attached`, "No player attached" when player exists but `attached === false`, nothing when `null`.

## PrimeNG component work

- Always read `/Users/hanskerkhof/bauklank-agent-skills/primeng/SKILL.md` before working with PrimeNG components.
- Call `mcp__primeng__get_component_props` before writing any new PrimeNG component template — the MCP docs are authoritative; do not guess props from memory.
- Notable: `SplitButton` has **no `loading` prop** — use `[disabled]` to reflect loading state instead.

## Conventions

- All new components should be **standalone** with **SCSS** styles and **OnPush** change detection (configured as Angular CLI defaults in `angular.json`).
- State is managed with Angular **signals** (`signal()`, `computed()`, `linkedSignal()`). Avoid introducing new RxJS `BehaviorSubject` patterns — `SerialService` is a legacy exception.
- Use `inject()` over constructor injection for new code.
- Prettier config: `printWidth: 100`, `singleQuote: true`, Angular HTML parser for templates.

## Angular build warning policy

- Keep `npm run build` warning-clean by default.
- If Angular budget warnings/errors appear after intentional FE growth, rebalance `angular.json` budgets (`initial`, `anyComponentStyle`) in the same change set.
- If known/accepted CommonJS optimization warnings appear, update `allowedCommonJsDependencies` in `angular.json` to avoid recurring warning noise.
