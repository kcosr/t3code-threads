import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type WsData = { readonly id: string };
type JsonRecord = Record<string, unknown>;
type ThreadSubscriber = {
  readonly ws: Bun.ServerWebSocket<WsData>;
  readonly requestId: string;
};
type SmokeThread = JsonRecord & {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly modelSelection: JsonRecord;
  readonly runtimeMode: string;
  readonly interactionMode: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly latestTurn: JsonRecord | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly messages: JsonRecord[];
  readonly proposedPlans: JsonRecord[];
  readonly activities: JsonRecord[];
  readonly checkpoints: JsonRecord[];
  readonly session: JsonRecord | null;
};

const now = "2026-06-02T12:00:00.000Z";
let sequence = 1;
const threadSubscribers = new Map<string, ThreadSubscriber>();
const project = {
  id: "project-smoke",
  title: "smoke",
  workspaceRoot: "/tmp/t3code-threads-smoke",
  defaultModelSelection: { instanceId: "codex", model: "gpt-5.5" },
  scripts: [],
  createdAt: now,
  updatedAt: now,
} satisfies JsonRecord;
let thread: SmokeThread = {
  id: "thread-smoke",
  projectId: project.id,
  title: "smoke thread",
  modelSelection: { instanceId: "codex", model: "gpt-5.5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
  messages: [
    {
      id: "message-user",
      role: "user",
      text: "hello",
      turnId: "turn-smoke",
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "message-assistant",
      role: "assistant",
      text: "hi from mock",
      turnId: "turn-smoke",
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const server = Bun.serve<WsData>({
  port: 0,
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const id = crypto.randomUUID();
      if (server.upgrade(request, { data: { id } })) return undefined;
      return new Response("upgrade failed", { status: 400 });
    }
    if (url.pathname === "/api/auth/session") {
      return Response.json({
        authenticated: true,
        auth: {
          policy: "loopback-browser",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["bearer-session-token"],
          sessionCookieName: "t3_session",
        },
        role: "owner",
        sessionMethod: "bearer-session-token",
      });
    }
    if (url.pathname === "/api/auth/bootstrap/bearer") {
      return Response.json({
        authenticated: true,
        role: "owner",
        sessionMethod: "bearer-session-token",
        expiresAt: now,
        sessionToken: "mock-session-token",
      });
    }
    if (url.pathname === "/api/auth/ws-token") {
      return Response.json({ token: "mock-ws-token", expiresAt: now });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    message(ws, raw) {
      const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
      const request = JSON.parse(text) as {
        readonly _tag?: string;
        readonly id?: string;
        readonly requestId?: string;
        readonly tag?: string;
        readonly payload?: unknown;
      };
      if (request._tag === "Interrupt" && request.requestId) {
        threadSubscribers.delete(request.requestId);
        return;
      }
      if (request._tag !== "Request" || !request.id || !request.tag) return;
      switch (request.tag) {
        case "server.getConfig":
          return exit(ws, request.id, serverConfig());
        case "orchestration.subscribeShell":
          return chunk(ws, request.id, [{ kind: "snapshot", snapshot: shellSnapshot() }]);
        case "orchestration.getArchivedShellSnapshot":
          return exit(ws, request.id, { ...shellSnapshot(), threads: thread.archivedAt ? [shellThread()] : [] });
        case "orchestration.subscribeThread":
          threadSubscribers.set(request.id, { ws, requestId: request.id });
          return chunk(ws, request.id, [threadSnapshotItem()]);
        case "orchestration.dispatchCommand":
          applyCommand(request.payload);
          return exit(ws, request.id, { sequence });
        default:
          return exit(ws, request.id, {});
      }
    },
    close(ws) {
      for (const [requestId, subscriber] of threadSubscribers) {
        if (subscriber.ws === ws) threadSubscribers.delete(requestId);
      }
    },
  },
});

try {
  const dir = await mkdtemp(join(tmpdir(), "t3code-threads-smoke-"));
  const configPath = join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        defaultProviderInstance: "codex",
        defaultModel: "gpt-5.5",
        servers: {
          mock: {
            httpUrl: `http://127.0.0.1:${server.port}`,
            bearerToken: "mock-session-token",
          },
        },
      },
      null,
      2,
    ),
  );

  await run(configPath, ["servers", "ping"]);
  const completionHelp = await run(configPath, ["completion", "bash"]);
  assertIncludes(completionHelp.stdout, "source <(t3code-threads completion script bash)", "completion instructions");
  const completionScript = await run(configPath, ["completion", "script", "bash"]);
  assertIncludes(
    completionScript.stdout,
    "complete -F _t3code_threads_completion t3code-threads",
    "bash completion script",
  );
  const listCompletion = await run(configPath, ["__complete", "--", "l"]);
  assertIncludes(listCompletion.stdout, "list\n", "top-level completion");
  const serverCompletion = await run(configPath, [
    "__complete",
    "--",
    "mo",
    "--config",
    configPath,
    "list",
    "--server",
  ]);
  assertIncludes(serverCompletion.stdout, "mock\n", "server completion");
  await run(configPath, ["auth", "status"]);
  await run(configPath, ["models"]);
  await run(configPath, ["providers", "list"]);
  await run(configPath, ["projects", "list"]);
  await run(configPath, ["list"]);
  await run(configPath, ["show", "thread-smoke"]);
  await run(configPath, ["messages", "thread-smoke", "--last", "2"]);
  await run(configPath, ["name", "thread-smoke", "renamed"]);
  await run(configPath, ["interrupt", "thread-smoke"]);
  await run(configPath, ["stop", "thread-smoke"]);
  await run(configPath, ["archive", "thread-smoke"]);
  await run(configPath, ["unarchive", "thread-smoke"]);
  await run(configPath, ["new", "--cwd", "/tmp/t3code-threads-smoke", "--name", "created", "--json"]);

  const completed = await run(configPath, ["send", thread.id, "mock complete", "--stream"]);
  assertIncludes(completed.stdout, "status    completed", "completed turn status");

  const silent = await run(configPath, ["send", thread.id, "mock silent"]);
  assertIncludes(silent.stdout, "status    completed", "silent ended turn status");

  const interrupted = await run(configPath, ["send", thread.id, "mock interrupt"], { expectedExitCode: 1 });
  assertIncludes(interrupted.stdout, "status    interrupted", "interrupted turn status");

  const errored = await run(configPath, ["send", thread.id, "mock error"], { expectedExitCode: 1 });
  assertIncludes(errored.stdout, "status    error", "error turn status");

  await rm(dir, { recursive: true, force: true });
  console.log("mock smoke ok");
} finally {
  server.stop(true);
}

