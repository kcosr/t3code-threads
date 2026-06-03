# Smoke Tests

`mock-smoke.ts` starts a small fake T3 HTTP/WebSocket server and exercises the
CLI command path without requiring a real provider.

```bash
bun run smoke:mock
```

`live-smoke.sh` targets a real upstream T3 `serve` instance. It can use an
already-running server with a bearer session token:

```bash
export T3CODE_THREADS_LIVE_URL=http://127.0.0.1:3773
export T3CODE_THREADS_LIVE_TOKEN=...
bun run smoke:live
```

Set `RUN_TURN=1` to send a real prompt to the configured provider.

It can also start upstream T3 from an installed checkout:

```bash
T3CODE_DIR=/path/to/t3code
T3CODE_THREADS_DIR=/path/to/t3code-threads
cd "$T3CODE_DIR"
bun install --filter t3 --ignore-scripts --no-progress
cd "$T3CODE_THREADS_DIR"
T3CODE_THREADS_LIVE_START=1 bun run smoke:live
```

If upstream dependencies are not installed, auto-start mode exits before
launching the server and prints the install command.
