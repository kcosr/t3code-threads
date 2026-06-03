import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { UsageError } from "./errors.ts";
import type { AppConfig, ResolvedTarget, TargetConfig } from "./types.ts";

const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "t3code-threads", "config.json");

export function resolveConfigPath(explicit?: string): string {
  return explicit ?? process.env.T3CODE_THREADS_CONFIG ?? DEFAULT_CONFIG_PATH;
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { servers: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`failed to parse config ${path}: ${message}`);
  }
  return normalizeConfig(parsed);
}

export async function saveConfig(path: string, config: AppConfig): Promise<void> {
  const configDir = dirname(path);
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700).catch(() => undefined);
  const tempPath = join(configDir, `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(tempPath, 0o600).catch(() => undefined);
    await rename(tempPath, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function normalizeConfig(value: unknown): AppConfig {
  if (!value || typeof value !== "object") {
    throw new UsageError("config must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  const rawServers = record.servers;
  if (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers)) {
    throw new UsageError("config must contain a servers object");
  }
  const defaults = readDefaults(record);
  const servers: Record<string, TargetConfig> = {};
  for (const [name, rawServer] of Object.entries(rawServers)) {
    if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) {
      throw new UsageError(`server ${name} must be an object`);
    }
    const server = rawServer as Record<string, unknown>;
    if (typeof server.httpUrl !== "string" || server.httpUrl.trim().length === 0) {
      throw new UsageError(`server ${name} must define httpUrl`);
    }
    servers[name] = {
      httpUrl: trimUrl(server.httpUrl, `server ${name} httpUrl`),
      ...(typeof server.wsUrl === "string" ? { wsUrl: trimUrl(server.wsUrl, `server ${name} wsUrl`) } : {}),
      ...(typeof server.bearerToken === "string" ? { bearerToken: server.bearerToken } : {}),
      ...(typeof server.bearerTokenEnv === "string" ? { bearerTokenEnv: server.bearerTokenEnv } : {}),
      ...readDefaults(server),
    };
  }
  return {
    ...defaults,
    servers,
  };
}

export function resolveTarget(input: {
  readonly config: AppConfig;
  readonly connect?: string;
  readonly server?: string;
}): ResolvedTarget {
  if (input.connect) {
    const config: TargetConfig = { httpUrl: trimUrl(input.connect, "--connect URL") };
    return { name: input.connect, config, bearerToken: resolveBearerToken(config) };
  }

  const explicit = input.server ?? process.env.T3CODE_THREADS_SERVER;
  const names = Object.keys(input.config.servers);
  const selected = explicit ?? (names.length === 1 ? names[0] : undefined);
  if (!selected) {
    if (names.length === 0) {
      throw new UsageError("no servers configured; pass --connect URL or create a config");
    }
    throw new UsageError("multiple servers configured; pass --server ALIAS");
  }
  const config = input.config.servers[selected];
  if (!config) {
    throw new UsageError(`unknown server ${selected}`);
  }
  const mergedConfig = mergeDefaults(input.config, config);
  return { name: selected, config: mergedConfig, bearerToken: resolveBearerToken(mergedConfig) };
}

export function listConfiguredServers(config: AppConfig) {
  return Object.entries(config.servers).map(([name, server]) => ({
    name,
    httpUrl: server.httpUrl,
  }));
}

export async function serverNameCandidates(explicitConfigPath?: string): Promise<string[]> {
  const config = await loadConfig(resolveConfigPath(explicitConfigPath));
  return Object.keys(config.servers);
}

export function setServerToken(config: AppConfig, serverName: string, token: string): AppConfig {
  const server = config.servers[serverName];
  if (!server) throw new UsageError(`unknown server ${serverName}`);
  return {
    ...config,
    servers: {
      ...config.servers,
      [serverName]: {
        ...server,
        bearerToken: token,
      },
    },
  };
}

export function resolveBearerToken(config: TargetConfig): string | undefined {
  if (config.bearerTokenEnv) {
    const value = process.env[config.bearerTokenEnv];
    if (value && value.trim().length > 0) return value.trim();
  }
  if (config.bearerToken && config.bearerToken.trim().length > 0) {
    return config.bearerToken.trim();
  }
  return undefined;
}

export function deriveWsUrl(httpUrl: string, explicit?: string): string {
  if (explicit) return explicit;
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function trimUrl(value: string, label: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UsageError(`${label} must be a valid absolute URL`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function readDefaults(
  record: Record<string, unknown>,
): Pick<TargetConfig, "defaultProviderInstance" | "defaultModel" | "defaultEffort" | "defaultServiceTier"> {
  return {
    ...(typeof record.defaultProviderInstance === "string"
      ? { defaultProviderInstance: record.defaultProviderInstance }
      : {}),
    ...(typeof record.defaultModel === "string" ? { defaultModel: record.defaultModel } : {}),
    ...(typeof record.defaultEffort === "string" ? { defaultEffort: record.defaultEffort } : {}),
    ...(typeof record.defaultServiceTier === "string" ? { defaultServiceTier: record.defaultServiceTier } : {}),
  };
}

function mergeDefaults(config: AppConfig, server: TargetConfig): TargetConfig {
  return {
    ...server,
    ...((server.defaultProviderInstance ?? config.defaultProviderInstance)
      ? { defaultProviderInstance: server.defaultProviderInstance ?? config.defaultProviderInstance }
      : {}),
    ...((server.defaultModel ?? config.defaultModel)
      ? { defaultModel: server.defaultModel ?? config.defaultModel }
      : {}),
    ...((server.defaultEffort ?? config.defaultEffort)
      ? { defaultEffort: server.defaultEffort ?? config.defaultEffort }
      : {}),
    ...((server.defaultServiceTier ?? config.defaultServiceTier)
      ? { defaultServiceTier: server.defaultServiceTier ?? config.defaultServiceTier }
      : {}),
  };
}
