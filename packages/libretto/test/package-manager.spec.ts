import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectProjectPackageManager,
  detectPackageManager,
  installCommand,
  librettoCommand,
} from "../src/shared/package-manager.js";

describe("package manager command rendering", () => {
  it("renders libretto commands for supported package managers", () => {
    expect(librettoCommand("setup", "npm")).toBe("npx libretto setup");
    expect(librettoCommand("setup", "pnpm")).toBe("pnpm exec libretto setup");
    expect(librettoCommand("setup", "yarn")).toBe("yarn libretto setup");
    expect(librettoCommand("setup", "bun")).toBe("bunx libretto setup");
  });

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
