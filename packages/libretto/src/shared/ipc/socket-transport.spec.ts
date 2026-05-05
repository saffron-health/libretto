import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as base } from "vitest";
import { createIpcPeer, type IpcPeer } from "./ipc.js";
import {
  connectToIpcSocket,
  listenForIpcConnections,
} from "./socket-transport.js";

const test = base.extend<{
  socketPath: string;
}>({
  socketPath: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), "libretto-ipc-"));
    await use(join(directory, "daemon.sock"));
  },
});

type ClientApi = {
  ping(): string;
};

type ServerApi = {
  double(value: number): Promise<number>;
  wait(): Promise<string>;
};

test("sends concurrent calls over one socket", async ({ socketPath }) => {
  await writeFile(socketPath, "stale");

  const serverPeers: Array<IpcPeer<ClientApi>> = [];
  const server = await listenForIpcConnections(socketPath, (transport) => {
    serverPeers.push(
      createIpcPeer<ClientApi, ServerApi>(transport, {
        async double(value) {
          return value * 2;
        },
        async wait() {
          return "done";
        },
      }),
    );
  });
  const client = createIpcPeer<ServerApi, ClientApi>(
    await connectToIpcSocket(socketPath),
    {
      ping() {
        return "pong";
      },
    },
  );

  await expect(
    Promise.all([client.call.double(2), client.call.double(21)]),
  ).resolves.toEqual([4, 42]);

  client.destroy();
  for (const peer of serverPeers) peer.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await expect(stat(socketPath)).rejects.toThrow();
});

test("rejects pending calls when the socket closes", async ({ socketPath }) => {
  const serverPeers: Array<IpcPeer<ClientApi>> = [];
  const server = await listenForIpcConnections(socketPath, (transport) => {
    serverPeers.push(
      createIpcPeer<ClientApi, ServerApi>(transport, {
        async double(value) {
          return value * 2;
        },
        async wait() {
          return new Promise(() => {});
        },
      }),
    );
  });
  const client = createIpcPeer<ServerApi, ClientApi>(
    await connectToIpcSocket(socketPath),
    {
      ping() {
        return "pong";
      },
    },
  );
  const pending = client.call.wait();

  for (const peer of serverPeers) peer.destroy();

  await expect(pending).rejects.toThrow(/IPC transport closed|ECONNRESET/);

  client.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("closes malformed socket messages without stopping the server", async ({
  socketPath,
}) => {
  const server = await listenForIpcConnections(socketPath, (transport) => {
    createIpcPeer<ClientApi, ServerApi>(transport, {
      async double(value) {
        return value * 2;
      },
      async wait() {
        return "done";
      },
    });
  });

  const malformedClient = createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    malformedClient.once("connect", resolve);
    malformedClient.once("error", reject);
  });
  const malformedClosed = new Promise<void>((resolve) => {
    malformedClient.once("close", () => resolve());
  });
  malformedClient.write("not-json\n");
  await malformedClosed;

  const validClient = createIpcPeer<ServerApi, ClientApi>(
    await connectToIpcSocket(socketPath),
    {
      ping() {
        return "pong";
      },
    },
  );

  await expect(validClient.call.double(4)).resolves.toBe(8);

  validClient.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});
