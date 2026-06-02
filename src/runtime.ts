import {
  WsTransport as ActualWsTransport,
  applyThreadDetailEvent as applyActualThreadDetailEvent,
  createWsRpcClient as createUpstreamWsRpcClient,
} from "@t3tools/client-runtime";
import type {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadStreamItem,
  ThreadId,
} from "@t3tools/contracts";

type UpstreamWsTransport = InstanceType<typeof ActualWsTransport>;
type UpstreamWsRpcClient = ReturnType<typeof createUpstreamWsRpcClient>;
type Listener<T> = (value: T) => void;
type ErrorListener = (error: Error) => void;
type Pending = {
  readonly tag: string;
  readonly timeout?: Timer;
  readonly resolve?: (value: unknown) => void;
  readonly reject?: (error: Error) => void;
  readonly listener?: Listener<unknown>;
};
const REQUEST_TIMEOUT_MS = 60_000;

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly server: {
    readonly getConfig: () => Promise<import("@t3tools/contracts").ServerConfig>;
  };
  readonly orchestration: {
    readonly dispatchCommand: (input: ClientOrchestrationCommand) => Promise<{ readonly sequence: number }>;
    readonly getArchivedShellSnapshot: () => Promise<import("@t3tools/contracts").OrchestrationShellSnapshot>;
    readonly subscribeShell: (
      listener: Listener<{ readonly kind: "snapshot"; readonly snapshot: OrchestrationShellSnapshot }>,
      onError?: ErrorListener,
    ) => () => void;
    readonly subscribeThread: (
      input: { readonly threadId: ThreadId },
      listener: Listener<OrchestrationThreadStreamItem>,
      onError?: ErrorListener,
    ) => () => void;
  };
}

export class WsTransport {
  private readonly simple: SimpleWsTransport;
  private actualTransport: UpstreamWsTransport | undefined;

  constructor(private readonly url: string) {
    this.simple = new SimpleWsTransport(url);
  }

  getSimple(): SimpleWsTransport {
    return this.simple;
  }

  async getActual(): Promise<UpstreamWsTransport> {
    if (!this.actualTransport) {
      this.actualTransport = new ActualWsTransport(this.url);
    }
    return this.actualTransport;
  }
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  // The simple client is a lightweight test double for smoke/mock fixtures.
  // Production uses T3's upstream Effect RPC runtime.
  if (process.env.T3CODE_THREADS_WS_CLIENT === "simple") {
    return createSimpleWsRpcClient(transport.getSimple());
  }
  return createActualWsRpcClient(transport);
}

export function applyThreadDetailEvent(
  thread: OrchestrationThread,
  item: OrchestrationThreadStreamItem,
):
  | { readonly kind: "updated"; readonly thread: OrchestrationThread }
  | { readonly kind: "deleted" }
  | { readonly kind: "unchanged" } {
  if (process.env.T3CODE_THREADS_WS_CLIENT === "simple") {
    return applySimpleThreadDetailEvent(thread, item);
  }
  if (item.kind !== "event") return { kind: "unchanged" };
  return applyActualThreadDetailEvent(thread, item.event as OrchestrationEvent);
}

function createActualWsRpcClient(transport: WsTransport): WsRpcClient {
  let clientPromise: Promise<UpstreamWsRpcClient> | undefined;
  const client = async () => {
    if (!clientPromise) {
      clientPromise = transport.getActual().then((actualTransport) => createUpstreamWsRpcClient(actualTransport));
    }
    return await clientPromise;
  };
  return {
    dispose: async () => {
      if (!clientPromise) return;
      const actual = await clientPromise.catch(() => undefined);
      await actual?.dispose();
    },
    server: {
      getConfig: async () => await withTimeout((await client()).server.getConfig(), "server.getConfig"),
    },
    orchestration: {
      dispatchCommand: async (input) =>
        await withTimeout((await client()).orchestration.dispatchCommand(input), "orchestration.dispatchCommand"),
      getArchivedShellSnapshot: async () =>
        await withTimeout(
          (await client()).orchestration.getArchivedShellSnapshot(),
          "orchestration.getArchivedShellSnapshot",
        ),
      subscribeShell: (listener, onError) => {
        let unsubscribe: (() => void) | undefined;
        let closed = false;
        void client()
          .then((actual) => {
            unsubscribe = actual.orchestration.subscribeShell((item) => {
              if (item.kind === "snapshot") listener(item);
            });
            if (closed) unsubscribe();
          })
          .catch((error) => {
            if (!closed) onError?.(asError(error));
          });
        return () => {
          closed = true;
          unsubscribe?.();
        };
      },
      subscribeThread: (input, listener, onError) => {
        let unsubscribe: (() => void) | undefined;
        let closed = false;
        void client()
          .then((actual) => {
            unsubscribe = actual.orchestration.subscribeThread(input, listener);
            if (closed) unsubscribe();
          })
          .catch((error) => {
            if (!closed) onError?.(asError(error));
          });
        return () => {
          closed = true;
          unsubscribe?.();
        };
      },
    },
  };
}

