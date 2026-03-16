# Agent Guidelines

> **Keep in sync with `CLAUDE.md`** — both files must always reflect the same release checklist and conventions. When you update one, update the other in the same commit.

You are an expert in TypeScript, Angular, and operational web tooling.

## Scope

These instructions apply to the entire repository unless a more specific `AGENTS.md` is added in a subdirectory.

## Skill Reference

- Reusable BAUKLANK frontend guidance for this repo lives in the separate skills repo: `/Users/hanskerkhof/bauklank-agent-skills`
- Relevant skill for this repo: `bauklank-frontend-studio`
- Repo-local `AGENTS.md` remains authoritative for repo-specific rules and overrides reusable skill guidance when they differ.

## Coding Style

- Use TypeScript and Angular conventions.
- Follow the existing Prettier configuration.
- Use standalone Angular components.
- Prefer `inject()` over constructor injection.
- Use signals for UI state when practical.
- Avoid `any`; prefer explicit types or `unknown`.
- Use native Angular control flow (`@if`, `@for`, `@switch`) where appropriate.

## App Priorities

- Optimize for operator clarity and runtime visibility.
- Keep HTTP, SSE, and Web Serial behavior explicit and inspectable.
- Preserve service boundaries and persistent operator state handling.

## Release checklist

When bumping the version (patch, minor, or major), always do **all** of the following before committing:

1. `npm version <new-version> --no-git-tag-version` — updates `package.json` and `package-lock.json`.
2. Update `src/app/build-info.ts` — set `APP_VERSION` and `BUILD_DATE` to match.
   `ngsw-config.json` (`appData.version`) is also auto-updated by the deploy script — no manual edit needed.
3. Add a new section to `CHANGELOG.md` — `## <version> - <date>` with `### Changed` / `### Fixed` / `### Added` bullets summarising every change since the previous release. Move items from `## Unreleased` if any exist.
4. Commit all changed files together.

## API Types

- HTTP response types for CMDR endpoints come from the auto-generated `src/app/api/generated/cmdr-api.types.ts` (do not edit manually).
- `src/app/api/cmdr-models.ts` provides readable `Cmdr*` aliases over the raw `components["schemas"]["..."]` references; service code imports from there. Current aliases include `CmdrFixtureCapabilities`, `CmdrPlanControls`, `CmdrPlayerCapabilities`.
- `CommanderApiService` re-exports aliases under legacy names (`CommanderHealthResponse`, `CommanderLanGroup`, etc.) so component import paths remain stable.
- SSE types (`CommanderStreamEvent`, `CommanderStreamHandlers`) remain handwritten — the `/commander/stream` endpoint is not fully typed in OpenAPI.
- Regenerate types with `npm run generate:cmdr-types` after any CMDR API contract change (`CMDR_hello_api.py`); commit the updated generated file alongside the consuming changes.

## Fixture capabilities access pattern

`FixtureRecord` stores all raw fixture data in `raw: Record<string, unknown>`. Capabilities are **not** a top-level field — always access via:

```ts
const caps = this.selectedFixture()?.raw['capabilities'] as CmdrFixtureCapabilities | undefined | null;
```

Sub-fields: `caps?.plan_controls` (`CmdrPlanControls`) and `caps?.player` (`CmdrPlayerCapabilities`).

Use `computed()` signals in `CommanderComponent` to derive these safely:
```ts
protected readonly selectedFixturePlanControls = computed<CmdrPlanControls | null>(() => {
  const caps = this.selectedFixture()?.raw['capabilities'] as CmdrFixtureCapabilities | undefined | null;
  return caps?.plan_controls ?? null;
});
```

## Firmware version status pattern

Compare fixture `fw_version` (from `raw['fw_version']`) against `health().api.release_version` to derive an up-to-date / outdated status:

```ts
protected readonly selectedFixtureFwStatus = computed<{ fw: string; release: string | null; upToDate: boolean } | null>(() => {
  const v = this.selectedFixture()?.raw['fw_version'];
  if (typeof v !== 'string') return null;
  const release = this.health()?.api?.release_version ?? null;
  return { fw: v, release, upToDate: release !== null && v === release };
});
```

## Shared components

- `src/app/shared/fixture-player-controls/` — `FixturePlayerControlsComponent` renders `CmdrPlayerCapabilities`. Input: `player: CmdrPlayerCapabilities | null`. Shows capability detail when `attached`, "No player attached" when player object is present but `attached === false`, nothing when `null`.

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

### Deploy script and ngsw-config

`scripts/deploy-bauklank.mjs` auto-writes `ngsw-config.json appData.version` before `ng build` so the new version number is available in `VersionReadyEvent.latestVersion.appData`. Commit `ngsw-config.json` alongside each release — it is auto-managed, not hand-edited.

## Pi update

Run `./scripts/update_studio_pi.sh` from the **root** `bauklank-micros` repo. The script:
- Auto-discards local Pi changes before pulling (`git checkout -- .`) — dirty Python files no longer block the pull.
- Restarts `cmdr-api.service` and verifies the frontend bundle.
- Requires a **clean Mac-side repo** — commit/stash local changes first.
- The `curl` health check at the end sometimes fails due to boot timing; `active (running)` in the service status is the reliable indicator.

## Testing

- Prefer `npm test` for logic or UI behavior changes.
- Prefer `npm run build` for non-trivial changes and before deployment-related updates.
- For BAUKLANK releases, always run `npm run deploy:bauklank-studio` before the root `bauklank-micros` release commit so the deployed bundle lands in `bauklank-micros/web/serial-logger-app` in that same release.
- Default deploy target is `../../web/serial-logger-app` when running in-repo unless `BAUKLANK_DEPLOY_TARGET` overrides it.
- Before a BAUKLANK release, validate the FE repo with at least:
  - `npm run build`
  - `npm run deploy:bauklank-studio`
