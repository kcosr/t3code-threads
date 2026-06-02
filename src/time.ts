import { UsageError } from "./errors.ts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseSince(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const match = trimmed.match(/^(\d+)([smhdw])$/i);
  if (!match) {
    throw new UsageError(`invalid relative time ${value}; use an epoch second or window like 5m`);
  }
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const factor =
    unit === "s"
      ? 1000
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : unit === "d"
            ? 86_400_000
            : unit === "w"
              ? 604_800_000
              : undefined;
  if (!factor) throw new UsageError(`invalid relative time unit in ${value}`);
  return Date.now() - amount * factor;
}

export function isAtOrAfter(iso: string | null | undefined, sinceMs: number | null): boolean {
  if (sinceMs === null) return true;
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && time >= sinceMs;
}
