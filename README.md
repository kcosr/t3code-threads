# t3code-threads

`t3code-threads` is a standalone Bun/TypeScript CLI for inspecting and
controlling T3 Code threads from a terminal or another agent.

It is designed for workflows around listing recent threads, retrieving
transcript slices, checking status, creating new threads, sending follow-up
turns, waiting on active work, and archiving or renaming threads. T3 concepts
are first-class: projects, provider instances, model selections, runtime modes,
interaction modes, bearer sessions, and WebSocket orchestration streams.

The CLI talks to an already-running upstream T3 `serve` instance over HTTP for
auth/session bootstrap and WebSocket RPC for orchestration. It does not modify
T3 and it does not maintain a local thread database.

## Features

- JSON configuration for named T3 servers.
- Deterministic target selection with `--server`, `T3CODE_THREADS_SERVER`, or a
  single configured server.
- Thread list, search, detail, status, and flattened message history commands.
- Thread creation with T3 project lookup/creation by `workspaceRoot`.
- Prompted `new` and `send` commands that wait by default, stream human output,
  and support JSON final output or newline-delimited JSON streaming.
- Provider instance, model, reasoning effort, service tier, runtime mode, and
  interaction mode flags where upstream T3 supports them.
- T3 project/provider/model inspection commands.
- Thread naming, archive/unarchive, active-turn interrupt, session stop, and
  unsupported-gap reporting for concepts that upstream T3 does not expose, such
  as active-turn steering and thread goals.
- Mock and live smoke harnesses.
- Standalone Bun executable builds for local and release use.

## Upstream Target

This app targets upstream T3 main from:

```text
https://github.com/pingdotgg/t3code
```

For local development in this checkout, package workspaces point at:

```text
/home/kevin/worktrees/t3code
```

The app imports upstream `@t3tools/contracts`, `@t3tools/client-runtime`, and
`@t3tools/shared` directly. Normal CLI execution does not require
`T3CODE_THREADS_UPSTREAM`; that path is only used by the live smoke harness when
it starts a T3 server for you.

## Install

Download the latest archive for your platform from GitHub Releases:

```text
https://github.com/kcosr/t3code-threads/releases
```

Supported release platforms are currently:

- `linux-x64`
- `macos-arm64`

Install the extracted `t3code-threads` binary somewhere on your `PATH`, for
example `~/.local/bin`:

```bash
mkdir -p ~/.local/bin
install -m 755 t3code-threads ~/.local/bin/t3code-threads
t3code-threads help
```

The standalone executable still requires a running T3 server and a configured
bearer token. For unsupported platforms or local development, build from source
in the Development section near the end of this document.

## Quickstart

When asking another agent to use this CLI, point it at the included skill:

```text
skills/t3code-threads
```

Create a config:

```bash
mkdir -p ~/.config/t3code-threads
cp config.example.json ~/.config/t3code-threads/config.json
```

Example config:

```json
{
  "defaultProviderInstance": "codex",
  "defaultModel": "gpt-5.5",
  "defaultEffort": "high",
  "servers": {
    "local": {
      "httpUrl": "http://127.0.0.1:3773",
      "bearerTokenEnv": "T3CODE_THREADS_TOKEN"
    }
  }
}
```

Then omit `--server` when only one server is configured:

```bash
t3code-threads servers ping
t3code-threads providers list
t3code-threads list
t3code-threads new --cwd "$PWD" "Run the tests"
```

Or configure named servers and target one explicitly:

```bash
t3code-threads --server local list --since 24h --limit 20
```

## Starting T3

Start upstream T3:

```bash
cd /home/kevin/worktrees/t3code
bun install
cd apps/server
bun run src/bin.ts serve --host 127.0.0.1 --port 3773 /path/to/project
```

If you use upstream's built server artifact instead of the source entrypoint,
run its `serve` command with the same host, port, base directory, and workspace
root choices.

The T3 web app is served only when upstream T3 is built/configured with static
web assets or a dev URL. `t3code-threads` itself does not serve the T3 web app;
it only controls the T3 server API.

## Auth

Most data/control commands require a bearer session token. Configure one through
`bearerTokenEnv`:

```bash
export T3CODE_THREADS_TOKEN=...
```

Or exchange a one-time credential and persist the resulting bearer session in
the config:

```bash
t3code-threads auth login --server local --token ONE_TIME_TOKEN
```

Config files written by `auth login` are stored under
`~/.config/t3code-threads` with private permissions. For shared systems,
prefer `bearerTokenEnv` so the token does not live in the config file.

