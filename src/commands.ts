import { basename, resolve } from "node:path";
import type {
  ClientOrchestrationCommand,
  ModelSelection,
  OrchestrationMessage,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadShell,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { ProjectId as ProjectIdSchema, ThreadId as ThreadIdSchema, TurnId as TurnIdSchema } from "@t3tools/contracts";
import {
  listConfiguredServers,
  loadConfig,
  resolveConfigPath,
  resolveTarget,
  saveConfig,
  setServerToken,
} from "./config.ts";
import { INTERACTION_MODES, RUNTIME_MODES } from "./choices.ts";
import type { BaseInput, CommandRunner } from "./command-runner.ts";
import { UsageError } from "./errors.ts";
import { commandId, messageId, projectId, threadId } from "./ids.ts";
import { printJson, printKeyValues, printMessages, printTable } from "./render.ts";
import {
  activeStatus,
  bootstrapBearerSession,
  chooseModelSelection,
  connectT3,
  dispatchCommand,
  fetchSessionState,
  findProjectForIdentifier,
  getArchivedShellSnapshot,
  getServerConfig,
  getShellSnapshot,
  getThreadSnapshot,
  waitForTurn,
} from "./t3.ts";
import { isAtOrAfter, nowIso, parseSince } from "./time.ts";
import type { AppConfig, ResolvedTarget, T3Connection } from "./types.ts";
import { requireArg, requireNoExtra, takeFlag, takeNumber, takeOption } from "./args.ts";

const SEARCH_DETAIL_CONCURRENCY = 12;

export const runCommand: CommandRunner = async (command, rawArgs, base) => {
  const configPath = resolveConfigPath(base.configPath);
  const config = await loadConfig(configPath);
  switch (command) {
    case "servers":
      return await serversCommand([...rawArgs], config, configPath, base);
    case "auth":
      return await authCommand([...rawArgs], config, configPath, base);
    case "projects":
      return await projectsCommand([...rawArgs], config, base);
    case "providers":
      return await providersCommand([...rawArgs], config, base);
    case "models":
      return await modelsCommand([...rawArgs], config, base);
    case "list":
      return await listCommand([...rawArgs], config, base);
    case "search":
      return await searchCommand([...rawArgs], config, base);
    case "show":
      return await showCommand([...rawArgs], config, base);
    case "messages":
      return await messagesCommand([...rawArgs], config, base);
    case "new":
      return await newCommand([...rawArgs], config, base);
    case "send":
      return await sendCommand([...rawArgs], config, base);
    case "follow":
      return await followCommand([...rawArgs], config, base);
    case "wait":
      return await waitCommand([...rawArgs], config, base);
    case "status":
      return await statusCommand([...rawArgs], config, base);
    case "interrupt":
      return await interruptCommand([...rawArgs], config, base);
    case "stop":
      return await stopCommand([...rawArgs], config, base);
    case "archive":
      return await archiveCommand([...rawArgs], config, base, true);
    case "unarchive":
      return await archiveCommand([...rawArgs], config, base, false);
    case "name":
      return await nameCommand([...rawArgs], config, base);
    case "settings":
      return await settingsCommand([...rawArgs], config, base);
    default:
      throw new UsageError(`unknown command ${command}`);
  }
};

async function serversCommand(args: string[], config: AppConfig, configPath: string, base: BaseInput): Promise<number> {
  const sub = args[0];
  if (sub === "ping") {
    args.shift();
    const json = takeFlag(args, "--json");
    const all = takeFlag(args, "--all");
    requireNoExtra(args);
    const targets = all
      ? Object.keys(config.servers).map((server) => resolveTarget({ config, server }))
      : [resolveTarget({ config, connect: base.connect, server: base.server })];
    const rows = [];
    for (const target of targets) {
      let connection: T3Connection | undefined;
      try {
        connection = await connectT3(target);
        await getServerConfig(connection);
        rows.push({ server: target.name, status: "ok", httpUrl: target.config.httpUrl });
      } catch (error) {
        rows.push({ server: target.name, status: "error", httpUrl: target.config.httpUrl, error: String(error) });
      } finally {
        await connection?.close().catch(() => undefined);
      }
    }
    if (json) printJson({ servers: rows });
    else if (rows.some((row) => row.status !== "ok")) {
      printTable(
        ["SERVER", "STATUS", "URL", "ERROR"],
        rows.map((row) => [row.server, row.status, row.httpUrl, row.error ?? ""]),
      );
    } else {
      printTable(
        ["SERVER", "STATUS", "URL"],
        rows.map((row) => [row.server, row.status, row.httpUrl]),
      );
    }
    return rows.some((row) => row.status !== "ok") ? 1 : 0;
  }
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  const servers = listConfiguredServers(config);
  if (json) printJson({ configPath, servers });
  else
    printTable(
      ["SERVER", "URL"],
      servers.map((server) => [server.name, server.httpUrl]),
    );
  return 0;
}

async function authCommand(args: string[], config: AppConfig, configPath: string, base: BaseInput): Promise<number> {
  const sub = args.shift() ?? "status";
  const target = resolveTarget({ config, connect: base.connect, server: base.server });
  if (sub === "status") {
    const json = takeFlag(args, "--json");
    requireNoExtra(args);
    const session = await fetchSessionState(target);
    if (json) printJson({ server: target.name, session });
    else
      printKeyValues([
        ["server", target.name],
        ["authenticated", session.authenticated ? "yes" : "no"],
        ["role", session.role ?? ""],
        ["policy", session.auth.policy],
        ["sessionMethod", session.sessionMethod ?? ""],
      ]);
    return session.authenticated ? 0 : 1;
  }
  if (sub === "login") {
    const token = takeOption(args, "--token");
    const json = takeFlag(args, "--json");
    requireNoExtra(args);
    if (!token) throw new UsageError("auth login requires --token TOKEN");
    const result = await bootstrapBearerSession({ httpUrl: target.config.httpUrl, credential: token });
    const saveInlineToken = !base.connect && target.name in config.servers && !target.config.bearerTokenEnv;
    if (saveInlineToken) {
      await saveConfig(configPath, setServerToken(config, target.name, result.sessionToken));
    }
    if (json)
      printJson({
        server: target.name,
        authenticated: true,
        role: result.role,
        sessionMethod: result.sessionMethod,
        saved: saveInlineToken,
        ...(target.config.bearerTokenEnv ? { bearerTokenEnv: target.config.bearerTokenEnv } : {}),
      });
    else
      printKeyValues([
        ["server", target.name],
        ["authenticated", "yes"],
        ["role", result.role],
        ["saved", saveInlineToken ? "yes" : "no"],
        ...(target.config.bearerTokenEnv ? ([["bearerTokenEnv", target.config.bearerTokenEnv]] as const) : []),
      ]);
    return 0;
  }
  throw new UsageError(`unknown auth subcommand ${sub}`);
}

async function projectsCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const sub = args.shift() ?? "list";
  return await withConnection(config, base, async (connection) => {
    if (sub === "list") {
      const json = takeFlag(args, "--json");
      requireNoExtra(args);
      const snapshot = await getShellSnapshot(connection);
      if (json) printJson({ server: connection.target.name, projects: snapshot.projects });
      else
        printTable(
          ["PROJECT", "TITLE", "WORKSPACE"],
          snapshot.projects.map((project) => [project.id, project.title, project.workspaceRoot]),
        );
      return 0;
    }
    if (sub === "add") {
      const json = takeFlag(args, "--json");
      const title = takeOption(args, "--title");
      const create = takeFlag(args, "--create");
      const cwd = resolve(requireArg(args, "path"));
      requireNoExtra(args);
      const serverConfig = await getServerConfig(connection);
      const selection = chooseModelSelection({ config: serverConfig, target: connection.target });
      const id = projectId();
      await dispatchCommand(connection, {
        type: "project.create",
        commandId: commandId("project-create"),
        projectId: id,
        title: title ?? (basename(cwd) || "project"),
        workspaceRoot: cwd,
        ...(create ? { createWorkspaceRootIfMissing: true } : {}),
        defaultModelSelection: selection,
        createdAt: nowIso(),
      });
      return accepted(json, { server: connection.target.name, projectId: id, status: "accepted" });
    }
    throw new UsageError(`unknown projects subcommand ${sub}`);
  });
}