function serverConfig() {
  return {
    providers: [
      {
        instanceId: "codex",
        driver: "codex",
        enabled: true,
        installed: true,
        version: "mock",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: now,
        models: [{ slug: "gpt-5.5", name: "GPT 5.5", isCustom: false, capabilities: null }],
        slashCommands: [],
        skills: [],
      },
    ],
  };
}

function shellSnapshot() {
  return {
    snapshotSequence: sequence,
    projects: [project],
    threads: thread.archivedAt ? [] : [shellThread()],
    updatedAt: now,
  };
}

function threadSnapshotItem() {
  return { kind: "snapshot", snapshot: { snapshotSequence: sequence, thread } };
}

function emitThreadSnapshot() {
  const item = threadSnapshotItem();
  for (const [requestId, subscriber] of threadSubscribers) {
    if (subscriber.ws.readyState === WebSocket.OPEN) {
      chunk(subscriber.ws, requestId, [item]);
    } else {
      threadSubscribers.delete(requestId);
    }
  }
}

function shellThread() {
  const {
    messages: _messages,
    proposedPlans: _plans,
    activities: _activities,
    checkpoints: _checkpoints,
    deletedAt: _deletedAt,
    ...shell
  } = thread;
  return {
    ...shell,
    latestUserMessageAt: now,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function applyCommand(command: unknown) {
  if (!isRecord(command) || typeof command.type !== "string") return;
  sequence += 1;
  if (command.type === "thread.meta.update" && command.title) {
    thread = { ...thread, title: stringValue(command.title) ?? thread.title, updatedAt: now };
  } else if (command.type === "thread.archive") {
    thread = { ...thread, archivedAt: now, updatedAt: now };
  } else if (command.type === "thread.unarchive") {
    thread = { ...thread, archivedAt: null, updatedAt: now };
  } else if (command.type === "thread.session.stop") {
    thread = {
      ...thread,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: now,
      },
    };
  } else if (command.type === "thread.create") {
    thread = {
      ...thread,
      id: stringValue(command.threadId) ?? thread.id,
      title: stringValue(command.title) ?? thread.title,
      modelSelection: isRecord(command.modelSelection) ? command.modelSelection : thread.modelSelection,
      messages: [],
      archivedAt: null,
      updatedAt: now,
    };
  } else if (command.type === "thread.turn.start") {
    applyTurnStartCommand(command);
  }
}

function applyTurnStartCommand(command: JsonRecord) {
  const message = isRecord(command.message) ? command.message : {};
  const threadId = stringValue(command.threadId) ?? thread.id;
  const prompt = stringValue(message.text) ?? "";
  const messageId = stringValue(message.messageId) ?? `message-user-${sequence}`;
  const turnId = `turn-mock-${sequence}`;
  const createdThread = isRecord(command.bootstrap)
    ? isRecord(command.bootstrap.createThread)
      ? command.bootstrap.createThread
      : undefined
    : undefined;
  if (createdThread) {
    thread = {
      ...thread,
      id: threadId,
      title: stringValue(createdThread.title) ?? (prompt || thread.title),
      projectId: stringValue(createdThread.projectId) ?? thread.projectId,
      modelSelection: isRecord(createdThread.modelSelection) ? createdThread.modelSelection : thread.modelSelection,
      runtimeMode: stringValue(createdThread.runtimeMode) ?? thread.runtimeMode,
      interactionMode: stringValue(createdThread.interactionMode) ?? thread.interactionMode,
      messages: [],
      latestTurn: null,
      archivedAt: null,
      updatedAt: now,
    };
  }

  thread = {
    ...thread,
    id: threadId,
    messages: [
      ...thread.messages,
      {
        id: messageId,
        role: "user",
        text: prompt,
        turnId: null,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    latestTurn: {
      turnId,
      state: "running",
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      assistantMessageId: null,
    },
    session: session("running", turnId),
    updatedAt: now,
  };
  emitThreadSnapshot();

  if (prompt === "mock interrupt") {
    thread = { ...thread, latestTurn: null, session: session("interrupted"), updatedAt: now };
  } else if (prompt === "mock error") {
    thread = { ...thread, latestTurn: null, session: session("error", null, "mock failure"), updatedAt: now };
  } else if (prompt === "mock silent") {
    thread = { ...thread, latestTurn: null, session: session("ready"), updatedAt: now };
  } else {
    const assistantMessageId = `message-assistant-${sequence}`;
    thread = {
      ...thread,
      messages: [
        ...thread.messages,
        {
          id: assistantMessageId,
          role: "assistant",
          text: `${prompt} ok`,
          turnId,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        assistantMessageId,
      },
      session: session("ready"),
      updatedAt: now,
    };
  }
  emitThreadSnapshot();
}

function session(status: string, activeTurnId?: string | null, lastError?: string | null): JsonRecord {
  return {
    threadId: thread.id,
    status,
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: activeTurnId ?? null,
    lastError: lastError ?? null,
    updatedAt: now,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function chunk(ws: Bun.ServerWebSocket<WsData>, requestId: string, values: unknown[]) {
  ws.send(JSON.stringify({ _tag: "Chunk", requestId, values }));
}

function exit(ws: Bun.ServerWebSocket<WsData>, requestId: string, value: unknown) {
  ws.send(JSON.stringify({ _tag: "Exit", requestId, exit: { _tag: "Success", value } }));
}

async function run(configPath: string, args: string[], options: { readonly expectedExitCode?: number } = {}) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/index.ts", "--config", configPath, ...args],
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...Bun.env, T3CODE_THREADS_WS_CLIENT: "simple" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const expectedExitCode = options.expectedExitCode ?? 0;
  if (exitCode !== expectedExitCode) {
    console.error(stdout);
    console.error(stderr);
    throw new Error(`command exited ${exitCode}, expected ${expectedExitCode}: ${args.join(" ")}`);
  }
  return { stdout, stderr, exitCode };
}

function assertIncludes(value: string, expected: string, label: string) {
  if (!value.includes(expected)) {
    throw new Error(`${label} did not include ${JSON.stringify(expected)}:\n${value}`);
  }
}