Check auth:

```bash
t3code-threads auth status --server local
```

`--connect http://host:port` is useful for ad hoc unauthenticated commands such
as `auth status` or for `auth login`; normal data/control commands still need a
configured server with `bearerToken` or `bearerTokenEnv`.

## Common Workflows

Find recent candidate threads, then inspect the selected thread:

```bash
t3code-threads list --since 24h --limit 20 --json
t3code-threads search "release process" --limit 10 --json
t3code-threads messages THREAD_ID --role user --last 10
t3code-threads show THREAD_ID --last 8 --items summary --json
```

Create a new T3 thread in a workspace and wait for the first turn:

```bash
t3code-threads new --cwd "$PWD" "Run the tests" --stream
```

Send a follow-up turn:

```bash
t3code-threads send THREAD_ID "Fix the failing test" --stream
```

Queue a turn without waiting:

```bash
t3code-threads send THREAD_ID "Run lint next" --no-wait --json
```

Interrupt active work or stop the provider session:

```bash
t3code-threads interrupt THREAD_ID
t3code-threads stop THREAD_ID
```

## Configuration

Default config path:

```text
~/.config/t3code-threads/config.json
```

Config path precedence:

1. `--config PATH`
2. `T3CODE_THREADS_CONFIG`
3. `~/.config/t3code-threads/config.json`

Server target precedence for commands that target one T3 server:

1. `--connect URL`
2. `--server ALIAS`
3. `T3CODE_THREADS_SERVER`
4. The single configured server, only when exactly one server exists
5. Error

When more than one server is configured, T3 commands require an explicit target
through `--server` or `T3CODE_THREADS_SERVER`. This avoids cursor merging and
prevents accidentally sending work to the wrong server. `servers ping --all` is
the only aggregate command.

Server fields:

| Field | Purpose |
| --- | --- |
| `httpUrl` | Base T3 server URL, for example `http://127.0.0.1:3773`. |
| `wsUrl` | Optional explicit WebSocket URL. Defaults to `${httpUrl}/ws` with `ws:`/`wss:`. |
| `bearerToken` | Inline bearer session token. Prefer `bearerTokenEnv` on shared systems. |
| `bearerTokenEnv` | Environment variable containing the bearer session token. |
| `defaultProviderInstance` | Provider instance used when `--provider` is omitted. |
| `defaultModel` | Model slug used when `--model` is omitted. |
| `defaultEffort` | `effort` model option used when `--effort` is omitted. |
| `defaultServiceTier` | `serviceTier` model option used when `--service-tier` is omitted. |

The `defaultProviderInstance`, `defaultModel`, `defaultEffort`, and
`defaultServiceTier` fields may be set at the top level or on a server. Server
values override top-level values.

New-thread model selection defaults:

1. `new --provider`, `new --model`, `new --effort`, and `new --service-tier`
2. The selected server's defaults, falling back to top-level config defaults
3. The matching T3 project's `defaultModelSelection`
4. The first ready provider and its first model

Follow-up `send` commands keep the thread's current model/runtime settings
unless explicit provider/model/runtime flags are passed.

## Commands

| Command | Purpose |
| --- | --- |
| `servers [--json]` | List configured server aliases without connecting. |
| `servers ping [--all] [--json]` | Connect and report reachability. |
| `auth status [--json]` | Show T3 auth/session state. |
| `auth login --token TOKEN [--json]` | Exchange a one-time credential for a bearer session. |
| `projects list [--json]` | List T3 projects. |
| `projects add PATH [--title TITLE] [--create] [--json]` | Add a T3 project. |
| `providers list [--json]` | List provider instances and auth/install status. |
| `models [--provider INSTANCE] [--json]` | List models, optionally filtered by provider instance. |
| `list` | List threads with `--limit`, `--since`, `--cwd`, `--archived`, `--sort`, `--asc`, `--desc`, `--json`. |
| `search QUERY` | Client-side search over loaded thread snapshots with list filters. |
| `show THREAD_ID` | Show thread detail and messages with `--last`, `--asc`, `--desc`, `--items summary\|full\|none`, `--json`. |
| `messages THREAD_ID` | Flatten user/assistant messages with `--last`, `--since`, `--role user\|assistant`, `--json`. |
| `new --cwd PATH [PROMPT]` | Create a thread and optionally start the first turn. |
| `send THREAD_ID PROMPT` | Start a follow-up turn. |
| `follow THREAD_ID` | Stream updates for the current/latest turn and return its terminal status. |
| `wait THREAD_ID` | Wait for the current/latest turn and return its terminal status without streaming. |
| `status [THREAD_ID]` | Show active loaded thread status or one thread's status. |
| `interrupt THREAD_ID [TURN_ID]` | Request active-turn interruption. |
| `stop THREAD_ID` | Stop the T3 provider session for the thread. |
| `name THREAD_ID NAME` | Set a thread title. |
| `archive THREAD_ID` / `unarchive THREAD_ID` | Archive or restore a thread. |
| `settings show THREAD_ID` | Show T3 thread model/runtime settings. |