async function providersCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const sub = args.shift() ?? "list";
  if (sub !== "list") throw new UsageError(`unknown providers subcommand ${sub}`);
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const serverConfig = await getServerConfig(connection);
    if (json) printJson({ server: connection.target.name, providers: serverConfig.providers });
    else
      printTable(
        ["INSTANCE", "DRIVER", "STATUS", "AUTH", "MODELS"],
        serverConfig.providers.map((provider) => [
          provider.instanceId,
          provider.driver,
          provider.status,
          provider.auth?.status ?? "",
          String(provider.models.length),
        ]),
      );
    return 0;
  });
}

async function modelsCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const json = takeFlag(args, "--json");
  const providerFilter = takeOption(args, "--provider");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const serverConfig = await getServerConfig(connection);
    const providers = providerFilter
      ? serverConfig.providers.filter((provider) => provider.instanceId === providerFilter)
      : serverConfig.providers;
    const models = providers.flatMap((provider) =>
      provider.models.map((model) => ({ provider: provider.instanceId, driver: provider.driver, ...model })),
    );
    if (json) printJson({ server: connection.target.name, models });
    else
      printTable(
        ["PROVIDER", "MODEL", "NAME"],
        models.map((model) => [model.provider, model.slug, model.name]),
      );
    return 0;
  });
}

