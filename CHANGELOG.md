# CHANGELOG

## Unreleased

### Added
- Relay state display in fixture modal Status tab for `NER_B_RLY_1`: 4 dots showing relay state (gray=off, green=on, blinking amber=scheduled) with relay number and scheduled countdown in seconds.

### Changed
- Renamed "Discover fixtures" button label to "Query fixtures" and "Discover outdated (N)" menu item to "Query outdated (N)".

## 0.7.4 - 2026-03-29

### Added
- Release notes markdown rendering in `ReleaseNotesComponent` via `ngx-markdown` (`v21.1.0`) so `**bold**` and `` `backtick` `` spans render correctly in release-note bullets.

### Changed
- Angular updated from `21.2.5` to `21.2.6` (framework packages including `@angular/service-worker`) and `@angular/cli` / `@angular/build` updated from `21.2.3` to `21.2.5`.
- Studio bundle redeployed to `web/serial-logger-app` with refreshed generated build metadata (`src/app/build-info.ts`) and service-worker app data version (`ngsw-config.json`).

## 0.7.3 - 2026-03-29

### Added
- **aux.one / aux.two editable fields in Config tab** — `aux.one` and `aux.two` now appear as editable integer inputs (0–255) in the Aux section when the fixture reports non-null values. Saves via `cmd;config;setAuxOne=X;save=1;` / `cmd;config;setAuxTwo=X;save=1;`. Requires matching firmware `setAuxOne`/`setAuxTwo` command handlers added to `CommandHandlers.h`.
- **Config tab in fixture modal** — new "Config" tab next to "Status" in the fixture dialog. Shows EEPROM config fields read from `BK_CONFIG`: Player (volume, default/min/max, EQ), Aux (auto-off toggle + read-only freq/power), WiFi (current SSID display + editable SSID/password), DMX (read-only), and Info fields. Each editable field has its own Save button. Config data loads automatically when a fixture query returns it; "no data" hint shown until a query is run.
- New standalone `FixtureConfigControlComponent` (`src/app/shared/fixture-config-control/`) with signal-based per-field linked state, `commandRequested` output, and OnPush change detection.
- `CmdrFixtureConfig`, `CmdrFixtureConfigPlayer`, `CmdrFixtureConfigAux`, `CmdrFixtureConfigDmx` type aliases added to `cmdr-models.ts`.
- `TabsModule` (PrimeNG `p-tabs`) added to `CommanderComponent` — first use of tabs in the fixture modal.

### Changed
- Fixture `raw` record now preserves existing `config` when a single-fixture query returns `config: null` (prevents discovery data from being overwritten).
- "Full Discovery" is now a split button. The primary action runs full discovery as before. The dropdown item "Full discovery + fixtures" runs full discovery and then immediately runs "Discover fixtures" sequentially (with the same spinning icon and toast notifications).
- On page load with an empty fixture list, the automatic full discovery now continues into "Discover fixtures" automatically, matching the "Full discovery + fixtures" behaviour.
- Cancel button in the progress toast for full discovery and fixture discovery. Cancelling full discovery unsubscribes the HTTP request immediately. Cancelling fixture discovery stops the sequential loop after the current fixture and reports how many were queried before stopping. Progress toasts now use a dedicated `app-progress` toast channel with a custom template; completion and error toasts remain on the `app` channel and are no longer cleared by the progress effect.
- Color picker trigger now has a 1 px outline using the PrimeNG `--p-content-border-color` semantic token, which adapts automatically to light and dark mode.
- Studio deploy refreshed generated build metadata (`src/app/build-info.ts`) and service-worker app version payload (`ngsw-config.json` `appData.version`) for `v0.7.3`.

## 0.7.2 - 2026-03-29

### Changed
- Frontend patch release bump to `v0.7.2`.
- Studio deploy refreshed generated build metadata (`src/app/build-info.ts`) and service-worker app version payload (`ngsw-config.json` `appData.version`).
- Deployed Studio web bundle updated in root repo under `web/serial-logger-app`.

## 0.6.28 - 2026-03-27

### Changed
- Frontend patch release bump to `v0.6.28`.
- Query toasts now include round-trip timing in completion message (`1 updated - 2.4s` style).
- Query progress toast now includes fixture context (`Running query for <FIXTURE_NAME>...`).
- Health Details panel now displays API uptime (`api_uptime`) from `/health`, making restart verification visible in UI.
- OpenAPI-generated API types refreshed for new health schema fields and runtime restart endpoint contract.

## 0.6.26 - 2026-03-26