Every T3 command accepts global `--config PATH`, `--server ALIAS`, and `--json`
where the command supports JSON output. Global options may be placed before or
after the subcommand.

`new` and `send` support:

- `--provider INSTANCE`
- `--model MODEL` or `--model INSTANCE/MODEL`
- `--effort VALUE`
- `--service-tier VALUE`
- `--runtime-mode approval-required|auto-accept-edits|full-access`
- `--interaction-mode default|plan`
- `--stream`
- `--no-wait`
- `--json`

`new` also supports `--cwd PATH` and `--name NAME`.

## Output

Human output is the default and is intended for terminal use.

`--json` emits a single pretty-printed JSON object for read commands,
acknowledgement commands, `--no-wait` turn commands, and blocking turn
commands. Blocking `new PROMPT --json` and `send --json` include:

- `server`
- `threadId`
- `turnId`
- `status`
- `assistantResponses`

`--json --stream` is available for `new PROMPT` and `send`. It emits NDJSON
assistant delta events and a final terminal event.

Commands that create or start work return enough follow-up identifiers:
`server`, `threadId`, `commandId`, `messageId`, and `turnId` where applicable.
`new --cwd PATH` without a prompt creates the thread and returns `threadId`;
`--stream` and `--no-wait` are invalid without a prompt.

Blocking `new PROMPT` and `send` commands wait up to one hour for the turn to
reach a terminal status. They subscribe to T3 thread streams and poll snapshots
as a fallback so callers still get a final response if an event is missed.

`follow` and `wait` currently operate on the current/latest turn state. If a
thread is idle and its latest turn is already completed, they return
`completed` immediately; they do not tail future turns indefinitely.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Command succeeded, or a blocking turn completed. |
| `1` | Runtime/server error, or a blocking turn ended interrupted/error. |
| `2` | Usage, argument, validation, or configuration error. |
| `130` | Local Ctrl-C from the shell while a command is running. |

`list --since`, `search --since`, and `messages --since` accept either an epoch
timestamp in seconds or a relative duration ending in `s`, `m`, `h`, `d`, or
`w`, such as `5m`. List and search filtering is applied client-side to T3
snapshots.

`search` loads each candidate thread detail and searches title plus message
text. If an individual thread detail cannot be loaded, search continues and
reports `skippedThreads` in JSON output or a warning in human output.

`messages` is a convenience projection over the current T3 thread snapshot. It
filters to user/assistant messages, applies `--since` and `--role`, then applies
`--last N` to the final filtered list.

## T3 Behavior And Gaps

T3-native behavior:

- `new --cwd` looks up a T3 project by `workspaceRoot`; missing projects are
  created automatically.
- `send` dispatches T3 `thread.turn.start`.
- `interrupt` dispatches T3 `thread.turn.interrupt`.
- `stop` dispatches T3 `thread.session.stop` and tears down the provider
  session.
- `name` dispatches T3 `thread.meta.update`.
- `archive` and `unarchive` dispatch T3 orchestration archive commands.

Known gaps:

- Upstream T3 does not expose active-turn steering. Use `send` for a new turn or
  `interrupt` to cancel the active turn.
- Upstream T3 does not expose thread goals.
- T3 dispatch returns command acceptance/sequence, not an immediate provider
  turn id. `new/send --no-wait` returns `commandId` and `messageId`; waited
  commands observe the thread stream and report the turn id when T3 projects it.
- Search and pagination are client-side over T3 snapshots. Cursor flags are
  accepted for now and currently return `nextCursor: null`.

## Development

Install dependencies:

```bash
bun install
```

Run the TypeScript entrypoint directly during development:

```bash
bun run src/index.ts providers list
```

Build a standalone executable that does not require Bun or a T3 checkout for
normal client commands:

```bash
bun run build:exe
./bin/t3code-threads providers list
```

To use that local build like a release binary, install it somewhere on your
`PATH`, for example:

```bash
mkdir -p ~/.local/bin
install -m 755 bin/t3code-threads ~/.local/bin/t3code-threads
```

