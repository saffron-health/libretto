import { rm } from "node:fs/promises";
import {
  createServer,
  createConnection,
  type Server,
  type Socket,
} from "node:net";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { IpcProtocolMessage, IpcTransport } from "./ipc.js";

function createJsonSocketTransport(
  socket: Socket,
): IpcTransport<IpcProtocolMessage> {
  socket.setEncoding("utf8");

  return {
    send(message) {
      return new Promise<void>((resolve, reject) => {
        const line = `${JSON.stringify(message)}\n`;
        socket.write(line, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    listen(callback) {
      let buffer = "";
      const onData = (chunk: string) => {
        buffer += chunk;

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) break;

          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length === 0) continue;

          callback(JSON.parse(line) as IpcProtocolMessage);
        }
      };

      socket.on("data", onData);
      return () => socket.off("data", onData);
    },
    onClose(callback) {
      let closeError: Error | undefined;
      const onError = (error: Error) => {
        closeError = error;
      };
      const onClose = () => callback(closeError);

      socket.on("error", onError);
      socket.on("close", onClose);
      return () => {
        socket.off("error", onError);
        socket.off("close", onClose);
      };
    },
    close() {
      socket.destroy();
    },
  };
}

export async function connectToIpcSocket(
  socketPath: string,
): Promise<IpcTransport<IpcProtocolMessage>> {
  const socket = await connectSocket(socketPath);
  return createJsonSocketTransport(socket);
}

export function createIpcSocketServer(
  onConnection: (transport: IpcTransport<IpcProtocolMessage>) => void,
): Server {
  return createServer((socket) => {
    onConnection(createJsonSocketTransport(socket));
  });
}

export async function listenForIpcConnections(
  socketPath: string,
  onConnection: (transport: IpcTransport<IpcProtocolMessage>) => void,
): Promise<Server> {
  const server = createIpcSocketServer(onConnection);
  await listenOnIpcSocket(server, socketPath);
  return server;
}

export async function listenOnIpcSocket(
  server: Server,
  socketPath: string,
): Promise<void> {
  await mkdir(dirname(socketPath), { recursive: true });
  await rm(socketPath, { force: true });

  const originalClose = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    return originalClose((error?: Error) => {
      void rm(socketPath, { force: true }).finally(() => callback?.(error));
    });
  }) as Server["close"];

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

async function connectSocket(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath);

  return new Promise<Socket>((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.off("error", onError);
      resolve(socket);
    };

    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}