async function listCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const options = listOptions(args);
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const snapshot = options.archived ? await getArchivedShellSnapshot(connection) : await getShellSnapshot(connection);
    const threads = filterThreads(snapshot.threads, options, snapshot.projects);
    if (options.json) printJson({ server: connection.target.name, threads, nextCursor: null });
    else printThreadTable(threads);
    return 0;
  });
}

async function searchCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const query = requireArg(args, "query").toLowerCase();
  const options = listOptions(args);
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const snapshot = options.archived ? await getArchivedShellSnapshot(connection) : await getShellSnapshot(connection);
    const loaded = await loadThreadDetails(connection, snapshot.threads);
    const details = loaded.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const skippedThreads = loaded.length - details.length;
    const matchedIds = new Set(
      details
        .filter((thread) =>
          `${thread.title}\n${thread.messages.map((message) => message.text).join("\n")}`.toLowerCase().includes(query),
        )
        .map((thread) => thread.id),
    );
    const threads = filterThreads(
      snapshot.threads.filter((thread) => matchedIds.has(thread.id)),
      options,
      snapshot.projects,
    );
    if (options.json) printJson({ server: connection.target.name, query, threads, skippedThreads, nextCursor: null });
    else {
      printThreadTable(threads);
      if (skippedThreads > 0)
        process.stderr.write(`warning: skipped ${skippedThreads} thread(s) that could not be loaded\n`);
    }
    return 0;
  });
}

async function loadThreadDetails(
  connection: T3Connection,
  threads: ReadonlyArray<OrchestrationThreadShell>,
): Promise<ReadonlyArray<PromiseSettledResult<OrchestrationThread>>> {
  const results: PromiseSettledResult<OrchestrationThread>[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(SEARCH_DETAIL_CONCURRENCY, threads.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        const thread = threads[index];
        if (!thread) return;
        try {
          results[index] = {
            status: "fulfilled",
            value: await getThreadSnapshot(connection, ThreadIdSchema.make(thread.id)),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

async function showCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const json = takeFlag(args, "--json");
  const last = takeNumber(args, "--last");
  const items = takeOption(args, "--items") ?? "summary";
  const asc = takeFlag(args, "--asc");
  takeFlag(args, "--desc");
  takeOption(args, "--cursor");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const detail = await getThreadSnapshot(connection, thread);
    const messages = sliceMessages(detail.messages, { last, asc });
    if (json) printJson({ server: connection.target.name, thread: detail, messages });
    else {
      printKeyValues([
        ["threadId", detail.id],
        ["name", detail.title],
        ["status", activeStatus(detail)],
        ["projectId", detail.projectId],
        ["model", `${detail.modelSelection.instanceId}/${detail.modelSelection.model}`],
      ]);
      if (items !== "none") {
        process.stdout.write("\n");
        printMessages(
          messages.map((message) => ({
            role: message.role,
            text: items === "full" ? JSON.stringify(message, null, 2) : message.text,
            createdAt: message.createdAt,
          })),
        );
      }
    }
    return 0;
  });
}

async function messagesCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const json = takeFlag(args, "--json");
  const last = takeNumber(args, "--last");
  const since = parseSince(takeOption(args, "--since"));
  const role = takeOption(args, "--role");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const detail = await getThreadSnapshot(connection, thread);
    let messages = detail.messages.filter((message) => message.role === "user" || message.role === "assistant");
    messages = messages.filter((message) => isAtOrAfter(message.createdAt, since));
    if (role) messages = messages.filter((message) => message.role === role);
    if (last !== undefined) messages = last <= 0 ? [] : messages.slice(-last);
    if (json) printJson({ server: connection.target.name, threadId: thread, messages });
    else printMessages(messages);
    return 0;
  });
}

