import { Command, Option } from "commander";
import {
  type BaseInput,
  type CommandRunner,
  INTERACTION_MODES,
  MESSAGE_ROLES,
  RUNTIME_MODES,
  SHOW_ITEM_VIEWS,
  SORT_KEYS,
  runCommand,
} from "./commands.ts";
import { configureCompletionCommands } from "./completion.ts";
import { UsageError } from "./errors.ts";

type Options = Record<string, unknown>;

export function configureProgram(runner: CommandRunner = runCommand): Command {
  const root = new Command();
  root
    .name("t3code-threads")
    .description("Query and control upstream T3 Code threads")
    .exitOverride()
    .showSuggestionAfterError(false)
    .configureOutput({ writeErr: () => undefined })
    .option("--config <path>", "config file path")
    .option("--connect <url>", "connect directly to a T3 serve URL")
    .option("--server <alias>", "configured server alias")
    .action(() => {
      root.outputHelp();
    });

  configureServersCommand(root, runner);
  configureAuthCommand(root, runner);
  configureProjectsCommand(root, runner);
  configureProvidersCommand(root, runner);
  configureModelsCommand(root, runner);
  configureListCommand(root, runner);
  configureSearchCommand(root, runner);
  configureShowCommand(root, runner);
  configureMessagesCommand(root, runner);
  configureNewCommand(root, runner);
  configureSendCommand(root, runner);
  configureThreadCommands(root, runner);
  configureSettingsCommand(root, runner);
  configureCompletionCommands(root);

  return root;
}

export function hoistGlobalOptions(argv: ReadonlyArray<string>): string[] {
  const globals: string[] = [];
  const remaining: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      remaining.push(...argv.slice(index));
      break;
    }
    const equals = globalEqualsOption(arg);
    if (equals) {
      globals.push(equals.flag, equals.value);
      continue;
    }
    if (arg === "--config" || arg === "--connect" || arg === "--server") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new UsageError(`${arg} requires a value`);
      }
      globals.push(arg, value);
      index += 1;
      continue;
    }
    remaining.push(arg);
  }
  return [...globals, ...remaining];
}

function globalEqualsOption(arg: string): { readonly flag: string; readonly value: string } | undefined {
  const [flag, ...rest] = arg.split("=");
  if (!flag) {
    return undefined;
  }
  if ((flag === "--config" || flag === "--connect" || flag === "--server") && rest.length > 0) {
    return { flag, value: rest.join("=") };
  }
  return undefined;
}

function configureServersCommand(root: Command, runner: CommandRunner): void {
  const servers = root.command("servers").description("List configured T3 servers").option("--json", "emit JSON");
  servers.action(async () => {
    await run(root, runner, "servers", flags(servers.opts(), ["json"]));
  });

  const ping = servers
    .command("ping")
    .description("Connect to configured T3 servers and report reachability")
    .option("--all", "ping every configured server")
    .option("--json", "emit JSON");
  ping.action(async () => {
    await run(root, runner, "servers", ["ping", ...flags(mergedOptions(servers, ping), ["all", "json"])]);
  });
}

function configureAuthCommand(root: Command, runner: CommandRunner): void {
  const auth = root.command("auth").description("Manage bearer auth for a server").option("--json", "emit JSON");
  auth.action(async () => {
    await run(root, runner, "auth", flags(auth.opts(), ["json"]));
  });

  const status = auth.command("status").description("Show auth status").option("--json", "emit JSON");
  status.action(async () => {
    await run(root, runner, "auth", ["status", ...flags(mergedOptions(auth, status), ["json"])]);
  });

  const login = auth
    .command("login")
    .description("Bootstrap bearer auth")
    .requiredOption("--token <token>", "login token")
    .option("--json", "emit JSON");
  login.action(async () => {
    const options = mergedOptions(auth, login);
    await run(root, runner, "auth", ["login", ...option("--token", options.token), ...flags(options, ["json"])]);
  });
}

function configureProjectsCommand(root: Command, runner: CommandRunner): void {
  const projects = root.command("projects").description("List or add T3 projects").option("--json", "emit JSON");
  projects.action(async () => {
    await run(root, runner, "projects", flags(projects.opts(), ["json"]));
  });

  const list = projects.command("list").description("List projects").option("--json", "emit JSON");
  list.action(async () => {
    await run(root, runner, "projects", ["list", ...flags(mergedOptions(projects, list), ["json"])]);
  });

  const add = projects
    .command("add")
    .description("Add a T3 project")
    .argument("<path>", "workspace path")
    .option("--title <title>", "project title")
    .option("--create", "create workspace root if missing")
    .option("--json", "emit JSON");
  add.action(async (path: string) => {
    const options = mergedOptions(projects, add);
    await run(root, runner, "projects", [
      "add",
      ...flags(options, ["json"]),
      ...option("--title", options.title),
      ...flags(options, ["create"]),
      path,
    ]);
  });
}

