import { describe, expect, test } from "bun:test";
import { takeFlag, takeNumber, takeOption } from "../src/args.ts";

describe("args", () => {
  test("consumes local options", () => {
    const args = ["--json", "--limit", "10", "--cwd", "/repo"];
    expect(takeFlag(args, "--json")).toBe(true);
    expect(takeNumber(args, "--limit")).toBe(10);
    expect(takeOption(args, "--cwd")).toBe("/repo");
    expect(args).toEqual([]);
  });
});