async function newCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const json = takeFlag(args, "--json");
  const stream = takeFlag(args, "--stream");
  const noWait = takeFlag(args, "--no-wait");
  const cwd = resolve(takeOption(args, "--cwd") ?? process.cwd());
  const title = takeOption(args, "--name");
  const provider = takeOption(args, "--provider");
  const model = takeOption(args, "--model");
  const effort = takeOption(args, "--effort");
  const serviceTier = takeOption(args, "--service-tier");
  const runtimeMode = parseRuntimeMode(takeOption(args, "--runtime-mode"), "full-access");
  const interactionMode = parseInteractionMode(takeOption(args, "--interaction-mode"), "default");
  if (args[0] === "--") args.shift();
  const prompt = args.shift();
  requireNoExtra(args);
  if (!prompt && (stream || noWait)) throw new UsageError("new without PROMPT cannot use --stream or --no-wait");
  return await withConnection(config, base, async (connection) => {
    const serverConfig = await getServerConfig(connection);
    const shell = await getShellSnapshot(connection);
    let project = shell.projects.find((entry) => entry.workspaceRoot === cwd);
    const selection = chooseModelSelection({
      config: serverConfig,
      target: connection.target,
      projectDefault: project?.defaultModelSelection,
      provider,
      model,
      effort,
      serviceTier,
    });
    if (!project) {
      const id = projectId();
      await dispatchCommand(connection, {
        type: "project.create",
        commandId: commandId("project-create"),
        projectId: id,
        title: basename(cwd) || "project",
        workspaceRoot: cwd,
        defaultModelSelection: selection,
        createdAt: nowIso(),
      });
      project = {
        id,
        title: basename(cwd) || "project",
        workspaceRoot: cwd,
        defaultModelSelection: selection,
        scripts: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
    }
    const nextThreadId = threadId();
    const createdAt = nowIso();
    const threadTitle = title ?? promptTitle(prompt) ?? (basename(cwd) || "thread");
    if (!prompt) {
      await dispatchCommand(connection, {
        type: "thread.create",
        commandId: commandId("thread-create"),
        threadId: nextThreadId,
        projectId: ProjectIdSchema.make(project.id),
        title: threadTitle,
        modelSelection: selection,
        runtimeMode,
        interactionMode,
        branch: null,
        worktreePath: null,
        createdAt,
      });
      return accepted(json, { server: connection.target.name, threadId: nextThreadId, status: "accepted" });
    }
    const msgId = messageId();
    const command = turnStartCommand({
      threadId: nextThreadId,
      messageId: msgId,
      prompt,
      modelSelection: selection,
      runtimeMode,
      interactionMode,
      bootstrap: {
        createThread: {
          projectId: ProjectIdSchema.make(project.id),
          title: threadTitle,
          modelSelection: selection,
          runtimeMode,
          interactionMode,
          branch: null,
          worktreePath: null,
          createdAt,
        },
      },
    });
    if (noWait) {
      await dispatchCommand(connection, command);
      return accepted(json, {
        server: connection.target.name,
        threadId: nextThreadId,
        commandId: command.commandId,
        messageId: msgId,
        status: "accepted",
      });
    }
    const waited = await waitForTurn({
      connection,
      threadId: nextThreadId,
      messageId: msgId,
      stream,
      jsonStream: json && stream,
      threadMayNotExist: true,
      dispatch: async () => {
        await dispatchCommand(connection, command);
      },
    });
    return turnResult(json, stream, connection.target.name, waited);
  });
}