function configureProvidersCommand(root: Command, runner: CommandRunner): void {
  const providers = root.command("providers").description("List provider instances").option("--json", "emit JSON");
  providers.action(async () => {
    await run(root, runner, "providers", flags(providers.opts(), ["json"]));
  });

  const list = providers.command("list").description("List provider instances").option("--json", "emit JSON");
  list.action(async () => {
    await run(root, runner, "providers", ["list", ...flags(mergedOptions(providers, list), ["json"])]);
  });
}

function configureModelsCommand(root: Command, runner: CommandRunner): void {
  const models = root
    .command("models")
    .description("List provider models")
    .option("--provider <instance>", "filter by provider instance")
    .option("--json", "emit JSON");
  models.action(async () => {
    const options = models.opts();
    await run(root, runner, "models", [...flags(options, ["json"]), ...option("--provider", options.provider)]);
  });
}

function configureListCommand(root: Command, runner: CommandRunner): void {
  const list = root
    .command("list")
    .description("List threads")
    .option("--limit <n>", "maximum thread count")
    .option("--cursor <cursor>", "pagination cursor")
    .option("--since <window>", "minimum updated time")
    .option("--cwd <path>", "filter to workspace path")
    .option("--archived", "include archived threads")
    .addOption(new Option("--sort <key>", "sort key").choices(SORT_KEYS))
    .option("--asc", "sort ascending")
    .option("--desc", "sort descending")
    .option("--json", "emit JSON");
  list.action(async () => {
    await run(root, runner, "list", listArgs(list.opts()));
  });
}

function configureSearchCommand(root: Command, runner: CommandRunner): void {
  const search = root
    .command("search")
    .description("Search thread titles and messages")
    .argument("<query>", "search query")
    .option("--limit <n>", "maximum thread count")
    .option("--cursor <cursor>", "pagination cursor")
    .option("--since <window>", "minimum updated time")
    .option("--cwd <path>", "filter to workspace path")
    .option("--archived", "include archived threads")
    .addOption(new Option("--sort <key>", "sort key").choices(SORT_KEYS))
    .option("--asc", "sort ascending")
    .option("--desc", "sort descending")
    .option("--json", "emit JSON");
  search.action(async (query: string) => {
    await run(root, runner, "search", [query, ...listArgs(search.opts())]);
  });
}

function configureShowCommand(root: Command, runner: CommandRunner): void {
  const show = root
    .command("show")
    .description("Show thread detail")
    .argument("<thread>", "thread id")
    .option("--last <n>", "show last N messages")
    .option("--cursor <cursor>", "pagination cursor")
    .option("--asc", "message order ascending")
    .option("--desc", "message order descending")
    .addOption(new Option("--items <view>", "message detail view").choices(SHOW_ITEM_VIEWS))
    .option("--json", "emit JSON");
  show.action(async (thread: string) => {
    const options = show.opts();
    await run(root, runner, "show", [
      thread,
      ...flags(options, ["json"]),
      ...option("--last", options.last),
      ...option("--items", options.items),
      ...flags(options, ["asc", "desc"]),
      ...option("--cursor", options.cursor),
    ]);
  });
}

function configureMessagesCommand(root: Command, runner: CommandRunner): void {
  const messages = root
    .command("messages")
    .description("Show flattened messages")
    .argument("<thread>", "thread id")
    .option("--last <n>", "show last N messages")
    .option("--since <window>", "minimum message time")
    .addOption(new Option("--role <role>", "message role").choices(MESSAGE_ROLES))
    .option("--json", "emit JSON");
  messages.action(async (thread: string) => {
    const options = messages.opts();
    await run(root, runner, "messages", [
      thread,
      ...flags(options, ["json"]),
      ...option("--last", options.last),
      ...option("--since", options.since),
      ...option("--role", options.role),
    ]);
  });
}

function configureNewCommand(root: Command, runner: CommandRunner): void {
  const command = root
    .command("new")
    .description("Create a thread and optionally start a turn")
    .argument("[prompt]", "initial prompt")
    .option("--cwd <path>", "workspace path")
    .option("--name <name>", "thread name")
    .option("--provider <instance>", "provider instance")
    .option("--model <model>", "model slug or provider/model")
    .option("--effort <effort>", "model effort")
    .option("--service-tier <tier>", "model service tier")
    .addOption(new Option("--runtime-mode <mode>", "runtime mode").choices(RUNTIME_MODES))
    .addOption(new Option("--interaction-mode <mode>", "interaction mode").choices(INTERACTION_MODES))
    .option("--stream", "stream turn output")
    .option("--no-wait", "return after dispatching the turn")
    .option("--json", "emit JSON");
  command.action(async (prompt?: string) => {
    const options = command.opts();
    await run(root, runner, "new", [
      ...flags(options, ["json", "stream"]),
      ...noWaitFlag(options),
      ...option("--cwd", options.cwd),
      ...option("--name", options.name),
      ...modelOptions(options),
      ...option("--runtime-mode", options.runtimeMode),
      ...option("--interaction-mode", options.interactionMode),
      ...sentinelPositional(prompt),
    ]);
  });
}

