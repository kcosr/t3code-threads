import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, normalizeConfig, saveConfig, resolveTarget } from "../src/config.ts";

describe("config", () => {
  test("normalizes server config and resolves the only target", () => {
    const config = normalizeConfig({
      servers: {
        local: {
          httpUrl: "http://127.0.0.1:3773/",
          bearerToken: "token",
        },
      },
    });
    const target = resolveTarget({ config });
    expect(target.name).toBe("local");
    expect(target.config.httpUrl).toBe("http://127.0.0.1:3773");
    expect(target.bearerToken).toBe("token");
  });

  test("requires explicit target when multiple servers are configured", () => {
    const config = normalizeConfig({
      servers: {
        a: { httpUrl: "http://a.example" },
        b: { httpUrl: "http://b.example" },
      },
    });
    expect(() => resolveTarget({ config })).toThrow("multiple servers configured");
  });

  test("reports invalid server URLs as usage errors with field context", () => {
    expect(() =>
      normalizeConfig({
        servers: {
          local: { httpUrl: "127.0.0.1:3773" },
        },
      }),
    ).toThrow("server local httpUrl must be a valid absolute URL");
  });

  test("reports invalid direct connect URLs as usage errors", () => {
    expect(() => resolveTarget({ config: normalizeConfig({ servers: {} }), connect: "127.0.0.1:3773" })).toThrow(
      "--connect URL must be a valid absolute URL",
    );
  });

  test("merges top-level defaults into configured targets and lets server defaults override them", () => {
    const config = normalizeConfig({
      defaultProviderInstance: "codex",
      defaultModel: "gpt-5.5",
      defaultEffort: "high",
      defaultServiceTier: "auto",
      servers: {
        local: {
          httpUrl: "http://127.0.0.1:3773",
          defaultModel: "gpt-5.5-codex",
        },
      },
    });

    const target = resolveTarget({ config });

    expect(target.config.defaultProviderInstance).toBe("codex");
    expect(target.config.defaultModel).toBe("gpt-5.5-codex");
    expect(target.config.defaultEffort).toBe("high");
    expect(target.config.defaultServiceTier).toBe("auto");
  });

  test("reports malformed config JSON with the config path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t3code-threads-config-"));
    try {
      const path = join(dir, "config.json");
      await writeFile(path, "{ nope", { mode: 0o600 });
      await expect(loadConfig(path)).rejects.toThrow(`failed to parse config ${path}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("saves config atomically with private permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t3code-threads-config-"));
    try {
      await chmod(dir, 0o755);
      const path = join(dir, "nested", "config.json");
      const config = normalizeConfig({
        servers: {
          local: {
            httpUrl: "http://127.0.0.1:3773",
            bearerToken: "secret-token",
          },
        },
      });
      await saveConfig(path, config);

      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config);
      expect((await stat(join(dir, "nested"))).mode & 0o777).toBe(0o700);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