async function sendCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const json = takeFlag(args, "--json");
  const stream = takeFlag(args, "--stream");
  const noWait = takeFlag(args, "--no-wait");
  const provider = takeOption(args, "--provider");
  const model = takeOption(args, "--model");
  const effort = takeOption(args, "--effort");
  const serviceTier = takeOption(args, "--service-tier");
  const runtimeMode = parseRuntimeMode(takeOption(args, "--runtime-mode"));
  const interactionMode = parseInteractionMode(takeOption(args, "--interaction-mode"));
  const prompt = requireArg(args, "prompt");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const serverConfig = await getServerConfig(connection);
    const detail = await getThreadSnapshot(connection, thread);
    const selection =
      provider || model || effort || serviceTier
        ? chooseModelSelection({
            config: serverConfig,
            target: connection.target,
            projectDefault: detail.modelSelection,
            provider,
            model,
            effort,
            serviceTier,
          })
        : undefined;
    const msgId = messageId();
    const command = turnStartCommand({
      threadId: thread,
      messageId: msgId,
      prompt,
      modelSelection: selection,
      runtimeMode: runtimeMode ?? detail.runtimeMode,
      interactionMode: interactionMode ?? detail.interactionMode,
    });
    if (noWait) {
      await dispatchCommand(connection, command);
      return accepted(json, {
        server: connection.target.name,
        threadId: thread,
        commandId: command.commandId,
        messageId: msgId,
        status: "accepted",
      });
    }
    const waited = await waitForTurn({
      connection,
      threadId: thread,
      messageId: msgId,
      stream,
      jsonStream: json && stream,
      dispatch: async () => {
        await dispatchCommand(connection, command);
      },
    });
    return turnResult(json, stream, connection.target.name, waited);
  });
}

async function followCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const waited = await waitForTurn({ connection, threadId: thread, stream: !json, jsonStream: json });
    return turnResult(json, !json, connection.target.name, waited);
  });
}

async function waitCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const waited = await waitForTurn({ connection, threadId: thread });
    return turnResult(json, false, connection.target.name, waited);
  });
}

async function statusCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  if (args[0] === "--") args.shift();
  const json = takeFlag(args, "--json");
  const threadArg = args.shift();
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    if (threadArg) {
      const thread = await getThreadSnapshot(connection, ThreadIdSchema.make(threadArg));
      const output = {
        server: connection.target.name,
        threadId: thread.id,
        status: activeStatus(thread),
        activeTurnId: thread.session?.activeTurnId ?? null,
        latestTurn: thread.latestTurn,
      };
      if (json) printJson(output);
      else
        printKeyValues([
          ["status", output.status],
          ["threadId", output.threadId],
          ["activeTurnId", output.activeTurnId ?? ""],
        ]);
      return 0;
    }
    const snapshot = await getShellSnapshot(connection);
    const loadedThreadIds = snapshot.threads
      .filter((thread) => thread.session && thread.session.status !== "stopped")
      .map((thread) => thread.id);
    if (json) printJson({ server: connection.target.name, reachable: true, loadedThreadIds, nextCursor: null });
    else
      printTable(
        ["THREAD", "STATUS"],
        snapshot.threads
          .filter((thread) => loadedThreadIds.includes(thread.id))
          .map((thread) => [thread.id, activeStatus(thread)]),
      );
    return 0;
  });
}

async function interruptCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const maybeTurn = args[0] && !args[0].startsWith("--") ? TurnIdSchema.make(args.shift() as string) : undefined;
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    await dispatchCommand(connection, {
      type: "thread.turn.interrupt",
      commandId: commandId("thread-interrupt"),
      threadId: thread,
      ...(maybeTurn ? { turnId: maybeTurn } : {}),
      createdAt: nowIso(),
    });
    return accepted(json, {
      server: connection.target.name,
      threadId: thread,
      turnId: maybeTurn ?? null,
      status: "accepted",
    });
  });
}

