import { CommandId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";

export function commandId(prefix = "cmd"): CommandId {
  return CommandId.make(`${prefix}-${crypto.randomUUID()}`);
}

export function projectId(): ProjectId {
  return ProjectId.make(`project-${crypto.randomUUID()}`);
}

export function threadId(): ThreadId {
  return ThreadId.make(`thread-${crypto.randomUUID()}`);
}

export function messageId(): MessageId {
  return MessageId.make(`message-${crypto.randomUUID()}`);
}
