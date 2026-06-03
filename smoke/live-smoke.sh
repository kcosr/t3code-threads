#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${T3CODE_THREADS_UPSTREAM:-/home/kevin/worktrees/t3code}"
URL="${T3CODE_THREADS_LIVE_URL:-http://127.0.0.1:${T3CODE_THREADS_LIVE_PORT:-3773}}"
TOKEN="${T3CODE_THREADS_LIVE_TOKEN:-}"
START_T3="${T3CODE_THREADS_LIVE_START:-0}"
RUN_TURN="${RUN_TURN:-0}"

WORKDIR="$(mktemp -d)"
CONFIG="$WORKDIR/config.json"
PROJECT_DIR="$WORKDIR/project"
BASE_DIR="$WORKDIR/t3-home"
SERVER_PID=""
mkdir -p "$PROJECT_DIR" "$BASE_DIR"

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -f "$WORKDIR/t3-serve.log" ]; then
    echo "Upstream T3 server log:" >&2
    sed -n '1,220p' "$WORKDIR/t3-serve.log" >&2 || true
  fi
  if [ -n "$SERVER_PID" ]; then
    kill -TERM "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    kill -KILL "-$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKDIR"
  exit "$status"
}
trap cleanup EXIT

run() {
  echo "+ $*" >&2
  "$@"
}

assert_contains() {
  local value="$1"
  local expected="$2"
  local label="$3"
  if ! grep -Fq "$expected" <<<"$value"; then
    echo "$label did not include: $expected" >&2
    echo "$value" >&2
    exit 1
  fi
}

json_escape() {
  bun -e 'console.log(JSON.stringify(process.argv.at(-1)).slice(1, -1))' "$1"
}

wait_for_server() {
  local deadline=$((SECONDS + 90))
  until curl -fsS "$URL/api/auth/session" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for upstream T3 at $URL." >&2
      echo "Server log:" >&2
      sed -n '1,160p' "$WORKDIR/t3-serve.log" >&2 || true
      exit 1
    fi
    sleep 1
  done
}

if [ "$START_T3" = "1" ]; then
  if [ ! -d "$UPSTREAM/node_modules" ]; then
    echo "Upstream T3 dependencies are not installed at $UPSTREAM/node_modules." >&2
    echo "Run: cd $UPSTREAM && bun install --filter t3 --ignore-scripts --no-progress" >&2
    echo "Then retry: T3CODE_THREADS_LIVE_START=1 bun run smoke:live" >&2
    exit 2
  fi
  PORT="${T3CODE_THREADS_LIVE_PORT:-3773}"
  URL="http://127.0.0.1:$PORT"
  TOKEN="$(
    cd "$UPSTREAM/apps/server"
    bun run src/bin.ts auth session issue --base-dir "$BASE_DIR" --role owner --token-only
  )"
  setsid bash -c 'cd "$1" && exec bun run src/bin.ts serve --base-dir "$2" --host 127.0.0.1 --port "$3" "$4"' \
    bash "$UPSTREAM/apps/server" "$BASE_DIR" "$PORT" "$PROJECT_DIR" >"$WORKDIR/t3-serve.log" 2>&1 &
  SERVER_PID="$!"
  wait_for_server
elif [ -z "$TOKEN" ]; then
  echo "Set T3CODE_THREADS_LIVE_TOKEN to a bearer session token, or set T3CODE_THREADS_LIVE_START=1 to start upstream T3 from an installed checkout." >&2
  exit 2
fi

HTTP_URL_ESCAPED="$(json_escape "$URL")"
TOKEN_ESCAPED="$(json_escape "$TOKEN")"
cat >"$CONFIG" <<JSON
{
  "defaultProviderInstance": "codex",
  "defaultModel": "gpt-5.5",
  "servers": {
    "live": {
      "httpUrl": "$HTTP_URL_ESCAPED",
      "bearerToken": "$TOKEN_ESCAPED"
    }
  }
}
JSON

cd "$ROOT"
run bun run src/index.ts --config "$CONFIG" servers ping --server live
run bun run src/index.ts --config "$CONFIG" auth status --server live
run bun run src/index.ts --config "$CONFIG" providers list --server live
run bun run src/index.ts --config "$CONFIG" models --server live --provider codex
run bun run src/index.ts --config "$CONFIG" projects list --server live
THREAD_JSON="$(run bun run src/index.ts --config "$CONFIG" new --server live --cwd "$PROJECT_DIR" --name "t3code-threads live smoke" --json)"
THREAD_ID="$(printf '%s' "$THREAD_JSON" | bun -e 'let s=""; for await (const c of Bun.stdin.stream()) s += Buffer.from(c).toString(); console.log(JSON.parse(s).threadId);')"
run bun run src/index.ts --config "$CONFIG" status --server live "$THREAD_ID"
run bun run src/index.ts --config "$CONFIG" settings show --server live "$THREAD_ID"
run bun run src/index.ts --config "$CONFIG" name --server live "$THREAD_ID" "t3code-threads live smoke renamed"
run bun run src/index.ts --config "$CONFIG" archive --server live "$THREAD_ID"
run bun run src/index.ts --config "$CONFIG" unarchive --server live "$THREAD_ID"

if [ "$RUN_TURN" = "1" ]; then
  FIRST_TURN="$(
    run bun run src/index.ts --config "$CONFIG" send --server live "$THREAD_ID" \
      "Reply with exactly: t3code-threads live smoke ok" --stream
  )"
  assert_contains "$FIRST_TURN" "t3code-threads live smoke ok" "first live turn"
  assert_contains "$FIRST_TURN" "status    completed" "first live turn status"

  SECOND_TURN="$(
    run bun run src/index.ts --config "$CONFIG" send --server live "$THREAD_ID" \
      "Reply with exactly: t3code-threads live smoke followup ok" --stream
  )"
  assert_contains "$SECOND_TURN" "t3code-threads live smoke followup ok" "second live turn"
  assert_contains "$SECOND_TURN" "status    completed" "second live turn status"

  HISTORY="$(run bun run src/index.ts --config "$CONFIG" messages --server live "$THREAD_ID" --last 4)"
  assert_contains "$HISTORY" "t3code-threads live smoke ok" "live message history"
  assert_contains "$HISTORY" "t3code-threads live smoke followup ok" "live message history"

  WAIT_JSON="$(run bun run src/index.ts --config "$CONFIG" wait --server live "$THREAD_ID" --json)"
  printf '%s' "$WAIT_JSON" | bun -e '
    let s = "";
    for await (const c of Bun.stdin.stream()) s += Buffer.from(c).toString();
    const parsed = JSON.parse(s);
    if (parsed.status !== "completed") {
      console.error(`expected completed wait status, got ${parsed.status}`);
      process.exit(1);
    }
  '
fi

echo "live smoke ok"