async function stopCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    await dispatchCommand(connection, {
      type: "thread.session.stop",
      commandId: commandId("thread-stop"),
      threadId: thread,
      createdAt: nowIso(),
    });
    return accepted(json, { server: connection.target.name, threadId: thread, status: "accepted" });
  });
}

async function archiveCommand(args: string[], config: AppConfig, base: BaseInput, archived: boolean): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    await dispatchCommand(connection, {
      type: archived ? "thread.archive" : "thread.unarchive",
      commandId: commandId(archived ? "thread-archive" : "thread-unarchive"),
      threadId: thread,
    });
    return accepted(json, { server: connection.target.name, threadId: thread, archived, status: "accepted" });
  });
}

async function nameCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const title = requireArg(args, "name");
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    await dispatchCommand(connection, {
      type: "thread.meta.update",
      commandId: commandId("thread-name"),
      threadId: thread,
      title,
    });
    return accepted(json, { server: connection.target.name, threadId: thread, name: title, status: "accepted" });
  });
}

async function settingsCommand(args: string[], config: AppConfig, base: BaseInput): Promise<number> {
  const sub = args.shift();
  if (sub !== "show")
    throw new UsageError("only settings show is supported; use send/new flags to change T3 runtime/model settings");
  const thread = ThreadIdSchema.make(requireArg(args, "thread id"));
  const json = takeFlag(args, "--json");
  requireNoExtra(args);
  return await withConnection(config, base, async (connection) => {
    const detail = await getThreadSnapshot(connection, thread);
    const output = {
      server: connection.target.name,
      threadId: detail.id,
      projectId: detail.projectId,
      modelSelection: detail.modelSelection,
      runtimeMode: detail.runtimeMode,
      interactionMode: detail.interactionMode,
      branch: detail.branch,
      worktreePath: detail.worktreePath,
    };
    if (json) printJson(output);
    else
      printKeyValues([
        ["threadId", output.threadId],
        ["projectId", output.projectId],
        ["model", `${detail.modelSelection.instanceId}/${detail.modelSelection.model}`],
        ["runtimeMode", detail.runtimeMode],
        ["interactionMode", detail.interactionMode],
        ["branch", detail.branch ?? ""],
        ["worktreePath", detail.worktreePath ?? ""],
      ]);
    return 0;
  });
}

async function withConnection(
  config: AppConfig,
  base: BaseInput,
  run: (connection: T3Connection) => Promise<number>,
): Promise<number> {
  const target = resolveTarget({ config, connect: base.connect, server: base.server });
  const connection = await connectT3(target);
  try {
    return await run(connection);
  } finally {
    await connection.close();
  }
}

function listOptions(args: string[]) {
  const json = takeFlag(args, "--json");
  const archived = takeFlag(args, "--archived");
  const asc = takeFlag(args, "--asc");
  takeFlag(args, "--desc");
  const limit = takeNumber(args, "--limit");
  takeOption(args, "--cursor");
  const cwd = takeOption(args, "--cwd");
  const sort = takeOption(args, "--sort") ?? "updated";
  const since = parseSince(takeOption(args, "--since"));
  return { json, archived, asc, limit, cwd, sort, since };
}

function filterThreads(
  threads: ReadonlyArray<OrchestrationThreadShell>,
  options: ReturnType<typeof listOptions>,
  projects: OrchestrationShellSnapshot["projects"],
) {
  let result = [...threads];
  result = result.filter((thread) => (options.archived ? thread.archivedAt !== null : thread.archivedAt === null));
  if (options.cwd) {
    const cwd = resolve(options.cwd);
    const projectIds = new Set(
      projects.filter((project) => project.workspaceRoot === cwd).map((project) => project.id),
    );
    result = result.filter((thread) => projectIds.has(thread.projectId));
  }
  result = result.filter((thread) => isAtOrAfter(thread.updatedAt, options.since));
  result.sort((left, right) => {
    const leftValue = options.sort === "created" ? left.createdAt : left.updatedAt;
    const rightValue = options.sort === "created" ? right.createdAt : right.updatedAt;
    return options.asc ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
  });
  if (options.limit !== undefined) result = result.slice(0, options.limit);
  return result;
}

