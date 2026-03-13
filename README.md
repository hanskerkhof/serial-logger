# BAUKLANK Serial Logger App

## Contributor Skill Reference

Reusable BAUKLANK frontend guidance for this studio/operator interface lives in:

- `/Users/hanskerkhof/bauklank-agent-skills`

Relevant reusable skill:

- `bauklank-frontend-studio`

Repo-local guidance in `AGENTS.md` remains the authoritative source for repo-specific behavior.

Angular app for two control modes:

- `Direct`: Web Serial terminal for direct COMMANDER interaction.
- `Commander`: HTTP API client for CMDR endpoints (`/health`, fixture version, plan versions).

## Version

Current app version: `0.0.4`.

## Development

```bash
cd /Users/hanskerkhof/bauklank-micros/frontend/serial-logger
npm install
npm start
```

App default dev URL:

- [http://localhost:4210](http://localhost:4210)

## Routes

- `/direct`
- `/commander`

Root (`/`) redirects to `/commander`.

## Commander mode features

- API target switching (MacBook / Raspberry Pi / custom URL), persisted in localStorage.
- Default API selection: when app is served from CMDR API (for example `http://100.x.x.x:8080`), same-origin is used automatically to avoid stale cross-host targets.
- Dev mode on localhost keeps preset target selection behavior.
- Health check against selected API target.
- Query fixture version endpoint (`/fixtures/{fixture_name}/version`).
- Query plan versions endpoint (`/plans/{plan_name}/versions`).
- Runtime fixture store (signal-based, keyed by `fixture_name`).
- Left sidebar grouped by `plan_name`, sorted by plan then fixture name.
- Fixture selection modal with read-only JSON payload.
- Live Commander console (SSE) with TX/RX lines, command lifecycle events, and heartbeat.

## Backend contract used by Commander mode

For both endpoint responses:

- `GET /fixtures/{fixture_name}/version`
- `GET /plans/{plan_name}/versions`
- `GET /commander/stream` (SSE)

`summary.fixtures[]` items are expected to include:

- `fixture_name`
- `plan_name`
- `fw_version`
- `build_date`
- `build_time`

## Build

```bash
npm run build
```

Output:

- `dist/serial-logger`


## Deploy to bauklank-micros

Build and copy frontend artifacts so `CMDR_hello_api.py` can host the app:

```bash
cd /Users/hanskerkhof/bauklank-micros/frontend/serial-logger
npm run deploy:bauklank
```

Default deploy target:

- `/Users/hanskerkhof/bauklank-micros/web/serial-logger-app`

Optional override:

```bash
BAUKLANK_DEPLOY_TARGET=/custom/path npm run deploy:bauklank
```

After deploy, start API and open:

- `http://<host>:8080/`
