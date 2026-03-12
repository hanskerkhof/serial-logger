# Agent Guidelines

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

## Testing

- Prefer `npm test` for logic or UI behavior changes.
- Prefer `npm run build` for non-trivial changes and before deployment-related updates.
- For BAUKLANK releases, always run `npm run deploy:bauklank` before the root `bauklank-micros` release commit so the deployed bundle lands in `bauklank-micros/web/serial-logger-app` in that same release.
- Default deploy target is `../bauklank-micros/web/serial-logger-app` unless `BAUKLANK_DEPLOY_TARGET` overrides it.
- Before a BAUKLANK release, validate the FE repo with at least:
  - `npm run build`
  - `npm run deploy:bauklank`
