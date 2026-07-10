import { beforeEach, describe, expect, test, vi } from "vitest";
import { SimpleCLI } from "affordance";
import type { SessionState } from "../src/cli/core/session.js";

const sessionState: SessionState = {
  session: "test-session",
  port: 9222,
  startedAt: "2026-01-01T00:00:00.000Z",
  mode: "write-access",
  daemonSocketPath: "/tmp/libretto-test.sock",
};

const readSessionStateOrThrow = vi.fn<
  (session: string) => SessionState
>();
const daemonExec = vi.fn();
const daemonReadonlyExec = vi.fn();
const daemonDestroy = vi.fn();

vi.mock("../src/cli/core/session.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/cli/core/session.js")>();
  return {
    ...original,
    readSessionStateOrThrow,
  };
});

vi.mock("../src/cli/core/daemon/ipc.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/cli/core/daemon/ipc.js")>();
  return {
    ...original,
    DaemonClient: {
      connect: vi.fn(async () => ({
        exec: daemonExec,
        readonlyExec: daemonReadonlyExec,
        destroy: daemonDestroy,
      })),
    },
  };
});

const { execCommand, readonlyExecCommand } = await import(
  "../src/cli/commands/execution.js"
);

function createApp() {
  return SimpleCLI.define("libretto", {
    exec: execCommand,
    "readonly-exec": readonlyExecCommand,
  });
}

describe("execution commands", () => {
  beforeEach(() => {
    readSessionStateOrThrow.mockReset();
    daemonExec.mockReset();
    daemonReadonlyExec.mockReset();
    daemonDestroy.mockReset();

    readSessionStateOrThrow.mockReturnValue(sessionState);
    daemonExec.mockResolvedValue({
      ok: true,
      data: { result: undefined, output: undefined, snapshotDiff: undefined },
    });
    daemonReadonlyExec.mockResolvedValue({
      ok: true,
      data: { result: undefined, output: undefined, snapshotDiff: undefined },
    });
  });

  test.each([
    ["exec", daemonExec],
    ["readonly-exec", daemonReadonlyExec],
  ])(
    "%s uses the session state resolved by middleware",
    async (command, execute) => {
      const app = createApp();

      await app.run([
        command,
        "await page.title()",
        "--session",
        "test-session",
      ]);

      expect(readSessionStateOrThrow).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledOnce();
    },
  );
});