### Changed
- Frontend patch release bump to `v0.6.26`.
- NER_B_DMX fixture custom-control number input alignment/spacing polish in the one-line layout (`src/app/shared/fixture-custom-control/fixture-custom-control.component.scss`):
  - left-aligned numeric values,
  - tuned width to fit max values with spinner rockers,
  - reduced excess spacing for denser control rows.
- Shared custom-color control now includes explicit `Set RGB` run action in the fixture modal flow.
- Commander fixture dialog feedback strip remains anchored in the dialog header for persistent visibility while scrolling command controls.

## 0.6.23 - 2026-03-26

### Added
- Fixture modal dialog content is now scrollable. The dialog is capped at 90 vh and the body area scrolls independently while the header and footer stay fixed, making all form elements reachable on short screens.
- Plan pin/unpin in the fixture sidebar. A bookmark icon button next to each plan name pins it to the top of the fixture list. Pinned plans float their parent plan group to the top; within the group, pinned plans sort before unpinned ones. "Discover fixtures" respects the same order. Pins are stored in `localStorage` (`cmdr.pinnedPlans.v1`) and are non-fatal when a previously pinned plan no longer exists.

### Changed
- Commander fixture dialog feedback strip (`commander__dialog-feedback`) now renders in the dialog header area so status/success/error feedback remains visible while body content is scrolled.
- Custom command controls now show one-row command labels and inline controls (`label -> control -> Run`) for grouped command cards.
- Custom command sliders now use PrimeNG `p-slider`; number fields remain `type=number` with Prime styling and visible native spinner rockers.
- NER_B_DMX custom-command ergonomics improved in Studio: command labels are visible, arg labels are cleaner (`Dimmer`, `Duration (ms)`, `Speed`), and number-input width tuning avoids clipping at max values.
- Frontend patch release bump to `v0.6.23`.

## 0.6.20 - 2026-03-25

### Added
- "Discover fixtures" button is now a PrimeNG `SplitButton`. The primary action discovers all fixtures (unchanged). The dropdown item "Discover outdated (N)" discovers only fixtures whose `fw_version` is behind the current `release_version`, with the count shown in the label. The item is disabled when no outdated fixtures are present.

### Changed
- "Discover fixtures" split button now spans full width, matching the Full Discovery button.
- Refresh icon in the "Discover fixtures" button spins while discovery is running (covers both "Discover all" and "Discover outdated" flows).
- Frontend patch release bump to `v0.6.20`.

## 0.6.19 - 2026-03-24

### Changed
- Custom command controls now use a shared disable-state path (`loading || disabled`) aligned with plan/player control behavior.
- Commander fixture modal now passes the same disable policy to custom commands as to plan/player controls (`playerControlsDisabled`).
- `RENOO_TIMER` `timeIndex` custom command uses PrimeNG `p-select` with default PrimeNG sizing (matching EQ style), and label/select row layout fixes prevent overlap.
- Frontend patch release bump to `v0.6.19`.

## 0.6.18 - 2026-03-24

### Added
- Custom command UI now supports `select` controls with typed options from commander metadata (`control: "select"`, `options: [{label, value}]`).

### Changed
- `RENOO_TIMER` `timerIndex` custom command control switched from numeric input to option selector (OFF..INF stepped entries).
- Frontend patch release bump to `v0.6.18`.

## 0.6.17 - 2026-03-23

### Added
- Release notes dialog now uses API-backed pagination across all release notes (`total`-aware), so the pager reflects global position (for example `1 of 99`) instead of the first 10-item batch only.

### Changed
- Release notes dialog layout now uses a fixed tall viewport (`~80vh`) with a scrollable notes body and sticky bottom paginator bar.
- Frontend patch release bump to `v0.6.17`.

## 0.6.16 - 2026-03-23

### Changed
- Fixture details modal migrated from native `<dialog>` to PrimeNG `p-dialog` for consistent overlay and focus behavior.
- Fixture details dialog now uses PrimeNG default content spacing (removed custom `padding: 0` override) while keeping behavior-specific overflow handling.
- Frontend patch release bump to `v0.6.16`.

### Fixed
- Header heartbeat icon: colour no longer overridden to black on hover — healthy (red), degraded (grey), and offline (dark grey) states are now preserved on hover; only the background circle appears.
- `CommanderComponent` health panel heartbeat icon: hover no longer overrides the status colour to black; explicit `:hover`/`:focus` rules keep each state colour stable.

