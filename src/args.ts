import { UsageError } from "./errors.ts";

export interface ParsedArgv {
  readonly globals: {
    readonly config?: string;
    readonly connect?: string;
    readonly server?: string;
  };
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export function parseArgv(argv: ReadonlyArray<string>): ParsedArgv {
  const remaining: string[] = [];
  const globals: { config?: string; connect?: string; server?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--config") {
      globals.config = readValue(argv, ++index, "--config");
    } else if (arg === "--connect") {
      globals.connect = readValue(argv, ++index, "--connect");
    } else if (arg === "--server") {
      globals.server = readValue(argv, ++index, "--server");
    } else {
      remaining.push(arg);
    }
  }
  const command = remaining.shift();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { globals, command: "help", args: remaining };
  }
  return { globals, command, args: remaining };
}

export function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

export function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new UsageError(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

export function takeNumber(args: string[], name: string): number | undefined {
  const value = takeOption(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new UsageError(`${name} must be a non-negative integer`);
  return parsed;
}

export function requireNoExtra(args: ReadonlyArray<string>): void {
  if (args.length > 0) {
    throw new UsageError(`unexpected argument: ${args.join(" ")}`);
  }
}

export function requireArg(args: string[], label: string): string {
  const value = args.shift();
  if (!value) throw new UsageError(`missing ${label}`);
  return value;
}

function readValue(argv: ReadonlyArray<string>, index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new UsageError(`${flag} requires a value`);
  return value;
}
