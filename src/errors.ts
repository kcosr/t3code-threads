export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export function isUsageError(error: unknown): error is UsageError {
  return error instanceof UsageError;
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}