### Added
- `CommanderComponent` health panel header: heartbeat icon now uses the same three-state colour coding as the app-shell header icon (red + pulse = healthy, grey = degraded, dark grey = offline) via `heartbeatState` computed signal.
- Health popover: **Commander** row (fixture name, e.g. `BKLK_CMDR_2`) and **Port** row added to the detail list; order is API → FW → Commander → Port.

## 0.6.10 - 2026-03-23

### Added
- `app-fixture-player-controls`: New `playerState` input (`{ volume?, eq? } | null`) with an `effect()` that syncs the vol slider and EQ dropdown to live hardware values whenever a Run Query returns `plan_state.state` data.
- `CommanderComponent`: New `selectedFixturePlayerState` computed signal extracts `{ volume, eq }` from `raw['plan_state']['state']` and passes it to `<app-fixture-player-controls>`.
- `CommanderComponent`: `playerControlsDisabled` computed signal (`fixtureActionLoading || modalQueryLoading || commanderUnavailable`) — single source of truth for disabling all interactive fixture controls.
- `app-fixture-player-controls`: `[disabled]` binding applied to all three native inputs (track number, vol range, fade range) in addition to buttons and EQ select.
- `app-fixture-plan-control` (Plan trigger / Plan stop): now also driven by `playerControlsDisabled` — consistent disable behaviour with the player controls.
- `app-fixture-player-controls`: New `playerType` input (`string | null`). EQ dropdown now adapts to the player hardware: DY / XY players show 5 presets (Normal / Pop / Rock / Jazz / Classic, 0–4 — no Bass); MD / DF players (YX5300-based) show 6 presets (0–5, +Bass). AK player shows 5 (EQ is a no-op in firmware). Unknown player types default to 6. A clamping effect resets a stale EQ value when switching between fixture types. `CommanderComponent` passes `raw['player_type']` as `selectedFixturePlayerType` to the component.
- `app-fixture-player-controls`: Player type displayed in small dimmed font next to the PLAYER section header.
- `app-fixture-player-controls`: Separate `fadeInDurationMs` and `fadeInVolume` signals with independent inputs for Fade In — both independent from the Fade To / Fade Out controls.
- `app-fixture-player-controls`: Fade In volume input changed to a slider (matching the Fade row style).
- `app-fixture-player-controls`: Directional fade progress animation on the duration input background. Fade In always fills left → right. Fade To fills left → right when target volume is higher than current, drains right → left when lower. Fade Out always drains right → left. After a drain (RTL) animation completes the overlay is removed immediately; after a fill (LTR) the overlay fades out over 2 s. No layout shift — the animation runs entirely as a `::before` overlay inside a wrapper span.

### Fixed
- `app-fixture-player-controls`: `fadeToVolume` default raised from `0` → `30` to prevent Fade In silently fading to silence when the user has not moved the fade slider.
- `app-fixture-player-controls`: Missing `[disabled]` binding on the Fade To / Fade Out duration input added; `ms` label given correct `row-unit` class.

### Changed
- Feedback banner: Round-trip time repositioned to upper-right corner of the message box (absolutely positioned, message text padded to prevent overlap).
- Frontend patch release bump to `v0.6.10`.

## 0.6.9 - 2026-03-23

### Added
- `app-fixture-player-controls`: full interactive player control panel — Play (track number input + button), Stop, Fade In, Fade To, Fade Out, Set Volume (slider, with analog-override checkbox for testing), Set EQ (dropdown, auto-sends on selection).
- Player command feedback reuses the existing fixture-action banner — shows dispatch confirmation and round-trip time for all player commands.

### Changed
- Frontend patch release bump to `v0.6.9`.

## 0.6.8 - 2026-03-22

### Added
- New runtime release notice channel in `app.component` based on API `/health` release metadata (`health.api.release_version` fallback `health.release_version`), separate from SW `Update Available`.
- Global header release-notice badge (`● release notice vX.Y.Z`) with acknowledge dialog for sticky-per-version visibility.

### Changed
- Runtime release notice acknowledgment now persists per browser in localStorage key `studio.releaseNotice.lastAcknowledgedVersion`.
- Commander heartbeat details panel now includes frontend metadata lines: `fe_version` and `fe_build_date`.
- Frontend patch release bump to `v0.6.8`.
- Studio deploy refreshed generated build metadata (`src/app/build-info.ts`) and service worker app version payload (`ngsw-config.json` `appData.version`).

## 0.6.7 - 2026-03-22

