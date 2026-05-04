import { EventEmitter } from "node:events";
import { expect, test as base } from "vitest";
import {
  createIpcPeer,
  type IpcPeer,
  type IpcProtocolMessage,
} from "./ipc.js";

type ApiA = {
  greet(name: string): string;
};

type ApiB = {
  add(left: number, right: number): Promise<number>;
  fail(): Promise<void>;
  wait(): Promise<string>;
};

type Peers = {
  a: IpcPeer<ApiB>;
  b: IpcPeer<ApiA>;
};

type Fixtures = Peers & {
  peers: Peers;
};

const test = base.extend<Fixtures>({
  peers: async ({}, use) => {
    const channel = new EventEmitter<{
      a: [IpcProtocolMessage];
      b: [IpcProtocolMessage];
    }>();
    const a = createIpcPeer<ApiB, ApiA>({
      send(message) {
        channel.emit("b", message);
      },
      listen(callback) {
        channel.on("a", callback);
        return () => channel.off("a", callback);
      },
    }, {
      greet(name) {
        return `hello ${name}`;
      },
    });
    const b = createIpcPeer<ApiA, ApiB>({
      send(message) {
        channel.emit("a", message);
      },
      listen(callback) {
        channel.on("b", callback);
        return () => channel.off("b", callback);
      },
    }, {
      async add(left, right) {
        return left + right;
      },
      async fail() {
        throw new Error("expected failure");
      },
      async wait() {
        return new Promise(() => {});
      },
    });

    await use({ a, b });

    a.destroy();
    b.destroy();
  },
  a: async ({ peers }, use) => {
    await use(peers.a);
  },
  b: async ({ peers }, use) => {
    await use(peers.b);
  },
});

test("calls handlers on the remote peer", async ({ a, b }) => {
  await expect(a.call.add(2, 3)).resolves.toBe(5);
  await expect(b.call.greet("Ada")).resolves.toBe("hello Ada");
});

test("rejects with the remote handler error", async ({ a }) => {
  await expect(a.call.fail()).rejects.toThrow("fail > expected failure");
});

test("rejects pending calls when destroyed", async ({ a }) => {
  const result = a.call.wait();

  a.destroy();

  await expect(result).rejects.toThrow("IPC peer destroyed");
});
