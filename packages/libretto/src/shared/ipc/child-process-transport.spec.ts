import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createIpcPeer } from "./ipc.js";
import { createChildProcessIpcTransport } from "./child-process-transport.js";

const execFileAsync = promisify(execFile);

type ParentApi = {
  greet(name: string): string;
};

type ChildApi = {
  double(value: number): number;
  askParent(name: string): Promise<string>;
};

test("throws a clear error without a child-process IPC channel", async () => {
  const modulePath = fileURLToPath(
    new URL("./child-process-transport.ts", import.meta.url),
  );

  await expect(
    execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `import { createParentProcessIpcTransport } from ${JSON.stringify(modulePath)}; createParentProcessIpcTransport();`,
      ],
      { cwd: process.cwd() },
    ),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("process.send is not available"),
  });
});

test("lets parent and child process call each other", async () => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", getChildFixtureSource()],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  child.send({ type: "not-an-ipc-protocol-message" });

  const peer = createIpcPeer<ChildApi, ParentApi>(
    createChildProcessIpcTransport(child),
    {
      greet(name) {
        return `hello ${name}`;
      },
    },
  );

  await expect(peer.call.double(21)).resolves.toBe(42);
  await expect(peer.call.askParent("Ada")).resolves.toBe("hello Ada");

  peer.destroy();
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
});

function getChildFixtureSource(): string {
  const ipcModule = new URL("./ipc.ts", import.meta.url).href;
  const transportModule = new URL(
    "./child-process-transport.ts",
    import.meta.url,
  ).href;

  return `
    import { createIpcPeer } from ${JSON.stringify(ipcModule)};
    import { createParentProcessIpcTransport } from ${JSON.stringify(transportModule)};

    const peer = createIpcPeer(createParentProcessIpcTransport(), {
      double(value) {
        return value * 2;
      },
      async askParent(name) {
        return peer.call.greet(name);
      },
    });

    process.on("disconnect", () => peer.destroy());
  `;
}