### Changed
- Frontend patch release bump to `v0.6.7`.
- Studio deploy refreshed generated build metadata (`src/app/build-info.ts`) and service worker app version payload (`ngsw-config.json` `appData.version`).
- Deployed web bundle refreshed in `web/serial-logger-app` for update-dialog validation flow.

## 0.6.6 - 2026-03-22

### Changed
- Frontend patch release bump to `v0.6.6`.
- Studio deploy refreshed generated build metadata (`src/app/build-info.ts`) and service worker app version payload (`ngsw-config.json` `appData.version`).
- Deployed web bundle refreshed in `web/serial-logger-app` for the matching root release cycle.

## 0.6.5 - 2026-03-22

### Fixed
- Commander self-query (`Run Query` on `BKLK_CMDR_2` while it is the active connected commander) now returns a proper version card instead of ❌ Error. Root cause: `Commander.run_fixture_select()` (and `run_fixture_select_on_session`) in `CMDR_common.py` never saw a `BK_FS` JSON response for self-target rejection — the firmware emits raw text only. Both functions now detect `"refusing self-target fixture"` in the serial output, synthesise `bk_fs = {"error": "self_target_not_allowed"}`, and break early, which triggers the existing `identify` fallback in `_run_versions_query_via_proxy`. Response time drops from 10 s timeout to ~1 s.
- `BKLK_CMDR_2` was reporting `fqbn: ESP32_DEV_MODULE` and `player_type: DY_PLAYER` despite being an ESP32-C3 SuperMini with no player. Root cause: `fqbnEnumToken()` and `boardFamilyFromFqbn()` were plan-local static functions in `BAUKLANK_COMMANDER_SERIAL.plan.cpp` missing the `ESP32C3_SUPER_MINI` case, and the firmware was compiled against stale fixture_data. Both functions moved to `BauklankFixture.h` as `fqbnToToken()` and `fqbnToBoardFamily()` covering all 6 FQBN values. Both commanders recompiled and flashed.
- Fixture modal feedback strip now clears stale error/action messages automatically when the commander comes back online, so the strip resets to neutral on recovery.

### Added
- Fixture modal feedback strip shows a yellow ⚠ warning with reason text when the commander is unavailable: `Fixture commands disabled — <reason>`. Reasons: `API unreachable` (health fetch failed), `Serial port held (<reason>)` (serial hold active), `Commander not detected`. Warning takes priority over any stale command result.

## 0.6.4 - 2026-03-22

### Changed
- Frontend patch release bump to `v0.6.4`.
- Studio deploy refreshed generated build metadata (`src/app/build-info.ts`) and service worker app version payload (`ngsw-config.json` `appData.version`).
- Deployed web bundle refreshed for the matching root release (`web/serial-logger-app`).

## 0.6.0 - 2026-03-21

### Fixed
- Pasting a previously-shown success command (which contains an embedded `rid=`) into the footer command input no longer returns HTTP 502. Root cause (`CMDR_common.py`): `append_rid_to_cmd_payload()` was injecting a second `rid=` before the existing one; the commander's "inner rid wins" rule then used the stale embedded rid for ACK correlation, so the API waited for an ACK that never matched (12 s timeout → 502). Fix: strip any pre-existing `rid=` before injecting a fresh one.

### Changed
- Frontend minor release bump and Studio redeploy to `v0.6.0`.

## 0.5.4 - 2026-03-21

### Fixed
- `playTracks` (and other commands with ≥6 player params) silently dropped by fixture when "Require fixture ACK" was checked. Root cause: ACK headers (`ack:1;sid:N;rid:N;`) pushed the total param count past the `CommandParser` 10-param hard limit, causing `universe` to never be stored and the universe routing check to silently drop the command. Fixed in `CommandHandlers.h` by scanning the raw command buffer for `;universe:` and `;channel:` directly, bypassing the parsed-params limit.
- Plan trigger / Plan stop no longer accidentally close the fixture modal when the user drags a volume slider quickly to the boundary and releases outside. Fix: `mousedown` origin is now tracked; the backdrop `click` handler only closes the modal when the press also started outside the dialog content box.
- Volume sliders no longer reset to fixture-reported defaults after a plan trigger / plan stop re-query. Fix: the `customCommandValues` effect now tracks only fixture identity (`selectedFixtureName`) rather than full fixture content, so re-queries that update `raw` data do not re-initialise locally-edited slider values.

### Changed
- Plan state badge (`RUNNING` / `STOPPED`) now flips immediately when the BE returns 200 for a plan trigger or plan stop (either `Dispatch accepted` or `Fixture ACK confirmed`), rather than waiting for a follow-up fixture re-query. An optimistic `PlanState` signal overrides the store value until a different fixture is selected.
- Frontend patch release bump and Studio redeploy to `v0.5.4`.

