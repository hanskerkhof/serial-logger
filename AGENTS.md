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
3. Add a new section to `CHANGELOG.md` — `## <version> - <date>` with `### Changed` / `### Fixed` / `### Added` bullets summarising every change since the previous release. Move items from `## Unreleased` if any exist.
4. Commit all changed files together.

## Testing

- Prefer `npm test` for logic or UI behavior changes.
- Prefer `npm run build` for non-trivial changes and before deployment-related updates.
- For BAUKLANK releases, always run `npm run deploy:bauklank` before the root `bauklank-micros` release commit so the deployed bundle lands in `bauklank-micros/web/serial-logger-app` in that same release.
- Default deploy target is `../../web/serial-logger-app` when running in-repo unless `BAUKLANK_DEPLOY_TARGET` overrides it.
- Before a BAUKLANK release, validate the FE repo with at least:
  - `npm run build`
  - `npm run deploy:bauklank`
