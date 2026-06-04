import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";

export const RUNTIME_MODES = [
  "approval-required",
  "auto-accept-edits",
  "full-access",
] as const satisfies ReadonlyArray<RuntimeMode>;
export const INTERACTION_MODES = ["default", "plan"] as const satisfies ReadonlyArray<ProviderInteractionMode>;
export const SORT_KEYS = ["updated", "created"] as const;
export const SHOW_ITEM_VIEWS = ["summary", "full", "none"] as const;
export const MESSAGE_ROLES = ["user", "assistant"] as const;