## 0.5.3 - 2026-03-21

### Changed
- Update dialog postpone flow now uses escalating grace windows: first `Later` delays by `2 min`, second by `30 min`, and third by `6h`.
- After the third postpone, `Later` is no longer available and the modal becomes update-only (`Update Now`).
- Update dialog copy now shows the actual next delay dynamically (`2 min`, `30 min`, `6h`) and displays a postpone-limit message when deferrals are exhausted.
- Frontend patch release bump and Studio redeploy to `v0.5.3`.

## 0.5.2 - 2026-03-21

### Added
- Sidebar fixture list now includes a per-fixture `Re-query fixture <FIXTURE_NAME>` button with row-level spinner feedback while the fixture query is running.
- New sidebar action button `Discover fixtures` runs sequential per-fixture queries across the current sidebar list to preload `BK_PLAN_STATE` before opening fixture modals.

### Changed
- During `Discover fixtures`, the button label now shows live progress in the format `Discover fixtures - <FIXTURE_NAME> - XX.Xs` while each fixture is queried.
- After `Discover fixtures` completes, the button label switches to `Discover fixtures - DONE - XX.XXs` for the completed batch duration.
- Frontend patch release bump and Studio redeploy to `v0.5.2`.

## 0.5.1 - 2026-03-21

### Changed
- Fixture modal `Set volumes` now includes a `Master` slider when a grouped volume section has more than one slider.
- Master slider uses proportional scaling against the group average (Sonos-style grouped volume behavior), so relative balance between player sliders is preserved.
- While dragging `Master`, per-player sliders update live in the UI; on release, per-player `setVolume` commands are dispatched once through existing commander send logic.
- Frontend patch release bump and Studio redeploy to `v0.5.1`.

## 0.5.0 - 2026-03-21

### Added
- End-to-end BK_PLAN_STATE pipeline: firmware `writeStateJson()` → ESP-NOW → commander serial → API cache → `plan_state` field on fixture records.
- `state_path` support on `custom_command_ui` args: API injects live values from `plan_state.state` into arg `default` fields at query time so sliders initialise from live fixture state.
- `app-fixture-plan-control` component: plan state badge (RUNNING/STOPPED) + Plan trigger / Plan stop buttons, positioned below the fixture modal header. Badge updates optimistically on command accept.
- Auto-query on fixture modal open: fires a version query the first time a fixture modal opens (per session), skipped on reopen when data already available. Uses a `Set<string>` guard so fixtures without `plan_state` (e.g. CLIGNOTEUR) do not re-query on every open.

### Changed
- Command feedback moved from inline modal messages to transient toast notifications: success (green, 4 s) and error (red, 6 s). Round-trip duration shown on a new line in bold (`Round trip: 47.9 ms`).
- Volume sliders (PALESP32) grouped into a single card with one shared header instead of one card per player.
- Protocol docs updated: `BK_PLAN_STATE` entry in `PROTOCOL.md`, `getState` command in `COMMAND_PROTOCOL.md`, `plan_state` and `state_path` fields in `CMDR_API_PROTOCOL.md`.
- Version bump and Studio redeploy to `v0.5.0`.

## 0.4.8 - 2026-03-21

### Changed
- Fixture modal command semantics are now explicit: success feedback distinguishes `Dispatch accepted` (commander dispatch) from `Fixture ACK confirmed` (fixture-level ACK path).
- Added a fixture-modal `Require fixture ACK` toggle (default off) that applies to modal command sends (manual, plan actions, and custom control commands), with reboot remaining fire-and-forget by backend rule.
- Extracted generic custom command rendering into a reusable `app-fixture-custom-control` component with grouped PALESP32 layouts (`Startup Sequence`, single `Set volumes` card, single `Play Tracks` card) and responsive side-by-side desktop / stacked mobile behavior.
- Version bump and Studio redeploy to `v0.4.8`.

## 0.4.7 - 2026-03-20

### Changed
- Added icon generation `v6` with slightly smaller `BK/STDO` text than `v5` to better match neighboring app icon visual weight.
- Switched active PWA manifest icon references to `icon-*-v6.png`.
- Updated HTML cache-bust query strings to `?v=6` for `favicon.ico`, `manifest.webmanifest`, and `apple-touch-icon.png`.
- Retained earlier icon generations (`v1` to `v5`) for quick fallback.
- Version bump and Studio redeploy to `v0.4.7`.

