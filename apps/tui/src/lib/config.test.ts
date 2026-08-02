import { describe, expect, it } from "vitest";

import { defaultConfig, parseEnv, renderEnvFiles, validate } from "./config";

describe("installer storage credentials", () => {
  it("generates strong, independent S3 credentials", () => {
    const first = defaultConfig();
    const second = defaultConfig();

    expect(first.s3AccessKeyId).toMatch(/^[a-f0-9]{32}$/);
    expect(first.s3SecretAccessKey.length).toBeGreaterThanOrEqual(32);
    expect(first.s3AccessKeyId).not.toBe(second.s3AccessKeyId);
    expect(first.s3SecretAccessKey).not.toBe(second.s3SecretAccessKey);
  });

  it("rejects missing or weak S3 credentials", () => {
    const config = defaultConfig();

    expect(validate({ ...config, s3AccessKeyId: "short" }).s3AccessKeyId).toBeDefined();
    expect(validate({ ...config, s3SecretAccessKey: "short" }).s3SecretAccessKey).toBeDefined();
  });

  it("renders the same S3 configuration for Compose and direct server runs", () => {
    const config = defaultConfig();
    const files = renderEnvFiles(config);
    const root = parseEnv(files.find((file) => file.rel === ".env")!.content);
    const server = parseEnv(files.find((file) => file.rel === "apps/server/.env")!.content);

    for (const env of [root, server]) {
      expect(env.S3_ACCESS_KEY_ID).toBe(config.s3AccessKeyId);
      expect(env.S3_SECRET_ACCESS_KEY).toBe(config.s3SecretAccessKey);
      expect(env.S3_BUCKET).toBe("nilovon-wiki");
      expect(env.S3_ENDPOINT).toBe("http://rustfs:9000");
      expect(env.S3_REGION).toBe("us-east-1");
      expect(env.S3_FORCE_PATH_STYLE).toBe("true");
    }
  });
});