function printThreadTable(threads: ReadonlyArray<OrchestrationThreadShell>) {
  printTable(
    ["THREAD", "NAME", "STATUS", "UPDATED", "MODEL"],
    threads.map((thread) => [
      thread.id,
      thread.title,
      activeStatus(thread),
      thread.updatedAt,
      `${thread.modelSelection.instanceId}/${thread.modelSelection.model}`,
    ]),
  );
}

function sliceMessages(
  messages: ReadonlyArray<OrchestrationMessage>,
  options: { readonly last?: number; readonly asc?: boolean },
) {
  let result = messages.filter((message) => message.role === "user" || message.role === "assistant");
  if (!options.asc) result = [...result].reverse();
  if (options.last !== undefined) {
    result = options.last <= 0 ? [] : options.asc ? result.slice(-options.last) : result.slice(0, options.last);
  }
  if (!options.asc) result = [...result].reverse();
  return result;
}

function parseRuntimeMode(value: string | undefined, fallback: RuntimeMode): RuntimeMode;
function parseRuntimeMode(value: string | undefined, fallback?: RuntimeMode): RuntimeMode | undefined;
function parseRuntimeMode(value: string | undefined, fallback?: RuntimeMode): RuntimeMode | undefined {
  if (value === undefined) return fallback;
  if ((RUNTIME_MODES as ReadonlyArray<string>).includes(value)) return value as RuntimeMode;
  throw new UsageError(`--runtime-mode must be one of ${RUNTIME_MODES.join(", ")}`);
}

function parseInteractionMode(value: string | undefined, fallback: ProviderInteractionMode): ProviderInteractionMode;
function parseInteractionMode(
  value: string | undefined,
  fallback?: ProviderInteractionMode,
): ProviderInteractionMode | undefined;
function parseInteractionMode(
  value: string | undefined,
  fallback?: ProviderInteractionMode,
): ProviderInteractionMode | undefined {
  if (value === undefined) return fallback;
  if ((INTERACTION_MODES as ReadonlyArray<string>).includes(value)) return value as ProviderInteractionMode;
  throw new UsageError(`--interaction-mode must be one of ${INTERACTION_MODES.join(", ")}`);
}

function turnStartCommand(input: {
  readonly threadId: ThreadId;
  readonly messageId: ReturnType<typeof messageId>;
  readonly prompt: string;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly bootstrap?: unknown;
}): ClientOrchestrationCommand & { readonly commandId: string } {
  return {
    type: "thread.turn.start",
    commandId: commandId("turn-start"),
    threadId: input.threadId,
    message: {
      messageId: input.messageId,
      role: "user",
      text: input.prompt,
      attachments: [],
    },
    ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}),
    createdAt: nowIso(),
  };
}

function accepted(json: boolean, output: Record<string, unknown>): number {
  if (json) printJson(output);
  else printKeyValues(Object.entries(output));
  return 0;
}

function turnResult(
  json: boolean,
  stream: boolean,
  server: string,
  waited: {
    readonly threadId: ThreadId;
    readonly turnId: string | null;
    readonly status: string;
    readonly assistantText: string;
  },
): number {
  const output = {
    server,
    threadId: waited.threadId,
    turnId: waited.turnId,
    status: waited.status,
    assistantResponses: waited.assistantText ? [{ text: waited.assistantText }] : [],
  };
  if (json && !stream) printJson(output);
  else if (json && stream) process.stdout.write(`${JSON.stringify({ type: waited.status, ...output })}\n`);
  else {
    if (stream && waited.assistantText) process.stdout.write("\n");
    printKeyValues([
      ["status", waited.status],
      ["server", server],
      ["threadId", waited.threadId],
      ["turnId", waited.turnId ?? ""],
    ]);
  }
  return waited.status === "completed" ? 0 : 1;
}

function promptTitle(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined;
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized || undefined;
}