## 0.4.6 - 2026-03-20

### Changed
- Added icon generation `v5` with no outline box and larger `BK/STDO` lettering for stronger Dock/app-launcher readability.
- Switched active PWA manifest icon references to `icon-*-v5.png`.
- Updated HTML cache-bust query strings to `?v=5` for `favicon.ico`, `manifest.webmanifest`, and `apple-touch-icon.png`.
- Retained earlier icon generations (`v1` to `v4`) for quick fallback.
- Version bump and Studio redeploy to `v0.4.6`.

## 0.4.5 - 2026-03-20

### Changed
- Added icon generation `v4` with larger `BK/STDO` text for improved Dock/app-launcher readability.
- Switched active PWA manifest icon references to `icon-*-v4.png`.
- Updated HTML cache-bust query strings to `?v=4` for `favicon.ico`, `manifest.webmanifest`, and `apple-touch-icon.png`.
- Kept `v1`, `v2`, and `v3` icon generations for quick fallback/switching.
- Version bump and Studio redeploy to `v0.4.5`.

## 0.4.4 - 2026-03-20

### Changed
- Added icon generation `v3` set with `STDO` acronym (`icon-180x180-v3.png`, `icon-192x192-v3.png`, `icon-512x512-v3.png`) and switched manifest references from `v2` to `v3`.
- Updated HTML cache-bust query strings to `?v=3` for `favicon.ico`, `manifest.webmanifest`, and `apple-touch-icon.png`.
- Retained `v1` and `v2` icon generations for fast rollback/switching.
- Version bump and Studio redeploy to `v0.4.4`.

## 0.4.3 - 2026-03-20

### Changed
- Refreshed BAUKLANK Studio app icon set (favicon, Apple touch icon, and PWA icon sizes 180/192/512) with the approved BK/STUDIO mark and synced deployed web assets.
- Added icon cache-busting for Chrome app installs by versioning manifest icon filenames (`*-v2.png`) and app-head icon/manifest URLs (`?v=2`).
- Restored the previous icon set as `*-v1.png` alongside current `*-v2.png` to allow fast manifest switching between icon generations.
- Removed legacy non-suffixed icon assets (`icon-180x180.png`, `icon-192x192.png`, `icon-512x512.png`) so only explicit `v1`/`v2` variants remain.
- Version bump and Studio redeploy to `v0.4.3`.

## 0.4.2 - 2026-03-20

### Changed
- Upgraded Angular patch stack to latest published 21.x releases (`@angular/core` and framework packages `21.2.5`, `@angular/cli` / `@angular/build` `21.2.3`).
- Version bump and Studio redeploy to align FE release with FW `v2.4.8`.

## 0.4.1 - 2026-03-20

### Added
- Keyboard-select auto-run behavior for Commander dropdowns: selecting via keyboard (`Enter`) now immediately runs the corresponding query for fixture, plan, or plan group.

### Changed
- Fixture modal first-open auto-query now gates on per-fixture session tracking instead of only `plan_state` null checks, preventing repeated auto-runs while still fetching once per fixture per session.
- Version bump and Studio redeploy to align FE release with FW `v2.4.8`.

## 0.4.0 - 2026-03-20

### Added
- Fixture modal auto-fires Run Query on first open when `plan_state` is absent (fixture has only been discovered, not individually queried). Subsequent reopens skip the auto-query if live data is already available in the store.
- `custom_command_ui` sliders and number inputs now initialise with live fixture state values after Run Query — `set_volumes` sliders show current per-player volumes, `play_tracks` inputs show currently active track numbers.

## 0.3.3 - 2026-03-20

### Changed
- Version bump and Studio redeploy to refresh PWA update signaling and align with API `v2.4.5`.

## 0.3.2 - 2026-03-20

### Changed
- RSSI peer table split into separate Peer and MAC columns; fixture name shown in Peer column (or `—` if not yet resolved), MAC address in its own column.

## 0.3.1 - 2026-03-19

### Added
- One-click "Update" button in the fixture detail modal for outdated fixtures — triggers a compile + OTA sequence on the API, streams progress back via SSE, and shows a success toast on completion followed by an automatic modal refresh. Button only appears when the API is running on macOS (`compile_supported: true`).
- `compile_supported` field shown in the Heartbeat details panel (true/false + platform name).

## 0.3.0 - 2026-03-19

