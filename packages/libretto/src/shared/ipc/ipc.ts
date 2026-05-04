import { randomUUID } from "node:crypto";

export type IpcTransport<T = unknown> = {
  send(message: T): void | Promise<void>;
  listen(callback: (message: T) => void): () => void;
  onClose?(callback: (error?: Error) => void): () => void;
  close?(): void;
};

type FunctionMap<T> = {
  [K in keyof T]: (...args: never[]) => unknown;
};

type UnwrapPromise<T> = T extends Promise<infer Result> ? Result : T;

type MaybeAsync<T extends (...args: never[]) => unknown> = T extends (
  ...args: infer Args
) => infer Result
  ? (...args: Args) => UnwrapPromise<Result> | Promise<UnwrapPromise<Result>>
  : never;

export type IpcPeerHandlers<Local extends FunctionMap<Local>> = {
  [K in keyof Local]: MaybeAsync<Local[K]>;
};

export type IpcPeerCalls<Remote extends FunctionMap<Remote>> = {
  [K in keyof Remote]: Remote[K] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<UnwrapPromise<Result>>
    : never;
};

export type IpcPeer<Remote extends FunctionMap<Remote>> = {
  call: IpcPeerCalls<Remote>;
  destroy(): void;
};

type IpcRequestMessage = {
  type: "ipc-request";
  id: string;
  method: string;
  args: unknown[];
};

type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: SerializedError;
  errors?: SerializedError[];
};

type IpcResponseMessage = {
  type: "ipc-response";
  id: string;
  method: string;
  data?: unknown;
  error?: SerializedError;
};

export type IpcProtocolMessage = IpcRequestMessage | IpcResponseMessage;

type PendingRequest = {
  method: string;
  resolve(value: unknown): void;
  reject(error: unknown): void;
};

export function createIpcPeer<
  Remote extends FunctionMap<Remote>,
  Local extends FunctionMap<Local>,
>(
  transport: IpcTransport<IpcProtocolMessage>,
  handlers: IpcPeerHandlers<Local>,
): IpcPeer<Remote> {
  const pending = new Map<string, PendingRequest>();
  let destroyed = false;

  const stopListening = transport.listen((message) => {
    if (message.type === "ipc-request") {
      void handleRequest(message);
      return;
    }

    handleResponse(message);
  });
  const stopCloseListener = transport.onClose?.((error) => {
    destroy(error ?? new Error("IPC transport closed"));
  });

  async function handleRequest(message: IpcRequestMessage): Promise<void> {
    if (destroyed) return;

    const handler = handlers[message.method as keyof Local];
    if (!handler) {
      await sendResponse({
        type: "ipc-response",
        id: message.id,
        method: message.method,
        error: serializeError(
          new Error(`No handler registered for method: ${message.method}`),
        ),
      });
      return;
    }

    try {
      const data = await Promise.resolve(handler(...(message.args as never[])));
      await sendResponse({
        type: "ipc-response",
        id: message.id,
        method: message.method,
        data,
      });
    } catch (error) {
      await sendResponse({
        type: "ipc-response",
        id: message.id,
        method: message.method,
        error: serializeError(error),
      });
    }
  }

  async function sendResponse(message: IpcResponseMessage): Promise<void> {
    try {
      await transport.send(message);
    } catch {
      // The caller has no response channel for response-send failures.
    }
  }

  function handleResponse(message: IpcResponseMessage): void {
    const request = pending.get(message.id);
    if (!request) return;

    pending.delete(message.id);

    if (message.error) {
      request.reject(deserializeRemoteError(request.method, message.error));
      return;
    }

    request.resolve(message.data);
  }

  const call = new Proxy({} as IpcPeerCalls<Remote>, {
    get: (_target, method: string | symbol) => {
      if (typeof method !== "string") return undefined;

      return (...args: unknown[]) => {
        if (destroyed) {
          return Promise.reject(new Error("IPC peer destroyed"));
        }

        const id = `${method}-${randomUUID()}`;

        const promise = new Promise<unknown>((resolve, reject) => {
          pending.set(id, { method, resolve, reject });
        });

        void Promise.resolve(
          transport.send({
            type: "ipc-request",
            id,
            method,
            args,
          }),
        ).catch((error: unknown) => {
          const request = pending.get(id);
          if (!request) return;
          pending.delete(id);
          request.reject(error);
        });

        return promise;
      };
    },
  });

  function destroy(error = new Error("IPC peer destroyed")): void {
    if (destroyed) return;
    destroyed = true;
    stopListening();
    stopCloseListener?.();
    transport.close?.();

    for (const request of pending.values()) {
      request.reject(error);
    }

    pending.clear();
  }

  return { call, destroy };
}

function serializeError(
  error: unknown,
  seen = new WeakSet<object>(),
): SerializedError {
  if (typeof error === "object" && error !== null) {
    if (seen.has(error)) {
      return {
        name: "Error",
        message: "[Circular]",
      };
    }

    seen.add(error);
  }

  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    const errorWithCode = error as Error & { code?: unknown };
    if (
      typeof errorWithCode.code === "string" ||
      typeof errorWithCode.code === "number"
    ) {
      serialized.code = errorWithCode.code;
    }

    if (error.cause !== undefined) {
      serialized.cause = serializeError(error.cause, seen);
    }

    if (error instanceof AggregateError) {
      serialized.errors = error.errors.map((aggregateError: unknown) =>
        serializeError(aggregateError, seen),
      );
    }

    return serialized;
  }

  return {
    name: "NonError",
    message: String(error),
  };
}

function deserializeRemoteError(
  method: string,
  remoteError: SerializedError,
): Error {
  const error = deserializeSerializedError(
    remoteError,
    `${method} > ${remoteError.message}`,
  );
  error.stack = [new Error(method).stack, remoteError.stack]
    .filter((stack): stack is string => typeof stack === "string")
    .join("\n");
  return error;
}

function deserializeSerializedError(
  serialized: SerializedError,
  message = serialized.message,
): Error {
  const cause = serialized.cause
    ? deserializeSerializedError(serialized.cause)
    : undefined;
  const error =
    serialized.name === "AggregateError" && serialized.errors
      ? new AggregateError(
          serialized.errors.map((aggregateError) =>
            deserializeSerializedError(aggregateError),
          ),
          message,
          { cause },
        )
      : new Error(message, { cause });

  error.name = serialized.name;
  error.stack = serialized.stack;

  const errorWithCode = error as Error & { code?: string | number };
  if (serialized.code !== undefined) {
    errorWithCode.code = serialized.code;
  }

  return error;
}
