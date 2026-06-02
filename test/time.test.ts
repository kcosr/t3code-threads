import { describe, expect, test } from "bun:test";
import { isAtOrAfter, parseSince } from "../src/time.ts";

describe("time", () => {
  test("parses epoch seconds", () => {
    expect(parseSince("1000")).toBe(1_000_000);
  });

  test("parses relative windows", () => {
    const before = Date.now() - 60_000;
    const parsed = parseSince("1m");
    const after = Date.now();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  test("parses week windows", () => {
    const before = Date.now() - 604_800_000;
    const parsed = parseSince("1w");
    const after = Date.now();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  test("rejects invalid relative windows", () => {
    expect(() => parseSince("yesterday")).toThrow("invalid relative time yesterday");
  });

  test("filters timestamps", () => {
    expect(isAtOrAfter("2026-01-01T00:00:01.000Z", Date.parse("2026-01-01T00:00:00.000Z"))).toBe(true);
    expect(isAtOrAfter("2025-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00.000Z"))).toBe(false);
  });
});
