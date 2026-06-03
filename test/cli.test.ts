import { describe, expect, test } from "bun:test";
import { CommanderError } from "commander";
import { configureProgram, hoistGlobalOptions } from "../src/cli.ts";
import type { BaseInput, CommandRunner } from "../src/commands.ts";
import { UsageError } from "../src/errors.ts";

interface RunnerCall {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly base: BaseInput;
}

describe("cli parser", () => {
  test("hoists practical global options regardless of command position", () => {
    expect(hoistGlobalOptions(["list", "--json", "--server", "main", "--config=cfg.json"])).toEqual([
      "--server",
      "main",
      "--config",
      "cfg.json",
      "list",
      "--json",
    ]);
  });

  test("rejects missing global option values with usage errors", () => {
    expect(() => hoistGlobalOptions(["list", "--server"])).toThrow(UsageError);
  });

  test("passes global options and command options to the runner", async () => {
    const calls = await parse(["list", "--json", "--server", "local", "--sort", "created", "--limit", "10"]);
    expect(calls).toEqual([
      {
        command: "list",
        args: ["--json", "--limit", "10", "--sort", "created"],
        base: { server: "local" },
      },
    ]);
  });

  test("parses representative commands", async () => {
    const cases: ReadonlyArray<[ReadonlyArray<string>, RunnerCall]> = [
      [["servers"], { command: "servers", args: [], base: {} }],
      [["servers", "ping", "--all", "--json"], { command: "servers", args: ["ping", "--all", "--json"], base: {} }],
      [["auth", "status", "--json"], { command: "auth", args: ["status", "--json"], base: {} }],
      [
        ["auth", "login", "--token", "TOKEN", "--json"],
        {
          command: "auth",
          args: ["login", "--token", "TOKEN", "--json"],
          base: {},
        },
      ],
      [["projects", "list", "--json"], { command: "projects", args: ["list", "--json"], base: {} }],
      [
        ["projects", "add", "/repo", "--title", "Repo", "--create", "--json"],
        {
          command: "projects",
          args: ["add", "--json", "--title", "Repo", "--create", "/repo"],
          base: {},
        },
      ],
      [["providers", "list", "--json"], { command: "providers", args: ["list", "--json"], base: {} }],
      [
        ["models", "--provider", "codex", "--json"],
        {
          command: "models",
          args: ["--json", "--provider", "codex"],
          base: {},
        },
      ],
      [
        ["search", "query", "--since", "24h", "--json"],
        {
          command: "search",
          args: ["query", "--json", "--since", "24h"],
          base: {},
        },
      ],
      [
        ["show", "thread-1", "--items", "full", "--last", "10", "--json"],
        {
          command: "show",
          args: ["thread-1", "--json", "--last", "10", "--items", "full"],
          base: {},
        },
      ],
      [
        ["messages", "thread-1", "--role", "user", "--json"],
        {
          command: "messages",
          args: ["thread-1", "--json", "--role", "user"],
          base: {},
        },
      ],
      [
        ["new", "--cwd", "/repo", "--runtime-mode", "full-access", "--interaction-mode", "plan", "--json"],
        {
          command: "new",
          args: ["--json", "--cwd", "/repo", "--runtime-mode", "full-access", "--interaction-mode", "plan"],
          base: {},
        },
      ],
      [
        ["send", "thread-1", "prompt", "--no-wait", "--json"],
        {
          command: "send",
          args: ["thread-1", "--json", "--no-wait", "prompt"],
          base: {},
        },
      ],
      [["follow", "thread-1", "--json"], { command: "follow", args: ["thread-1", "--json"], base: {} }],
      [["wait", "thread-1", "--json"], { command: "wait", args: ["thread-1", "--json"], base: {} }],
      [["status", "thread-1", "--json"], { command: "status", args: ["--json", "thread-1"], base: {} }],
      [
        ["interrupt", "thread-1", "turn-1", "--json"],
        {
          command: "interrupt",
          args: ["thread-1", "turn-1", "--json"],
          base: {},
        },
      ],
      [["stop", "thread-1", "--json"], { command: "stop", args: ["thread-1", "--json"], base: {} }],
      [["archive", "thread-1", "--json"], { command: "archive", args: ["thread-1", "--json"], base: {} }],
      [["unarchive", "thread-1", "--json"], { command: "unarchive", args: ["thread-1", "--json"], base: {} }],
      [
        ["name", "thread-1", "title", "--json"],
        {
          command: "name",
          args: ["thread-1", "title", "--json"],
          base: {},
        },
      ],
      [
        ["settings", "show", "thread-1", "--json"],
        {
          command: "settings",
          args: ["show", "thread-1", "--json"],
          base: {},
        },
      ],
    ];

    for (const [argv, expected] of cases) {
      await expect(parse(argv)).resolves.toEqual([expected]);
    }
  });

  test("rejects parser-level usage errors", async () => {
    await expect(parse(["unknown"])).rejects.toBeInstanceOf(CommanderError);
    await expect(parse(["show"])).rejects.toBeInstanceOf(CommanderError);
    await expect(parse(["list", "--limit"])).rejects.toBeInstanceOf(CommanderError);
    await expect(parse(["list", "--sort", "bad"])).rejects.toBeInstanceOf(CommanderError);
  });
});

async function parse(argv: ReadonlyArray<string>): Promise<RunnerCall[]> {
  const calls: RunnerCall[] = [];
  const runner: CommandRunner = async (command, args, base) => {
    calls.push({ command, args, base });
    return 0;
  };
  await configureProgram(runner).parseAsync(hoistGlobalOptions(argv), { from: "user" });
  return calls;
}
