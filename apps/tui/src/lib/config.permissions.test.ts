import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ root: "" }));

vi.mock("./paths", async () => {
  const { join } = await vi.importActual<typeof import("node:path")>("node:path");
  return { envPath: (rel: string) => join(paths.root, rel) };
});

import { defaultConfig, ensureStorageCredentials, renderEnvFiles, writeEnvFiles } from "./config";

async function permissions(path: string): Promise<number> {
  return (await stat(path)).mode & 0o7777;
}

describe("env file permissions", () => {
  beforeEach(async () => {
    paths.root = await mkdtemp(join(tmpdir(), "nilovon-wiki-config-"));
    await Promise.all([
      mkdir(join(paths.root, "apps/server"), { recursive: true }),
      mkdir(join(paths.root, "apps/collab"), { recursive: true }),
      mkdir(join(paths.root, "apps/web"), { recursive: true }),
    ]);
  });

  afterEach(async () => {
    await rm(paths.root, { recursive: true, force: true });
  });

  it("creates every env file with mode 0600", async () => {
    const config = defaultConfig();
    await writeEnvFiles(config);

    for (const file of renderEnvFiles(config)) {
      expect(await permissions(join(paths.root, file.rel))).toBe(0o600);
    }
  });

  it("repairs permissive modes when updating existing env files", async () => {
    const rootEnv = join(paths.root, ".env");
    await writeFile(rootEnv, "OLD=value\n", { mode: 0o644 });
    await chmod(rootEnv, 0o644);

    await writeEnvFiles(defaultConfig());

    expect(await permissions(rootEnv)).toBe(0o600);
  });

  it("repairs the root env mode when appending migration secrets", async () => {
    const rootEnv = join(paths.root, ".env");
    await writeFile(rootEnv, "POSTGRES_PASSWORD=secret\n", { mode: 0o666 });
    await chmod(rootEnv, 0o666);

    await ensureStorageCredentials();

    expect(await permissions(rootEnv)).toBe(0o600);
  });
});
