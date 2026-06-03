import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { configureProgram } from "../src/cli.ts";
import { completionCandidates, completionScript } from "../src/completion.ts";

const tempDirs: string[] = [];

describe("shell completion", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("completes top-level commands and hides the helper", async () => {
    const output = await candidates("l", []);
    expect(output).toContain("list\n");
    expect(output).not.toContain("__complete");
  });

  test("completes nested subcommands", async () => {
    await expect(candidates("p", ["servers"])).resolves.toBe("ping\n");
    await expect(candidates("s", ["completion"])).resolves.toBe("script\n");
  });

  test("completes options and static values", async () => {
    await expect(candidates("--so", ["list"])).resolves.toBe("--sort\n");
    await expect(candidates("u", ["list", "--sort"])).resolves.toBe("updated\n");
    await expect(candidates("--sort=u", ["list"])).resolves.toBe("--sort=updated\n");
    await expect(candidates("f", ["show", "thread-1", "--items"])).resolves.toBe("full\n");
    await expect(candidates("a", ["messages", "thread-1", "--role"])).resolves.toBe("assistant\n");
    await expect(candidates("f", ["new", "--runtime-mode"])).resolves.toBe("full-access\n");
    await expect(candidates("p", ["send", "thread-1", "prompt", "--interaction-mode"])).resolves.toBe("plan\n");
    await expect(candidates("b", ["completion"])).resolves.toBe("bash\n");
    await expect(candidates("z", ["completion", "script"])).resolves.toBe("zsh\n");
  });

  test("suggests active command options when no positional candidates are known", async () => {
    const output = await candidates("", ["list"]);
    expect(output).toContain("--json\n");
    expect(output).toContain("--server\n");
    expect(output).toContain("--config\n");
  });

  test("completes local server aliases without connecting", async () => {
    const config = await tempConfig({
      servers: {
        work: { httpUrl: "http://127.0.0.1:3773" },
        personal: { httpUrl: "http://127.0.0.1:4773" },
      },
    });

    await expect(candidates("wo", ["--config", config, "list", "--server"])).resolves.toBe("work\n");
    await expect(
      candidates("wo", ["--config", config, "--connect", "http://127.0.0.1:3773", "list", "--server"]),
    ).resolves.toBe("");
  });

  test("silently returns no server aliases for invalid config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t3code-threads-completion-"));
    tempDirs.push(dir);
    const config = join(dir, "config.json");
    await writeFile(config, "{", "utf8");

    await expect(candidates("", ["--config", config, "list", "--server"])).resolves.toBe("");
  });

  test("generates bash, zsh, and fish scripts that delegate to __complete", () => {
    expect(completionScript("bash")).toContain("complete -F _t3code_threads_completion t3code-threads");
    expect(completionScript("bash")).toContain('t3code-threads __complete -- "$cur"');
    expect(completionScript("zsh")).toContain("compdef _t3code_threads t3code-threads");
    expect(completionScript("zsh")).toContain('t3code-threads __complete -- "$current"');
    expect(completionScript("fish")).toContain("complete -c t3code-threads -f -a");
    expect(completionScript("fish")).toContain('t3code-threads __complete -- "$current"');
  });
});

function candidates(prefix: string, words: string[]): Promise<string> {
  return completionCandidates(configureProgram(), prefix, words);
}

async function tempConfig(config: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "t3code-threads-completion-"));
  tempDirs.push(dir);
  const path = join(dir, "config.json");
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return path;
}
