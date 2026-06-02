import { describe, expect, test } from "bun:test";
import { EventId, MessageId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import type { OrchestrationThread } from "@t3tools/contracts";
import { applyThreadDetailEvent } from "../src/runtime.ts";
import { chooseModelSelection, terminalStatus } from "../src/t3.ts";

describe("t3 helpers", () => {
  const serverConfig = {
    providers: [
      {
        instanceId: "codex",
        driver: "codex",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        models: [
          { slug: "gpt-5.5", name: "GPT 5.5", isCustom: false, capabilities: null },
          { slug: "gpt-5.5-codex", name: "GPT 5.5 Codex", isCustom: false, capabilities: null },
        ],
      },
    ],
  };

  test("selects provider/model from target defaults", () => {
    const selection = chooseModelSelection({
      config: serverConfig as never,
      target: {
        name: "local",
        config: {
          httpUrl: "http://127.0.0.1:3773",
          defaultProviderInstance: "codex",
          defaultModel: "gpt-5.5-codex",
        },
        bearerToken: "token",
      },
    });
    expect(String(selection.instanceId)).toBe("codex");
    expect(selection.model).toBe("gpt-5.5-codex");
  });

  test("parses provider/model shorthand", () => {
    const selection = chooseModelSelection({
      config: serverConfig as never,
      target: { name: "local", config: { httpUrl: "http://127.0.0.1:3773" }, bearerToken: "token" },
      model: "codex/gpt-5.5",
      effort: "high",
    });
    expect(String(selection.instanceId)).toBe("codex");
    expect(selection.model).toBe("gpt-5.5");
    expect(selection.options).toEqual([{ id: "effort", value: "high" }]);
  });

  test("uses configured model option defaults and lets explicit flags override them", () => {
    const selection = chooseModelSelection({
      config: serverConfig as never,
      target: {
        name: "local",
        config: {
          httpUrl: "http://127.0.0.1:3773",
          defaultEffort: "medium",
          defaultServiceTier: "auto",
        },
        bearerToken: "token",
      },
      projectDefault: {
        instanceId: "codex" as ProviderInstanceId,
        model: "gpt-5.5",
        options: [{ id: "effort", value: "low" }],
      },
      effort: "high",
    });

    expect(selection.options).toEqual([
      { id: "effort", value: "high" },
      { id: "serviceTier", value: "auto" },
    ]);
  });

  test("does not complete a message wait from a stale prior latestTurn", () => {
    const thread = threadFixture({
      latestTurn: {
        turnId: TurnId.make("turn-prior"),
        state: "completed",
        requestedAt: "2026-06-02T00:00:00.000Z",
        startedAt: "2026-06-02T00:00:00.000Z",
        completedAt: "2026-06-02T00:00:02.000Z",
        assistantMessageId: MessageId.make("message-prior-assistant"),
      },
      session: sessionFixture("ready"),
      messages: [
        userMessage("message-prior-user", "turn-prior", "before"),
        assistantMessage("message-prior-assistant", "turn-prior", "done"),
        userMessage("message-new-user", "turn-new", "again"),
      ],
    });

    expect(terminalStatus(thread, "message-new-user")).toBeNull();
  });

  test("completes a message wait after a non-streaming assistant response", () => {
    const thread = threadFixture({
      latestTurn: {
        turnId: TurnId.make("turn-new"),
        state: "completed",
        requestedAt: "2026-06-02T00:00:03.000Z",
        startedAt: "2026-06-02T00:00:04.000Z",
        completedAt: "2026-06-02T00:00:05.000Z",
        assistantMessageId: MessageId.make("message-new-assistant"),
      },
      session: sessionFixture("ready"),
      messages: [
        userMessage("message-new-user", "turn-new", "again"),
        assistantMessage("message-new-assistant", "turn-new", "answered"),
      ],
    });

    expect(terminalStatus(thread, "message-new-user")).toBe("completed");
  });

  test("keeps a message wait open while the session is running", () => {
    const thread = threadFixture({
      latestTurn: {
        turnId: TurnId.make("turn-new"),
        state: "running",
        requestedAt: "2026-06-02T00:00:03.000Z",
        startedAt: "2026-06-02T00:00:04.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      session: sessionFixture("running", "turn-new"),
      messages: [userMessage("message-new-user", "turn-new", "again")],
    });

    expect(terminalStatus(thread, "message-new-user")).toBeNull();
  });

  test("reports interrupted and error session states for a message wait", () => {
    const interrupted = threadFixture({
      session: sessionFixture("interrupted"),
      messages: [userMessage("message-new-user", "turn-new", "again")],
    });
    const errored = threadFixture({
      session: sessionFixture("error"),
      messages: [userMessage("message-new-user", "turn-new", "again")],
    });

    expect(terminalStatus(interrupted, "message-new-user")).toBe("interrupted");
    expect(terminalStatus(errored, "message-new-user")).toBe("error");
  });

  test("reduces mock assistant message events", () => {
    const thread = {
      id: "thread-1",
      projectId: "project-1",
      title: "thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      session: null,
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
      messages: [
        {
          id: "message-user",
          role: "user",
          text: "hello",
          turnId: "turn-1",
          streaming: false,
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    };
    const previous = process.env.T3CODE_THREADS_WS_CLIENT;
    process.env.T3CODE_THREADS_WS_CLIENT = "simple";
    try {
      const reduced = applyThreadDetailEvent(
        thread as never,
        {
          kind: "event",
          event: {
            type: "thread.message-sent",
            occurredAt: "2026-06-02T00:00:02.000Z",
            payload: {
              messageId: "message-assistant",
              role: "assistant",
              text: "done",
              turnId: "turn-1",
              streaming: false,
              createdAt: "2026-06-02T00:00:01.000Z",
              updatedAt: "2026-06-02T00:00:02.000Z",
            },
          },
        } as never,
      );
      expect(reduced.kind).toBe("updated");
      if (reduced.kind !== "updated") throw new Error("expected update");
      expect(reduced.thread.messages.at(-1)?.text).toBe("done");
      expect(reduced.thread.latestTurn?.state).toBe("completed");
    } finally {
      if (previous === undefined) process.env.T3CODE_THREADS_WS_CLIENT = undefined;
      else process.env.T3CODE_THREADS_WS_CLIENT = previous;
    }
  });

  test("reduces upstream assistant message events on the actual runtime path", () => {
    const previous = process.env.T3CODE_THREADS_WS_CLIENT;
    process.env.T3CODE_THREADS_WS_CLIENT = undefined;
    try {
      const thread: OrchestrationThread = {
        id: ThreadId.make("thread-actual"),
        projectId: ProjectId.make("project-actual"),
        title: "thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        session: null,
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
      };

      const reduced = applyThreadDetailEvent(thread, {
        kind: "event",
        event: {
          sequence: 1,
          eventId: EventId.make("event-actual"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-actual"),
          occurredAt: "2026-06-02T00:00:02.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "thread.message-sent",
          payload: {
            threadId: ThreadId.make("thread-actual"),
            messageId: MessageId.make("message-actual"),
            role: "assistant",
            text: "done",
            turnId: TurnId.make("turn-actual"),
            streaming: false,
            createdAt: "2026-06-02T00:00:01.000Z",
            updatedAt: "2026-06-02T00:00:02.000Z",
          },
        },
      });

      expect(reduced.kind).toBe("updated");
      if (reduced.kind !== "updated") throw new Error("expected update");
      expect(reduced.thread.messages.at(-1)?.text).toBe("done");
      expect(reduced.thread.latestTurn?.state).toBe("completed");
    } finally {
      if (previous === undefined) process.env.T3CODE_THREADS_WS_CLIENT = undefined;
      else process.env.T3CODE_THREADS_WS_CLIENT = previous;
    }
  });
});

function threadFixture(
  overrides: Partial<OrchestrationThread> & Pick<OrchestrationThread, "messages">,
): OrchestrationThread {
  return {
    id: ThreadId.make("thread-terminal"),
    projectId: ProjectId.make("project-terminal"),
    title: "thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    session: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    ...overrides,
  };
}

function userMessage(id: string, turnId: string, text: string): OrchestrationThread["messages"][number] {
  return {
    id: MessageId.make(id),
    role: "user",
    text,
    turnId: TurnId.make(turnId),
    streaming: false,
    createdAt: "2026-06-02T00:00:03.000Z",
    updatedAt: "2026-06-02T00:00:03.000Z",
  };
}

function assistantMessage(id: string, turnId: string, text: string): OrchestrationThread["messages"][number] {
  return {
    id: MessageId.make(id),
    role: "assistant",
    text,
    turnId: TurnId.make(turnId),
    streaming: false,
    createdAt: "2026-06-02T00:00:04.000Z",
    updatedAt: "2026-06-02T00:00:05.000Z",
  };
}

function sessionFixture(
  status: NonNullable<OrchestrationThread["session"]>["status"],
  activeTurnId?: string,
): NonNullable<OrchestrationThread["session"]> {
  return {
    threadId: ThreadId.make("thread-terminal"),
    status,
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: activeTurnId ? TurnId.make(activeTurnId) : null,
    lastError: null,
    updatedAt: "2026-06-02T00:00:04.000Z",
  };
}
