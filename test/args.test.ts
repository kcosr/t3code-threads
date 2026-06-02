import { describe, expect, test } from "bun:test";
import { parseArgv, takeFlag, takeNumber, takeOption } from "../src/args.ts";

describe("args", () => {
  test("extracts global options regardless of position", () => {
    const parsed = parseArgv(["list", "--server", "main", "--config", "cfg.json", "--json"]);
    expect(parsed.command).toBe("list");
    expect(parsed.globals.server).toBe("main");
    expect(parsed.globals.config).toBe("cfg.json");
    expect(parsed.args).toEqual(["--json"]);
  });

  test("consumes local options", () => {
    const args = ["--json", "--limit", "10", "--cwd", "/repo"];
    expect(takeFlag(args, "--json")).toBe(true);
    expect(takeNumber(args, "--limit")).toBe(10);
    expect(takeOption(args, "--cwd")).toBe("/repo");
    expect(args).toEqual([]);
  });
});
