# t3code-threads Agent Instructions

This repository contains `t3code-threads`, a Bun/TypeScript CLI for querying
and controlling T3 Code threads through an existing upstream T3 `serve`
instance.

## What This Repo Is

`t3code-threads` is a focused control surface over upstream T3 Code. It should
delegate projects, providers, model selection, thread history, auth, streaming,
and control operations to T3's HTTP/WebSocket contracts instead of maintaining a
separate thread index or modifying T3.

T3 concepts are first class in this repo: projects, provider instances, model
selections, runtime modes, interaction modes, bearer sessions, and WebSocket
orchestration streams.

## Fast Bootstrap

1. Install dependencies: `bun install`
2. Typecheck: `bun run typecheck`
3. Test: `bun run test`
4. Mock smoke: `bun run smoke:mock`
5. Build bundle: `bun run build`
6. Build local executable: `bun run build:exe`
7. Full local verification: `bun run verify`

## Development

- Use `bun run check` before handing off substantial source changes.
- Use `bun run verify` before release-oriented, packaging, or executable changes.
- Run `bun run smoke:mock` after command, transport, config, auth, or rendering
  changes.
- Keep live T3 smoke tests opt-in and documented under `smoke/`.
- Update `README.md` for user-facing behavior, config, command, output,
  workflow, build, or release changes.
- Update `CHANGELOG.md` under `## [Unreleased]` for changes intended to ship.
- Keep the production client path based on upstream `@t3tools/contracts` and
  `@t3tools/client-runtime`; do not fork T3 protocol shapes locally unless a
  mock/smoke fixture explicitly requires a test double.
- Prefer deterministic offline tests for argument parsing, config validation,
  model selection, event reduction, rendering, and error mapping.
- Prefer end-state implementations over transitional ones.
- Do not add backward-compatibility fallbacks, alias fields, bridge routes, or
  dual-shape parsers unless explicitly requested.
- When redesigning config or APIs, remove obsolete shapes instead of silently
  supporting both old and new contracts.

## Layout

- `src/index.ts` is the CLI entrypoint.
- `src/commands.ts` parses subcommands and orchestrates command behavior.
- `src/t3.ts` handles HTTP auth/session calls, T3 WebSocket connection setup,
  model selection, snapshots, dispatch, and turn waiting.
- `src/runtime.ts` wraps upstream T3 WebSocket RPC runtime. The simple runtime
  path is a mock/smoke-test double only.
- `src/config.ts` owns JSON config schema, validation, target resolution, and
  secure config persistence.
- `src/render.ts`, `src/args.ts`, `src/time.ts`, `src/ids.ts`, and
  `src/errors.ts` are focused helper modules.
- `test/` contains deterministic Bun unit tests.
- `smoke/` contains mock and opt-in live smoke harnesses.
- `scripts/` contains release automation.
- `skills/` contains packaged assistant guidance for using the CLI from other
  agent sessions.

## Changelog

Location: `CHANGELOG.md` at the repository root.

### Format

Use these sections under `## [Unreleased]`:

- `### Breaking Changes` - API/config changes requiring migration.
- `### Added` - New features.
- `### Changed` - Changes to existing behavior.
- `### Fixed` - Bug fixes.
- `### Removed` - Removed features.

### Rules

- New entries always go under `## [Unreleased]`.
- Append to existing subsections; do not create duplicate subsection headers.
- Do not edit already released version sections.
- Use inline PR links when a PR exists:
  `([#123](https://github.com/kcosr/t3code-threads/pull/123))`.

## Releasing

The first release version is `0.1.0`, matching `package.json`. Since the package
is already set to that version, release it with:

```bash
node scripts/release.mjs current
```

For later releases:

```bash
node scripts/release.mjs patch    # Bug fixes, e.g. 0.1.0 -> 0.1.1
node scripts/release.mjs minor    # New features, e.g. 0.1.1 -> 0.2.0
node scripts/release.mjs major    # Breaking changes, e.g. 0.2.0 -> 1.0.0
node scripts/release.mjs 0.2.3    # Explicit version
```

The release script verifies a clean `main` branch, optionally bumps
`package.json`, refreshes the Bun lockfile, runs local checks, stamps
`CHANGELOG.md`, commits and tags the release, pushes to origin, creates a GitHub
prerelease from changelog notes, then opens a new `## [Unreleased]` section for
the next cycle.

Release binaries are built and packaged manually after the GitHub release exists.
Do not add an archive automation script unless explicitly requested.
