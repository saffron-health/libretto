import type { ChildProcess } from "node:child_process";
import type { IpcProtocolMessage, IpcTransport } from "./ipc.js";

type ProcessIpcTarget = {
  send?: (message: IpcProtocolMessage) => boolean;
  on(event: "message", listener: (message: unknown) => void): ProcessIpcTarget;
  off(event: "message", listener: (message: unknown) => void): ProcessIpcTarget;
  on(event: "disconnect", listener: () => void): ProcessIpcTarget;
  off(event: "disconnect", listener: () => void): ProcessIpcTarget;
};

export function createChildProcessIpcTransport(
  child: ChildProcess,
): IpcTransport<IpcProtocolMessage> {
  return createProcessIpcTransport(child, () => {
    if (child.connected) child.disconnect();
  });
}

export function createParentProcessIpcTransport(): IpcTransport<IpcProtocolMessage> {
  if (!process.send) {
    throw new Error(
      "Cannot create child-process IPC transport: process.send is not available. Start the process with an IPC channel.",
    );
  }

  return createProcessIpcTransport(process, () => {
    if (process.connected) process.disconnect?.();
  });
}

function createProcessIpcTransport(
  target: ProcessIpcTarget,
  close: () => void,
): IpcTransport<IpcProtocolMessage> {
  return {
    send(message) {
      if (!target.send) {
        throw new Error(
          "Cannot send IPC message: process IPC channel is closed.",
        );
      }

      target.send(message);
    },
    listen(callback) {
      const onMessage = (message: unknown) => {
        if (isIpcProtocolMessage(message)) callback(message);
      };

      target.on("message", onMessage);
      return () => target.off("message", onMessage);
    },
    onClose(callback) {
      const onDisconnect = () => callback();
      target.on("disconnect", onDisconnect);
      return () => target.off("disconnect", onDisconnect);
    },
    close,
  };
}

function isIpcProtocolMessage(message: unknown): message is IpcProtocolMessage {
  if (!isRecord(message)) return false;

  if (message.type === "ipc-request") {
    return (
      typeof message.id === "string" &&
      typeof message.method === "string" &&
      Array.isArray(message.args)
    );
  }

  if (message.type === "ipc-response") {
    return (
      typeof message.id === "string" &&
      typeof message.method === "string" &&
      (message.error === undefined || isSerializedError(message.error))
    );
  }

  return false;
}

function isSerializedError(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.message === "string" &&
    (value.stack === undefined || typeof value.stack === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