function configureSendCommand(root: Command, runner: CommandRunner): void {
  const command = root
    .command("send")
    .description("Start a follow-up turn")
    .argument("<thread>", "thread id")
    .argument("<prompt>", "prompt")
    .option("--provider <instance>", "provider instance")
    .option("--model <model>", "model slug or provider/model")
    .option("--effort <effort>", "model effort")
    .option("--service-tier <tier>", "model service tier")
    .addOption(new Option("--runtime-mode <mode>", "runtime mode").choices(RUNTIME_MODES))
    .addOption(new Option("--interaction-mode <mode>", "interaction mode").choices(INTERACTION_MODES))
    .option("--stream", "stream turn output")
    .option("--no-wait", "return after dispatching the turn")
    .option("--json", "emit JSON");
  command.action(async (thread: string, prompt: string) => {
    const options = command.opts();
    await run(root, runner, "send", [
      thread,
      ...flags(options, ["json", "stream"]),
      ...noWaitFlag(options),
      ...modelOptions(options),
      ...option("--runtime-mode", options.runtimeMode),
      ...option("--interaction-mode", options.interactionMode),
      prompt,
    ]);
  });
}

function configureThreadCommands(root: Command, runner: CommandRunner): void {
  threadCommand(root, runner, "follow", "Follow an active turn");
  threadCommand(root, runner, "wait", "Wait for an active turn to finish");
  threadCommand(root, runner, "stop", "Stop the provider session");
  threadCommand(root, runner, "archive", "Archive a thread");
  threadCommand(root, runner, "unarchive", "Restore a thread");

  const status = root
    .command("status")
    .description("Show active session status")
    .argument("[thread]", "thread id")
    .option("--json", "emit JSON");
  status.action(async (thread?: string) => {
    await run(root, runner, "status", [...sentinelPositional(thread), ...flags(status.opts(), ["json"])]);
  });

  const interrupt = root
    .command("interrupt")
    .description("Interrupt the active turn")
    .argument("<thread>", "thread id")
    .argument("[turn]", "turn id")
    .option("--json", "emit JSON");
  interrupt.action(async (thread: string, turn?: string) => {
    await run(root, runner, "interrupt", [thread, ...positional(turn), ...flags(interrupt.opts(), ["json"])]);
  });

  const name = root
    .command("name")
    .description("Rename a thread")
    .argument("<thread>", "thread id")
    .argument("<name>", "thread name")
    .option("--json", "emit JSON");
  name.action(async (thread: string, title: string) => {
    await run(root, runner, "name", [thread, title, ...flags(name.opts(), ["json"])]);
  });
}

function configureSettingsCommand(root: Command, runner: CommandRunner): void {
  const settings = root.command("settings").description("Show T3 thread settings");
  const show = settings
    .command("show")
    .description("Show T3 thread settings")
    .argument("<thread>", "thread id")
    .option("--json", "emit JSON");
  show.action(async (thread: string) => {
    await run(root, runner, "settings", ["show", thread, ...flags(show.opts(), ["json"])]);
  });
}

function threadCommand(root: Command, runner: CommandRunner, name: string, description: string): void {
  const command = root
    .command(name)
    .description(description)
    .argument("<thread>", "thread id")
    .option("--json", "emit JSON");
  command.action(async (thread: string) => {
    await run(root, runner, name, [thread, ...flags(command.opts(), ["json"])]);
  });
}

async function run(root: Command, runner: CommandRunner, command: string, rawArgs: string[]): Promise<void> {
  process.exitCode = await runner(command, rawArgs, baseInput(root.opts()));
}

function baseInput(options: Options): BaseInput {
  return {
    ...(typeof options.config === "string" ? { configPath: options.config } : {}),
    ...(typeof options.connect === "string" ? { connect: options.connect } : {}),
    ...(typeof options.server === "string" ? { server: options.server } : {}),
  };
}

function listArgs(options: Options): string[] {
  return [
    ...flags(options, ["json", "archived", "asc", "desc"]),
    ...option("--limit", options.limit),
    ...option("--cursor", options.cursor),
    ...option("--cwd", options.cwd),
    ...option("--sort", options.sort),
    ...option("--since", options.since),
  ];
}

function modelOptions(options: Options): string[] {
  return [
    ...option("--provider", options.provider),
    ...option("--model", options.model),
    ...option("--effort", options.effort),
    ...option("--service-tier", options.serviceTier),
  ];
}

function flags(options: Options, names: string[]): string[] {
  return names.flatMap((name) => (options[name] ? [`--${kebab(name)}`] : []));
}

function mergedOptions(parent: Command, child: Command): Options {
  const merged = { ...parent.opts(), ...child.opts() } as Options;
  for (const [key, value] of Object.entries(parent.opts() as Options)) {
    if (typeof value === "boolean" && value) {
      merged[key] = true;
    }
  }
  return merged;
}

function option(flag: string, value: unknown): string[] {
  return typeof value === "string" ? [flag, value] : [];
}

function noWaitFlag(options: Options): string[] {
  return options.wait === false ? ["--no-wait"] : [];
}

function positional(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

function sentinelPositional(value: string | undefined): string[] {
  return value === undefined ? [] : ["--", value];
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
