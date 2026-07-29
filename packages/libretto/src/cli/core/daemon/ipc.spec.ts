import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { describe, expect, test } from "vitest";
import { getDaemonSocketPath } from "./ipc.js";

describe("daemon IPC endpoint paths", () => {
  test("uses a Windows named pipe path on Windows", () => {
    const socketPath = getDaemonSocketPath("windows-session", "win32");

    expect(socketPath).toMatch(/^\\\\\.\\pipe\\libretto-[a-f0-9]{12}$/);
    expect(socketPath).not.toContain("/tmp/");
    expect(socketPath).not.toContain(".sock");
  });

  test("uses the system temp directory on Linux", () => {
    const socketPath = getDaemonSocketPath("unix-session", "linux");

    expect(dirname(socketPath)).toBe(tmpdir());
    expect(socketPath).toMatch(/libretto-[a-f0-9]{12}\.sock$/);
  });

  test("uses a short socket path on macOS", () => {
    const socketPath = getDaemonSocketPath("macos-session", "darwin");

    expect(socketPath).toMatch(/^\/tmp\/libretto-[a-f0-9]{12}\.sock$/);
    expect(Buffer.byteLength(socketPath)).toBeLessThan(104);
  });

  test("keeps daemon IPC endpoints deterministic per session", () => {
    const firstPath = getDaemonSocketPath("stable-session", "linux");
    const secondPath = getDaemonSocketPath("stable-session", "linux");
    const otherPath = getDaemonSocketPath("other-session", "linux");

    expect(secondPath).toBe(firstPath);
    expect(otherPath).not.toBe(firstPath);
  });
});
