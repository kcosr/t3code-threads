import type {
  ModelSelection,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadShell,
  ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import type { WsRpcClient } from "./runtime.ts";

export interface TargetConfig {
  readonly httpUrl: string;
  readonly wsUrl?: string;
  readonly bearerToken?: string;
  readonly bearerTokenEnv?: string;
  readonly defaultProviderInstance?: string;
  readonly defaultModel?: string;
  readonly defaultEffort?: string;
  readonly defaultServiceTier?: string;
}

export interface AppConfig {
  readonly defaultProviderInstance?: string;
  readonly defaultModel?: string;
  readonly defaultEffort?: string;
  readonly defaultServiceTier?: string;
  readonly servers: Record<string, TargetConfig>;
}

export interface ResolvedTarget {
  readonly name: string;
  readonly config: TargetConfig;
  readonly bearerToken?: string;
}

export interface T3Connection {
  readonly target: ResolvedTarget;
  readonly client: WsRpcClient;
  readonly close: () => Promise<void>;
}

export interface CommandContext {
  readonly configPath: string;
  readonly config: AppConfig;
  readonly target: ResolvedTarget;
}

export interface ThreadListResult {
  readonly snapshot: OrchestrationShellSnapshot;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
}

export interface ThreadDetailResult {
  readonly thread: OrchestrationThread;
}

export interface ProviderModelChoice {
  readonly selection: ModelSelection;
  readonly provider: ServerConfig["providers"][number];
  readonly model: ServerConfig["providers"][number]["models"][number];
}

export type ThreadTerminalStatus = "completed" | "interrupted" | "error";

export interface TurnWaitResult {
  readonly threadId: ThreadId;
  readonly turnId: string | null;
  readonly status: ThreadTerminalStatus;
  readonly assistantText: string;
}
