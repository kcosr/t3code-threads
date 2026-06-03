import { UsageError } from "./errors.ts";

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
