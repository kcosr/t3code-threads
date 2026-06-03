#!/usr/bin/env bun
import { CommanderError } from "commander";
import { configureProgram, hoistGlobalOptions } from "./cli.ts";
import { UsageError } from "./errors.ts";
import { formatUnknownError, isUsageError } from "./errors.ts";

async function main() {
  const program = configureProgram();
  try {
    await program.parseAsync(hoistGlobalOptions(process.argv.slice(2)), { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      process.exitCode = 0;
      return;
    }
    const normalized = error instanceof CommanderError ? commanderUsageError(error) : error;
    const prefix = isUsageError(normalized) ? "usage" : "error";
    console.error(`${prefix}: ${formatUnknownError(normalized)}`);
    process.exitCode = isUsageError(normalized) ? 2 : 1;
  }
}

await main();

function commanderUsageError(error: CommanderError): UsageError {
  const message = error.message.replace(/^error: /, "");
  return new UsageError(message);
}
