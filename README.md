# BAUKLANK Serial Logger App

Angular app for two control modes:

- `Direct`: Web Serial terminal for direct COMMANDER interaction.
- `Commander`: HTTP API client for CMDR endpoints (`/health`, fixture version, plan versions).

## Version

Current app version: `0.0.2`.

## Development

```bash
cd /Users/hanskerkhof/serial-logger-app
npm install
npm start
```

App default dev URL:

- [http://localhost:4210](http://localhost:4210)

## Routes

- `/direct`
- `/commander`

Root (`/`) redirects to `/direct`.

## Commander mode features

- API target switching (MacBook / Raspberry Pi / custom URL), persisted in localStorage.
- Health check against selected API target.
- Query fixture version endpoint (`/fixtures/{fixture_name}/version`).
- Query plan versions endpoint (`/plans/{plan_name}/versions`).
- Runtime fixture store (signal-based, keyed by `fixture_name`).
- Left sidebar grouped by `plan_name`, sorted by plan then fixture name.
- Fixture selection modal with read-only JSON payload.

## Backend contract used by Commander mode

For both endpoint responses:

- `GET /fixtures/{fixture_name}/version`
- `GET /plans/{plan_name}/versions`

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
