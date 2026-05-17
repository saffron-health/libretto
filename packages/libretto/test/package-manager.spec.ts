import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectProjectPackageManager,
  detectPackageManager,
  installCommand,
} from "../src/shared/package-manager.js";

describe("package manager detection", () => {
  it("detects the package manager from npm_config_user_agent", () => {
    expect(
      detectPackageManager("/tmp/no-lockfiles", {
        npm_config_user_agent: "bun/1.0.0",
      }),
    ).toBe("bun");
  });

  it("uses lockfiles, not the invoking command, for project installs", () => {
    const dir = mkdtempSync(join(tmpdir(), "libretto-pm-"));
    try {
      writeFileSync(join(dir, "pnpm-lock.yaml"), "");

      expect(
        detectProjectPackageManager(dir),
      ).toBe("pnpm");
      expect(installCommand(detectProjectPackageManager(dir))).toBe("pnpm add");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
