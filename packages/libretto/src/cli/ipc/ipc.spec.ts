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
  failWithCause(): Promise<void>;
  failWithCode(): Promise<void>;
  failWithNonError(): Promise<void>;
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
      async failWithCause() {
        throw new Error("outer failure", {
          cause: new Error("inner failure", {
            cause: new TypeError("root failure"),
          }),
        });
      },
      async failWithCode() {
        const error = new Error("coded failure") as Error & { code: string };
        error.code = "ERR_EXPECTED";
        throw error;
      },
      async failWithNonError() {
        throw "plain failure";
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

test("rejects with the remote handler error cause chain", async ({ a }) => {
  const error = await getRejectedError(a.call.failWithCause());

  expect(error.message).toBe("failWithCause > outer failure");
  expect(error.stack).toContain("outer failure");

  const cause = getErrorCause(error);
  expect(cause.message).toBe("inner failure");

  const rootCause = getErrorCause(cause);
  expect(rootCause.name).toBe("TypeError");
  expect(rootCause.message).toBe("root failure");
});

test("rejects with the remote handler error code", async ({ a }) => {
  const error = await getRejectedError(a.call.failWithCode());

  expect(error.message).toBe("failWithCode > coded failure");
  expect(error.code).toBe("ERR_EXPECTED");
  expect(error.stack).toContain("coded failure");
});

test("rejects with a serialized non-error thrown value", async ({ a }) => {
  const error = await getRejectedError(a.call.failWithNonError());

  expect(error.name).toBe("NonError");
  expect(error.message).toBe("failWithNonError > plain failure");
  expect(error.stack).toContain("failWithNonError");
});

test("rejects pending calls when destroyed", async ({ a }) => {
  const result = a.call.wait();

  a.destroy();

  await expect(result).rejects.toThrow("IPC peer destroyed");
});

async function getRejectedError(
  promise: Promise<unknown>,
): Promise<Error & { code?: unknown }> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error & { code?: unknown };
  }

  throw new Error("Expected promise to reject");
}

function getErrorCause(error: Error): Error {
  expect(error.cause).toBeInstanceOf(Error);
  return error.cause as Error;
}
