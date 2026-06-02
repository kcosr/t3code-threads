#!/usr/bin/env bun
import { parseArgv } from "./args.ts";
import { formatUnknownError, isUsageError } from "./errors.ts";
import { runCommand } from "./commands.ts";

async function main() {
  const parsed = parseArgv(process.argv.slice(2));
  try {
    const code = await runCommand(parsed.command, parsed.args, {
      configPath: parsed.globals.config,
      connect: parsed.globals.connect,
      server: parsed.globals.server,
    });
    process.exitCode = code;
  } catch (error) {
    const prefix = isUsageError(error) ? "usage" : "error";
    console.error(`${prefix}: ${formatUnknownError(error)}`);
    process.exitCode = isUsageError(error) ? 2 : 1;
  }
}

await main();