function withTimeout<T>(promise: Promise<T>, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for T3 websocket response: ${tag}`));
    }, REQUEST_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

class SimpleWsTransport {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private openPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly url: string) {}

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const [id, pending] of this.pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject?.(new Error(`request interrupted: ${pending.tag}`));
      this.pending.delete(id);
    }
    this.socket?.close();
    this.socket = null;
  }

  request<T>(tag: string, payload: unknown): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for T3 websocket response: ${tag}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        tag,
        timeout,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      void this.send({ _tag: "Request", id, tag, payload }).catch((error) => {
        this.pending.delete(id);
        reject(asError(error));
      });
    });
  }

  subscribe<T>(tag: string, payload: unknown, listener: Listener<T>, onError?: ErrorListener): () => void {
    const id = crypto.randomUUID();
    this.pending.set(id, { tag, listener: listener as Listener<unknown>, reject: onError });
    void this.send({ _tag: "Request", id, tag, payload }).catch((error) => {
      this.pending.delete(id);
      onError?.(asError(error));
    });
    return () => {
      this.pending.delete(id);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ _tag: "Interrupt", requestId: id }));
      }
    };
  }

  private async send(message: unknown): Promise<void> {
    await this.ensureOpen();
    this.socket?.send(JSON.stringify(message));
  }

  private async ensureOpen(): Promise<void> {
    if (this.disposed) throw new Error("transport disposed");
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.openPromise) return await this.openPromise;
    this.openPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => {
          this.socket = null;
          this.openPromise = null;
          reject(new Error("failed to open T3 websocket"));
        },
        { once: true },
      );
      socket.addEventListener("message", (event) => {
        void this.handleMessage(event.data).catch((error) => this.rejectAll(asError(error)));
      });
      socket.addEventListener("close", () => {
        this.socket = null;
        this.openPromise = null;
      });
    });
    await this.openPromise;
  }

  private async handleMessage(data: unknown): Promise<void> {
    const message = await parseMessage(data);
    if (!message || typeof message !== "object") return;
    const record = message as Record<string, unknown>;
    const requestId = typeof record.requestId === "string" ? record.requestId : undefined;
    if (!requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (record._tag === "Chunk") {
      const values = Array.isArray(record.values) ? record.values : [];
      if (pending.timeout) clearTimeout(pending.timeout);
      for (const value of values) pending.listener?.(value);
      return;
    }
    if (record._tag === "Exit") {
      this.pending.delete(requestId);
      if (pending.timeout) clearTimeout(pending.timeout);
      const exit = record.exit as Record<string, unknown> | undefined;
      if (exit?._tag === "Success") {
        pending.resolve?.(exit.value);
      } else {
        pending.reject?.(new Error(formatExitFailure(exit)));
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject?.(error);
      this.pending.delete(id);
    }
  }
}

function createSimpleWsRpcClient(transport: SimpleWsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    server: {
      getConfig: () => transport.request("server.getConfig", {}),
    },
    orchestration: {
      dispatchCommand: (input) => transport.request("orchestration.dispatchCommand", input),
      getArchivedShellSnapshot: () => transport.request("orchestration.getArchivedShellSnapshot", {}),
      subscribeShell: (listener, onError) => transport.subscribe("orchestration.subscribeShell", {}, listener, onError),
      subscribeThread: (input, listener, onError) =>
        transport.subscribe("orchestration.subscribeThread", input, listener, onError),
    },
  };
}

function applySimpleThreadDetailEvent(
  thread: OrchestrationThread,
  item: OrchestrationThreadStreamItem,
): { readonly kind: "updated"; readonly thread: OrchestrationThread } | { readonly kind: "unchanged" } {
  const event = (item as { readonly event?: SimpleThreadEvent }).event;
  if (!event) return { kind: "unchanged" };
  const payload = event.payload ?? {};
  switch (event.type) {
    case "thread.meta-updated":
      return {
        kind: "updated",
        thread: {
          ...thread,
          ...defined({
            title: stringValue(payload.title),
            updatedAt: stringValue(payload.updatedAt),
          }),
        },
      };
    case "thread.archived":
      return {
        kind: "updated",
        thread: {
          ...thread,
          archivedAt: stringValue(payload.archivedAt) ?? thread.archivedAt,
          updatedAt: stringValue(payload.updatedAt) ?? thread.updatedAt,
        },
      };
    case "thread.unarchived":
      return {
        kind: "updated",
        thread: { ...thread, archivedAt: null, updatedAt: stringValue(payload.updatedAt) ?? thread.updatedAt },
      };
    case "message.created": {
      const message = isRecord(payload.message)
        ? (payload.message as OrchestrationThread["messages"][number])
        : undefined;
      return {
        kind: "updated",
        thread: { ...thread, messages: message ? [...thread.messages, message] : thread.messages },
      };
    }
    case "message.updated":
      return {
        kind: "updated",
        thread: {
          ...thread,
          messages: thread.messages.map((message) =>
            message.id === payload.messageId && isRecord(payload.patch) ? { ...message, ...payload.patch } : message,
          ),
        },
      };
    case "thread.message-sent": {
      const nextMessage = {
        id: stringValue(payload.messageId) ?? "",
        role: stringValue(payload.role) ?? "assistant",
        text: stringValue(payload.text) ?? "",
        turnId: stringValue(payload.turnId) ?? null,
        streaming: Boolean(payload.streaming),
        createdAt: stringValue(payload.createdAt) ?? thread.updatedAt,
        updatedAt: stringValue(payload.updatedAt) ?? stringValue(payload.createdAt) ?? thread.updatedAt,
      } as OrchestrationThread["messages"][number];
      const messages = thread.messages.some((message) => message.id === nextMessage.id)
        ? thread.messages.map((message) =>
            message.id !== nextMessage.id
              ? message
              : {
                  ...message,
                  text: nextMessage.streaming
                    ? `${message.text}${nextMessage.text}`
                    : nextMessage.text.length > 0
                      ? nextMessage.text
                      : message.text,
                  streaming: nextMessage.streaming,
                  turnId: nextMessage.turnId,
                  updatedAt: nextMessage.updatedAt,
                },
          )
        : [...thread.messages, nextMessage];
      const previousLatestTurn = thread.latestTurn as
        | { readonly turnId?: string | null; readonly requestedAt?: string; readonly startedAt?: string | null }
        | null
        | undefined;
      const sameTurn = previousLatestTurn?.turnId === nextMessage.turnId;
      const latestTurn =
        nextMessage.role === "assistant" && nextMessage.turnId
          ? ({
              turnId: nextMessage.turnId,
              state: nextMessage.streaming ? ("running" as const) : ("completed" as const),
              requestedAt: sameTurn
                ? (previousLatestTurn?.requestedAt ?? nextMessage.createdAt)
                : nextMessage.createdAt,
              startedAt: sameTurn ? (previousLatestTurn?.startedAt ?? nextMessage.createdAt) : nextMessage.createdAt,
              completedAt: nextMessage.streaming ? null : nextMessage.updatedAt,
              assistantMessageId: nextMessage.id,
            } as OrchestrationThread["latestTurn"])
          : thread.latestTurn;
      return {
        kind: "updated",
        thread: {
          ...thread,
          messages,
          latestTurn,
          updatedAt: (event as { readonly occurredAt?: string }).occurredAt ?? thread.updatedAt,
        },
      };
    }
    case "thread.turn-started":
    case "thread.turn-updated":
      return {
        kind: "updated",
        thread: {
          ...thread,
          latestTurn: isRecord(payload.latestTurn)
            ? (payload.latestTurn as OrchestrationThread["latestTurn"])
            : thread.latestTurn,
          updatedAt: stringValue(payload.updatedAt) ?? thread.updatedAt,
        },
      };
    case "thread.session-updated":
    case "thread.session-set":
      return {
        kind: "updated",
        thread: {
          ...thread,
          session: isRecord(payload.session) ? (payload.session as OrchestrationThread["session"]) : thread.session,
        },
      };
    default:
      return { kind: "unchanged" };
  }
}

async function parseMessage(data: unknown): Promise<unknown> {
  if (typeof data === "string") return JSON.parse(data);
  if (data instanceof Blob) return JSON.parse(await data.text());
  return JSON.parse(Buffer.from(data as ArrayBuffer).toString("utf8"));
}

function formatExitFailure(exit: Record<string, unknown> | undefined): string {
  if (!exit) return "T3 websocket request failed";
  return JSON.stringify(exit);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

type SimpleThreadEvent = {
  readonly type?: string;
  readonly occurredAt?: string;
  readonly payload?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function defined<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}