### Added
- RSSI / Link Quality section in fixture detail modal showing quality badge, avg dBm, session duration, and per-peer table (Avg / Min / Max / Trend).
- Fixture name resolved from MAC address in RSSI peer table (e.g. BKLK_CMDR_1 alongside E8:F6:0A:36:81:E4).
- "Start RSSI session" button triggers a 20 s diagnostic session on the fixture; auto-refreshes the modal on completion.
- ESP8266 notice shown when RSSI session is unavailable on the platform.
- Section header clarifies direction: "Link Quality (what the fixture heard)".
- Passive `rssi_dbm` / `rssi_quality` fields shown in fixture modal from commander-side recording (available without running a session).

## 0.2.0 - 2026-03-19

### Changed
- Minor version bump to align with FW 2.4.0 (`compile_all_fixtures.py` tooling, `NO_PLAYER` SD card copy fix, CMDR_1 hardware swap, `ESP32C3_SUPER_MINI` enum rename). No FE code changes — bump triggers service-worker update notification for open browsers.

## 0.1.71 - 2026-03-19

### Fixed
- Auto-discovery now waits 3 s after first API success before firing, and re-checks that the
  commander is still detected. Prevents the discovery request from hitting the API before the
  serial proxy has finished its initial USB-CDC connect/boot cycle.

## 0.1.70 - 2026-03-19

### Added
- Auto-discovery on page load: when the fixture store is empty, a full discovery runs automatically
  on the first successful API connection (including after offline recovery).

## 0.1.69 - 2026-03-19

### Changed
- Version bump to sync with FW 2.3.5 (dsrdtr=False serial fix, CMDR rename, docs). No FE code
  changes — bump triggers service-worker update notification for open browsers.

## 0.1.68 - 2026-03-18

### Changed
- Version bump to sync with FW 2.3.4 (C3 TX power, reset reasons, fqbnKey, BKLK_CMDR_3). No FE
  code changes — bump triggers service-worker update notification for open browsers.

## 0.1.67 - 2026-03-18

### Fixed
- Reboot command no longer returns a false 502 error. The fixture reboots successfully but cannot
  complete the ACK handshake (it is already rebooting). Backend now dispatches `cmd;reboot` as
  fire-and-forget (`ack=False`), so `accepted` reflects dispatch confirmation rather than timing out
  waiting for a confirmation that never arrives. Listen window also reduced to 2 s for reboot.

## 0.1.66 - 2026-03-18

### Fixed
- Commander firmware version in health details now reads `commanderHealth.fw_version` (live backend
  probe value) instead of `health.release_version` (expected version). This is the authoritative
  value from the backend's own `identify` probe rather than a FE-side approximation.
- `fixtureFwStatusMap` and `selectedFixtureFwStatus`: connected commander version is now sourced from
  `health.commander.fw_version` (live probe) instead of the `release_version` workaround. The FE no
  longer substitutes "what we think should be running" — it shows what the backend actually measured.

## 0.1.65 - 2026-03-18

### Fixed
- Connected commander fixture now shows its correct firmware version in the sidebar and modal.
  The Pi-connected commander cannot query itself over the serial bus, so its discovery-reported
  version is stale; `health.release_version` is used as the authoritative override.

## 0.1.64 - 2026-03-18

### Added
- Health details: commander firmware version now shown alongside detected fixture, fqbn, and uptime.

## 0.1.63 - 2026-03-18

### Fixed
- Fixture modal shows wrong fixture name (cross-contamination fix): when `storeKeyOverride` is set,
  `plan_name` is now preserved from the existing store record instead of being overwritten by the
  payload, preventing concurrent queries from flipping fixture grouping.
- `FixtureStoreService.upsertFixtures`: incoming fixtures sharing a MAC with an existing record under
  a different name are now merged into the canonical entry instead of creating duplicate entries.

### Added
- Diagnostic `console.log` in `selectFixture` and `console.warn` in `extractFixtures` for
  fixture-identity mismatch investigations.

## 0.1.61 - 2026-03-17

### Fixed
- Reboot command now uses the recommended ACK path: `ack;tcmd;<fixture>;cmd;reboot;` per COMMAND_PROTOCOL.md.

## 0.1.60 - 2026-03-17

### Fixed
- Reboot command corrected from `R` (raw serial) to `cmd;reboot;` (proper tcmd wire payload per COMMAND_PROTOCOL.md).

## 0.1.59 - 2026-03-17

### Added
- Fixture modal: Reboot button (⏻) in header actions. First click shows "Confirm reboot" + "Cancel"; second click sends the `R` command to the fixture via `sendCommand()`. Button is disabled while a query is in-flight or Commander is unavailable.

