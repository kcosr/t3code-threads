import { applyThreadDetailEvent, createWsRpcClient, WsTransport } from "./runtime.ts";
import type {
  AuthBearerBootstrapResult,
  AuthSessionState,
  AuthWebSocketTokenResult,
  ClientOrchestrationCommand,
  ModelSelection,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadShell,
  OrchestrationThreadStreamItem,
  ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import { deriveWsUrl } from "./config.ts";
import { RuntimeError, UsageError, formatUnknownError } from "./errors.ts";
import type { ResolvedTarget, T3Connection, TurnWaitResult } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const TURN_WAIT_TIMEOUT_MS = 60 * 60 * 1000;
const THREAD_VISIBILITY_TIMEOUT_MS = 15_000;
const THREAD_VISIBILITY_POLL_MS = 150;
const TURN_WAIT_POLL_MS = 750;

export async function fetchJson<T>(input: {
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly bearerToken?: string;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(input.url, {
      method: input.method ?? "GET",
      signal: controller.signal,
      headers: {
        ...(input.bearerToken ? { Authorization: `Bearer ${input.bearerToken}` } : {}),
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new RuntimeError(`${input.url} returned ${response.status}${body ? `: ${body}` : ""}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function bootstrapBearerSession(input: {
  readonly httpUrl: string;
  readonly credential: string;
}): Promise<AuthBearerBootstrapResult> {
  return await fetchJson<AuthBearerBootstrapResult>({
    url: endpoint(input.httpUrl, "/api/auth/bootstrap/bearer"),
    method: "POST",
    body: { credential: input.credential },
  });
}

export async function fetchSessionState(target: ResolvedTarget): Promise<AuthSessionState> {
  return await fetchJson<AuthSessionState>({
    url: endpoint(target.config.httpUrl, "/api/auth/session"),
    bearerToken: target.bearerToken,
  });
}

export async function connectT3(target: ResolvedTarget): Promise<T3Connection> {
  if (!target.bearerToken) {
    throw new UsageError(`server ${target.name} has no bearer token; run auth login or configure bearerTokenEnv`);
  }
  const issued = await fetchJson<AuthWebSocketTokenResult>({
    url: endpoint(target.config.httpUrl, "/api/auth/ws-token"),
    method: "POST",
    bearerToken: target.bearerToken,
  });
  const wsUrl = new URL(deriveWsUrl(target.config.httpUrl, target.config.wsUrl));
  wsUrl.searchParams.set("wsToken", issued.token);
  const transport = new WsTransport(wsUrl.toString());
  const client = createWsRpcClient(transport);
  return {
    target,
    client,
    close: () => client.dispose(),
  };
}

export async function getServerConfig(connection: T3Connection): Promise<ServerConfig> {
  return await connection.client.server.getConfig();
}

export async function getShellSnapshot(connection: T3Connection): Promise<OrchestrationShellSnapshot> {
  return await waitForSubscription<OrchestrationShellSnapshot>((resolve, reject) => {
    const unsubscribe = connection.client.orchestration.subscribeShell(
      (item) => {
        if (item.kind === "snapshot") {
          unsubscribe();
          resolve(item.snapshot as OrchestrationShellSnapshot);
        }
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
    return { unsubscribe, reject };
  });
}

export async function getArchivedShellSnapshot(connection: T3Connection): Promise<OrchestrationShellSnapshot> {
  return await connection.client.orchestration.getArchivedShellSnapshot();
}

export async function getThreadSnapshot(connection: T3Connection, threadId: ThreadId): Promise<OrchestrationThread> {
  return await waitForSubscription<OrchestrationThread>((resolve, reject) => {
    const unsubscribe = connection.client.orchestration.subscribeThread(
      { threadId },
      (item) => {
        if (item.kind === "snapshot") {
          unsubscribe();
          resolve(item.snapshot.thread);
        }
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
    return { unsubscribe, reject };
  });
}

export async function dispatchCommand(
  connection: T3Connection,
  command: ClientOrchestrationCommand,
): Promise<{ sequence: number }> {
  return await connection.client.orchestration.dispatchCommand(command);
}

export function chooseModelSelection(input: {
  readonly config: ServerConfig;
  readonly target: ResolvedTarget;
  readonly projectDefault?: ModelSelection | null;
  readonly provider?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly serviceTier?: string;
}): ModelSelection {
  const parsedModel = parseModelFlag(input.model);
  const instanceId =
    input.provider ??
    parsedModel.instanceId ??
    input.target.config.defaultProviderInstance ??
    input.projectDefault?.instanceId ??
    firstReadyProvider(input.config)?.instanceId;
  if (!instanceId) {
    throw new UsageError("no provider instance available; pass --provider INSTANCE");
  }
  const provider = input.config.providers.find((entry) => entry.instanceId === instanceId);
  if (!provider) {
    throw new UsageError(`unknown provider instance ${instanceId}`);
  }
  const modelSlug =
    parsedModel.model ?? input.target.config.defaultModel ?? input.projectDefault?.model ?? provider.models[0]?.slug;
  if (!modelSlug) {
    throw new UsageError(`provider ${instanceId} has no models; pass --model MODEL`);
  }
  const model = provider.models.find((entry) => entry.slug === modelSlug);
  if (!model) {
    throw new UsageError(`unknown model ${modelSlug} for provider ${instanceId}`);
  }
  const options = mergeModelOptions(input.projectDefault?.options ?? [], {
    effort: input.effort ?? input.target.config.defaultEffort,
    serviceTier: input.serviceTier ?? input.target.config.defaultServiceTier,
  });
  return {
    instanceId,
    model: model.slug,
    ...(options.length > 0 ? { options } : {}),
  } as ModelSelection;
}

function mergeModelOptions(
  baseOptions: NonNullable<ModelSelection["options"]>,
  overrides: { readonly effort?: string; readonly serviceTier?: string },
): NonNullable<ModelSelection["options"]> {
  const byId = new Map(baseOptions.map((option) => [option.id, option]));
  if (overrides.effort) byId.set("effort", { id: "effort", value: overrides.effort });
  if (overrides.serviceTier) byId.set("serviceTier", { id: "serviceTier", value: overrides.serviceTier });
  return [...byId.values()];
}

export async function waitForTurn(input: {
  readonly connection: T3Connection;
  readonly threadId: ThreadId;
  readonly commandId?: string;
  readonly messageId?: string;
  readonly stream?: boolean;
  readonly jsonStream?: boolean;
  readonly dispatch?: () => Promise<void>;
  readonly threadMayNotExist?: boolean;
}): Promise<TurnWaitResult> {
  let currentThread: OrchestrationThread | null = null;
  let assistantText = "";
  let lastPrinted = "";
  let settled = false;
  let commandAccepted = input.dispatch === undefined;
  let unsubscribe: (() => void) | undefined;
  let observedTurnId: string | null = null;

  const result = await new Promise<TurnWaitResult>((resolve, reject) => {
    let pollInFlight = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new RuntimeError(`timed out waiting for thread ${input.threadId} to finish`));
    }, TURN_WAIT_TIMEOUT_MS);
    const pollTimer = setInterval(() => {
      if (!commandAccepted || settled || pollInFlight) return;
      pollInFlight = true;
      getThreadSnapshot(input.connection, input.threadId)
        .then((thread) => update(threadSnapshotItem(thread)))
        .catch(() => undefined)
        .finally(() => {
          pollInFlight = false;
        });
    }, TURN_WAIT_POLL_MS);

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      clearInterval(pollTimer);
      unsubscribe?.();
    };

    const maybeFinish = (thread: OrchestrationThread) => {
      if (!commandAccepted) return;
      const status = terminalStatus(thread, input.messageId, observedTurnId);
      if (!status) return;
      cleanup();
      resolve({
        threadId: input.threadId,
        turnId:
          observedTurnId ?? thread.latestTurn?.turnId ?? latestAssistantTurnIdAfterMessage(thread, input.messageId),
        status,
        assistantText,
      });
    };

    const update = (item: OrchestrationThreadStreamItem) => {
      if (settled) return;
      if (item.kind === "snapshot") {
        currentThread = item.snapshot.thread;
      } else if (currentThread) {
        const reduced = applyThreadDetailEvent(currentThread, item);
        if (reduced.kind === "updated") currentThread = reduced.thread;
      }
      if (!currentThread) return;
      if (input.messageId) {
        const activeTurnId = observedActiveTurnId(currentThread);
        if (activeTurnId) observedTurnId = activeTurnId;
      }
      const nextAssistantText = collectAssistantText(currentThread, input.messageId);
      if (!commandAccepted) {
        assistantText = nextAssistantText;
        lastPrinted = nextAssistantText;
        return;
      }
      if (nextAssistantText.length > assistantText.length) {
        assistantText = nextAssistantText;
        emitAssistantDelta({
          text: assistantText,
          previous: lastPrinted,
          stream: input.stream,
          jsonStream: input.jsonStream,
          threadId: input.threadId,
          turnId:
            latestAssistantTurnIdAfterMessage(currentThread, input.messageId) ??
            currentThread.latestTurn?.turnId ??
            null,
        });
        lastPrinted = assistantText;
      }
      maybeFinish(currentThread);
    };

    const subscribe = () => {
      unsubscribe = input.connection.client.orchestration.subscribeThread(
        { threadId: input.threadId },
        update,
        (error) => {
          cleanup();
          reject(error);
        },
      );
    };

    const beforeSubscribe =
      input.threadMayNotExist && input.dispatch
        ? Promise.resolve(input.dispatch()).then(() => waitForThreadVisible(input.connection, input.threadId))
        : Promise.resolve().then(subscribe);

    beforeSubscribe
      .then(() => {
        if (input.threadMayNotExist && input.dispatch) subscribe();
      })
      .then(() => (input.threadMayNotExist && input.dispatch ? undefined : input.dispatch?.()))
      .then(() => {
        commandAccepted = true;
        if (currentThread) {
          maybeFinish(currentThread);
        }
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });

  return result;
}

async function waitForThreadVisible(connection: T3Connection, threadId: ThreadId): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < THREAD_VISIBILITY_TIMEOUT_MS) {
    const snapshot = await getShellSnapshot(connection);
    if (snapshot.threads.some((thread) => thread.id === threadId)) return;
    await Bun.sleep(THREAD_VISIBILITY_POLL_MS);
  }
  throw new RuntimeError(`timed out waiting for thread ${threadId} to appear`);
}

export function findProjectForIdentifier(
  snapshot: OrchestrationShellSnapshot,
  identifier: string,
): OrchestrationShellSnapshot["projects"][number] | undefined {
  const normalized = identifier.trim();
  return snapshot.projects.find(
    (project) => project.id === normalized || project.title === normalized || project.workspaceRoot === normalized,
  );
}

export function firstReadyProvider(config: ServerConfig): ServerConfig["providers"][number] | undefined {
  return config.providers.find((provider) => provider.enabled && provider.installed && provider.status !== "disabled");
}

export function activeStatus(thread: OrchestrationThread | OrchestrationThreadShell): string {
  return thread.session?.status ?? thread.latestTurn?.state ?? "idle";
}

function endpoint(base: string, pathname: string): string {
  const url = new URL(base);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function waitForSubscription<T>(
  setup: (
    resolve: (value: T) => void,
    reject: (error: unknown) => void,
  ) => { readonly unsubscribe: () => void; readonly reject: (error: unknown) => void },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const subscriptionRef: { unsubscribe?: () => void } = {};
    const timer = setTimeout(() => {
      subscriptionRef.unsubscribe?.();
      reject(new RuntimeError("timed out waiting for T3 subscription snapshot"));
    }, DEFAULT_TIMEOUT_MS);
    const subscription = setup(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
    subscriptionRef.unsubscribe = subscription.unsubscribe;
  });
}

function parseModelFlag(value?: string): { readonly instanceId?: string; readonly model?: string } {
  if (!value) return {};
  const slash = value.indexOf("/");
  if (slash > 0) {
    return { instanceId: value.slice(0, slash), model: value.slice(slash + 1) };
  }
  return { model: value };
}

function collectAssistantText(thread: OrchestrationThread, messageId?: string): string {
  const start = messageStartIndex(thread, messageId);
  if (start === null) return "";
  const assistant = thread.messages.slice(start).filter((message) => message.role === "assistant");
  return assistant.map((message) => message.text).join("\n\n");
}

export function terminalStatus(
  thread: OrchestrationThread,
  messageId?: string,
  observedTurnId?: string | null,
): TurnWaitResult["status"] | null {
  if (messageId) return terminalStatusAfterMessage(thread, messageId, observedTurnId);
  const sessionStatus = thread.session?.status;
  if (sessionStatus === "running" || sessionStatus === "starting") return null;
  switch (thread.latestTurn?.state) {
    case "completed":
      return "completed";
    case "interrupted":
      return "interrupted";
    case "error":
      return "error";
    default:
      if (sessionStatus === "interrupted" || sessionStatus === "stopped") return "interrupted";
      if (sessionStatus === "error" || thread.session?.lastError) return "error";
      if (sessionStatus === "ready") return "completed";
      return null;
  }
}

function terminalStatusAfterMessage(
  thread: OrchestrationThread,
  messageId: string,
  observedTurnId?: string | null,
): TurnWaitResult["status"] | null {
  if (messageStartIndex(thread, messageId) === null) return null;
  if (thread.session?.status === "running" || thread.session?.status === "starting") return null;
  if (hasCompletedAssistantResponseAfterMessage(thread, messageId)) return "completed";

  const turnId =
    latestAssistantTurnIdAfterMessage(thread, messageId) ?? userMessageTurnId(thread, messageId) ?? observedTurnId;
  if (turnId && thread.latestTurn?.turnId === turnId) {
    if (thread.latestTurn.state === "completed") return "completed";
    if (thread.latestTurn.state === "interrupted") return "interrupted";
    if (thread.latestTurn.state === "error") return "error";
    if (thread.latestTurn.state === "running") return null;
  }

  if (observedTurnId && thread.session?.activeTurnId === observedTurnId) {
    if (thread.session.status === "interrupted") return "interrupted";
    if (thread.session.status === "error") return "error";
  }

  if (observedTurnId && thread.session && thread.session.activeTurnId !== observedTurnId) {
    if (thread.session.status === "interrupted") return "interrupted";
    if (thread.session.status === "error" || thread.session.lastError) return "error";
    return "completed";
  }

  return null;
}

function observedActiveTurnId(thread: OrchestrationThread): string | null {
  if (thread.session?.activeTurnId && (thread.session.status === "running" || thread.session.status === "starting")) {
    return thread.session.activeTurnId;
  }
  if (thread.latestTurn?.state === "running") {
    return thread.latestTurn.turnId;
  }
  return null;
}

function messageStartIndex(thread: OrchestrationThread, messageId?: string): number | null {
  if (!messageId) return 0;
  const index = thread.messages.findIndex((message) => message.id === messageId);
  return index < 0 ? null : index + 1;
}

function userMessageTurnId(thread: OrchestrationThread, messageId: string): string | null {
  return thread.messages.find((message) => message.id === messageId)?.turnId ?? null;
}

function hasCompletedAssistantResponseAfterMessage(thread: OrchestrationThread, messageId: string): boolean {
  const userIndex = thread.messages.findIndex((message) => message.id === messageId);
  if (userIndex < 0) return false;
  return thread.messages
    .slice(userIndex + 1)
    .some((message) => message.role === "assistant" && !message.streaming && message.text.trim().length > 0);
}

function latestAssistantTurnIdAfterMessage(thread: OrchestrationThread, messageId?: string): string | null {
  const start = messageStartIndex(thread, messageId);
  if (start === null) return null;
  const messages = thread.messages.slice(start).filter((message) => message.role === "assistant");
  return messages.at(-1)?.turnId ?? null;
}

function threadSnapshotItem(thread: OrchestrationThread): OrchestrationThreadStreamItem {
  return { kind: "snapshot", snapshot: { thread, snapshotSequence: 0 } };
}

function emitAssistantDelta(input: {
  readonly text: string;
  readonly previous: string;
  readonly stream?: boolean;
  readonly jsonStream?: boolean;
  readonly threadId: ThreadId;
  readonly turnId: string | null;
}) {
  if (!input.stream) return;
  const delta = input.text.slice(input.previous.length);
  if (!delta) return;
  if (input.jsonStream) {
    process.stdout.write(
      `${JSON.stringify({
        type: "assistant_delta",
        threadId: input.threadId,
        turnId: input.turnId,
        delta,
      })}\n`,
    );
  } else {
    process.stdout.write(delta);
  }
}

export function describeConnectionError(error: unknown): string {
  return formatUnknownError(error);
}
