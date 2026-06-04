# Changelog

## [Unreleased]

### Added

- Add shell completion setup and generated bash, zsh, and fish completion
  scripts.

### Changed

- Migrate CLI command parsing to Commander while preserving practical placement
  for global `--config`, `--connect`, and `--server` options.
- Render CLI help through Commander.

### Fixed

- Improved release-script preflight checks, diagnostics, and changelog validation edge cases.
- Preserve `new -- --json` and similar prompt values that look like flags.

## [0.1.0] - 2026-06-03

### Added

- Add a repo-local `t3code-threads` assistant skill for agent-driven thread
  inspection and follow-up workflows.
- Initial `t3code-threads` release.

### Changed

- Treat T3 goal and active-turn steering as documented upstream gaps rather than
  unsupported CLI commands.
- Align documented live smoke dependency installation with `smoke/README.md`.
- Include `skills/` in documented release archive contents.