## 0.1.58 - 2026-03-17

### Changed
- Angular updated: core/router/forms/etc 21.2.1 → 21.2.4, CLI/build 21.2.1 → 21.2.2.

## 0.1.57 - 2026-03-17

### Fixed
- Sidebar reload buttons (plan group / plan) are now disabled while any query is in-flight (`backendBusy`), in addition to when Commander is unavailable.

## 0.1.56 - 2026-03-17

### Added
- Sidebar fixture list now has a two-level hierarchy: plan_group (uppercase label) → plan_name (indented with left border). Each level has a ↻ reload button that triggers the corresponding plan-group or plan query (same as the form dropdowns on the right). Trash button remains on the plan level.

## 0.1.55 - 2026-03-17

### Changed
- Version bump for synchronized FE/FW release cycle.

## 0.1.54 - 2026-03-17

### Changed
- Health endpoint now uses the same exponential backoff on failure (3 → 6 → 12 → 24 → 30 s, capped). On success resets to the normal 30 s interval. Manual ↻ retry in the toast resets the backoff and fires immediately.

## 0.1.53 - 2026-03-17

### Fixed
- Commander SSE stream now auto-reconnects with exponential backoff (3 s → 6 s → … → 30 s max) instead of relying on the browser's unreliable native `EventSource` retry. Manual ↻ retry resets the backoff and reconnects immediately.

## 0.1.52 - 2026-03-17

### Added
- Green "Commander available" success toast on recovery — only shown when coming out of an unavailable state, never on initial page load when everything is fine.

## 0.1.51 - 2026-03-17

### Fixed
- Toasts now flush to the very top of the viewport (`top: 0 !important` overrides PrimeNG inline style).
- Grace period before showing "Commander unavailable" toast — suppressed while initial health fetch is in flight.

### Changed
- Retry link in Commander unavailable toast now uses `↻ retry` icon to match Live Commander Console style.

## 0.1.50 - 2026-03-17

### Fixed
- All toasts now appear at the top of the viewport (top: 0).
- Toasts no longer overlap: status/query-result/errors merged into one container; redundant errors suppressed when commander unavailable.
- Run buttons are disabled by default on load and during health fetch (not just after a failure).
- Toast close button is top-aligned with multi-line custom template content.

## 0.1.49 - 2026-03-17

### Changed
- Commander unavailable toast now shows live countdown to next health poll and a "retry now" link.

## 0.1.48 - 2026-03-17

### Added
- Sticky "Commander unavailable" toast when API is unreachable or commander not detected.
- All Run/Send/query buttons disabled while commander is unavailable.

## 0.1.42 - 2026-03-16

### Changed
- Version bump for update-dialog flow testing.

## 0.1.41 - 2026-03-16

### Changed
- After all "Later" deferrals are used up the dialog reappears with only "Update Now" instead of silently reloading.

## 0.1.40 - 2026-03-16

### Changed
- Removed dev-only update dialog trigger button (styling iteration complete).

## 0.1.39 - 2026-03-16

### Fixed
- Update dialog styling: moved styles from component SCSS to global styles.scss so
  descendant selectors can override PrimeNG's global h2/strong color rules without
  Angular encapsulation specificity fights. Dialog now correctly uses light theme
  (white background, dark text) matching the rest of the app.
- Added `* { color: inherit }` guard inside .update-dialog to prevent PrimeNG
  heading/element color rules from bleeding into the dialog.

### Added
- Dev-only "⚙ update dialog" button in the toolbar (only visible with `ng serve`,
  stripped from production builds) for quick local style iteration without a Pi deploy.

## 0.1.38 - 2026-03-16

### Changed
- Version bump to test update dialog styling fix.

## 0.1.37 - 2026-03-16

### Fixed
- Update dialog text color: `<h2>` header and body paragraphs were inheriting a blue
  PrimeNG heading color instead of the intended light text. Added explicit
  `color: var(--p-text-color, #e4e4e7)` to `&__header`, `&__message`, and `&__note`.

## 0.1.36 - 2026-03-16

### Changed
- Version bump to test update dialog with effect() signal tracking fix.

## 0.1.35 - 2026-03-16

### Fixed
- Update dialog effect() was not tracking showUpdateDialog signal as a dependency.
  Signal must be read before any early-return guard so Angular registers it,
  otherwise the effect never re-runs when the update becomes available.

## 0.1.34 - 2026-03-16

### Changed
- Version bump to trigger SW update detection for dialog layering test.

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