Required checks:

```bash
bun run typecheck
bun run lint
bun run test
bun run smoke:mock
bun run build
bun run build:exe
```

Convenience commands:

```bash
bun run check
bun run verify
```

`bun run check` runs typecheck, Biome lint, and unit tests. `bun run verify`
adds mock smoke plus bundle and executable builds.

The mock smoke test starts a minimal fake T3 HTTP/WebSocket server and exercises
the CLI against it. The simple WebSocket runtime path is only a mock/smoke-test
double; production uses upstream T3's Effect RPC client runtime.

Live smoke checks are opt-in:

```bash
export T3CODE_THREADS_LIVE_URL=http://127.0.0.1:3773
export T3CODE_THREADS_LIVE_TOKEN=...
bun run smoke:live
```

The live smoke harness can also start upstream T3 itself from an installed
checkout:

```bash
cd /home/kevin/worktrees/t3code
bun install --filter t3 --ignore-scripts --no-progress
cd /home/kevin/worktrees/t3code-threads
T3CODE_THREADS_LIVE_START=1 bun run smoke:live
```

By default, live smoke avoids sending a model prompt. Set `RUN_TURN=1` to create
a prompted turn with the configured provider and wait for completion:

```bash
RUN_TURN=1 bun run smoke:live
```

## Release

Releases are driven from `package.json` and `CHANGELOG.md`. `0.1.0` is the
first release version for this repository.

For the first release, after the `Unreleased` changelog section is complete and
`main` is clean:

```bash
node scripts/release.mjs current
```

For later releases, use `patch`, `minor`, `major`, or an explicit semantic
version:

```bash
node scripts/release.mjs patch
node scripts/release.mjs minor
node scripts/release.mjs major
node scripts/release.mjs 0.2.3
```

The script verifies a clean `main` branch, optionally bumps `package.json`,
refreshes `bun.lock`, runs `bun run check`, stamps the changelog, commits
`Release vX.Y.Z`, creates and pushes a matching git tag, creates a GitHub
prerelease with notes from the changelog, then commits a fresh `Unreleased`
section for the next cycle.

Release binaries are packaged separately after the platform binaries have been
provided or built by the release operator. Build release binaries with:

```bash
bun run build:exe:linux-x64
bun run build:exe:macos-arm64
```

Expected archive names:

```text
t3code-threads-0.1.0-linux-x64.tar.gz
t3code-threads-0.1.0-macos-arm64.tar.gz
```

Each archive should contain one top-level directory named
`t3code-threads-VERSION-PLATFORM` with:

- `t3code-threads` - executable binary for that platform
- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `config.example.json`
- `skills/`

Example packaging flow for one platform:

```bash
VERSION=0.1.0
PLATFORM=linux-x64
BINARY=bin/release/t3code-threads-linux-x64

STAGE="$(mktemp -d)"
ROOT="t3code-threads-${VERSION}-${PLATFORM}"
mkdir -p "$STAGE/$ROOT"
install -m 755 "$BINARY" "$STAGE/$ROOT/t3code-threads"
cp README.md LICENSE CHANGELOG.md config.example.json "$STAGE/$ROOT/"
cp -R skills "$STAGE/$ROOT/"
tar -C "$STAGE" -czf "${ROOT}.tar.gz" "$ROOT"
rm -rf "$STAGE"
```

Repeat that staging step for each platform. After the GitHub release exists,
upload the archives:

```bash
RELEASE_TAG="v${VERSION}"
gh release upload "$RELEASE_TAG" \
  "t3code-threads-${VERSION}-linux-x64.tar.gz" \
  "t3code-threads-${VERSION}-macos-arm64.tar.gz"
```

## Project Structure

- `src/index.ts` - CLI entrypoint.
- `src/commands.ts` - subcommand parsing and command orchestration.
- `src/t3.ts` - T3 HTTP/WebSocket helpers, model selection, dispatch, and turn
  waiting.
- `src/runtime.ts` - upstream T3 RPC runtime wrapper plus mock smoke runtime.
- `src/config.ts` - JSON config schema, validation, and target resolution.
- `src/render.ts` - human and JSON output rendering.
- `test/` - deterministic Bun unit tests.
- `smoke/` - mock and opt-in live smoke harnesses.
- `scripts/` - release automation.
- `skills/` - assistant guidance for using this CLI from other agent sessions.

## Related

For a similar control CLI targeting Codex app-server threads, see
[`codex-threads`](https://github.com/kcosr/codex-threads).
