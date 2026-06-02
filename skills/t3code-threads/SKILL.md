---
name: t3code-threads
description: Use `t3code-threads` to search, inspect, summarize, message, and control T3 Code threads. Use this when the user asks about recent T3 Code work, project status over a time window, what happened in another T3 thread, or wants to send/follow up with a T3 thread.
---

# t3code-threads

Use `t3code-threads` to query and control T3 Code threads through a running
upstream T3 `serve` instance.

The executable is normally on `PATH`:

```bash
t3code-threads
```

The user normally has config at `~/.config/t3code-threads/config.json`, so do
not pass `--connect` unless debugging or explicitly targeting another server.

`t3code-threads` talks to T3 over HTTP plus WebSocket orchestration streams. A
T3 server must already be running, for example:

```bash
cd /home/kevin/worktrees/t3code
bun install
cd apps/server
bun run src/bin.ts serve --host 127.0.0.1 --port 3773 /path/to/project
```

Most commands require a bearer session token configured with `bearerTokenEnv` or
stored by `auth login`.

## First Checks

Verify connectivity and auth when server state is uncertain:

```bash
t3code-threads servers ping
t3code-threads auth status
```

Check T3 provider/project/model state before starting work:

```bash
t3code-threads providers list
t3code-threads projects list
t3code-threads models
```

Use `--json` whenever you need exact IDs, cwd/workspace root, provider instance,
model, timestamps, status, or reliable parsing.

## Core Commands

```bash
t3code-threads list --limit 20
t3code-threads search "query" --limit 20
t3code-threads show <thread_id>
t3code-threads messages <thread_id>
t3code-threads status <thread_id>
t3code-threads send <thread_id> "follow-up message"
t3code-threads new --cwd /abs/path "initial prompt"
```

## Recommended Investigation Workflow

For an agent, prefer this split:

1. Discover with JSON.
   Use `list` or `search --json` to find candidate thread IDs and disambiguate by
   title, project, workspace root, status, and updated time.
2. Read recent context with human output.
   Once a thread is selected, use `messages` without `--json` for readable recent
   conversation context. Prefer `--last N` for the final number of messages.
3. Use JSON or `show` again for exact fields.
   Use `--json` when you need model/runtime settings, raw message structure, or
   exact machine parsing.

Example:

```bash
t3code-threads search --json --limit 10 "release process" \
  | jq '{threads:[.threads[] | {id,title,projectId,updatedAt}]}'

t3code-threads messages <thread_id> --last 6
```

## Recent Work / Project Status Workflow

Prefer `--since` when the user gives a recent time window:

```bash
t3code-threads list --since 24h --limit 100 --json
```

`--since` accepts epoch seconds or relative durations ending in `s`, `m`, `h`,
`d`, or `w`; it does not accept calendar dates such as `2026-06-01`.

Group by project/workspace when summarizing:

```bash
t3code-threads list --since 24h --limit 100 --json \
  | jq -r '.threads[] | [.updatedAt, .id, (.title // ""), (.projectId // ""), (.status // "")] | @tsv'
```

Before sending a follow-up, check whether the thread is active:

```bash
t3code-threads status <thread_id> --json
```

If active, do not send disruptive follow-ups unless the user clearly asked for
that. T3 does not expose active-turn steering; use `send` for a new turn or
`interrupt` to cancel active work.

## Sending Follow-ups

Choose wait behavior from the user's wording:

- If the user says ask the thread something, wait for the response.
- If the user says tell the thread something, send it with `--no-wait`.
- If the wording is ambiguous and the distinction matters, ask before sending.

Wait for a response:

```bash
t3code-threads send <thread_id> "message" --json
```

Fire-and-forget:

```bash
t3code-threads send <thread_id> "message" --no-wait --json
```

For multiline messages, write to a temp file and command-substitute it:

```bash
cat > /tmp/t3code-followup.txt <<'MSG'
Your multiline message here.
MSG

t3code-threads send <thread_id> "$(cat /tmp/t3code-followup.txt)" --json
```

## Creating New Threads

Always pass an absolute cwd:

```bash
t3code-threads new --cwd /home/kevin/worktrees/<repo> "Prompt here"
```

Optional flags:

```bash
--provider <instance>
--model <model> or --model <instance>/<model>
--effort <value>
--service-tier <tier>
--runtime-mode approval-required|auto-accept-edits|full-access
--interaction-mode default|plan
--name "Readable name"
--stream
--no-wait
--json
```

`new --cwd PATH` without a prompt creates a thread only. `--stream` and
`--no-wait` require a prompt.

## Compact JSON Patterns

Recent thread list:

```bash
t3code-threads list --limit 20 --json \
  | jq '{threads:[.threads[] | {id,title,projectId,updatedAt,status}]}'
```

Search results:

```bash
t3code-threads search --limit 10 --json "query" \
  | jq '{threads:[.threads[] | {id,title,projectId,updatedAt}]}'
```

Recent user messages:

```bash
t3code-threads messages <thread_id> --role user --last 10 --json \
  | jq -r '.messages[] | "--- user\n" + (.text // "")'
```

## Command Shape Notes

- `list --json` returns `{ server, threads, nextCursor }`.
- `search --json` returns `{ server, query, threads, skippedThreads, nextCursor }`.
- `show --json` returns `{ server, thread, messages }`.
- `messages --json` returns `{ server, threadId, messages }`.
- `status --json` returns loaded thread state, or one thread when a thread ID is
  passed.
- `settings show <thread_id> --json` returns model/runtime settings.
- T3 search and pagination are client-side over T3 snapshots; cursor fields may
  be `null`.

## Avoid

- Do not dump large raw JSON blobs to the user; summarize in compact tables.
- Do not rely on stale candidate IDs without checking title/project/status.
- Do not send to an active thread without considering whether it will confuse
  current work.
- Do not use `--connect` by default; config normally handles the main server.
- Do not invent goal or active-turn steering commands; upstream T3 does not
  expose those concepts.
