export interface BaseInput {
  readonly configPath?: string;
  readonly connect?: string;
  readonly server?: string;
}

export type CommandRunner = (command: string, rawArgs: ReadonlyArray<string>, base: BaseInput) => Promise<number>;

export const lazyRunCommand: CommandRunner = async (command, rawArgs, base) => {
  const { runCommand } = await import("./commands.ts");
  return await runCommand(command, rawArgs, base);
};
