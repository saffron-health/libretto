# Shared IPC

This directory contains the generic typed IPC peer used across socket and child-process boundaries. Keep it transport-agnostic and avoid daemon-, workflow-, or CLI-specific behavior here.

## IpcPeer model

`createIpcPeer<Remote, Local>(transport, handlers)` creates one bidirectional peer:

- `Remote` is the API this side can call through `peer.call.*`.
- `Local` is the API this side exposes through `handlers`.
- Both peers on a connection use opposite generic ordering.
- Calls are request/response RPCs over `IpcProtocolMessage`; concurrent calls are supported.

## Transports

Transports implement `IpcTransport<IpcProtocolMessage>` and are responsible only for delivery, framing, close notification, and cleanup. Use `socket-transport.ts` for Unix socket connections and `child-process-transport.ts` for Node child-process IPC.

When adding a transport, filter incoming messages to valid IPC protocol messages before passing them to `createIpcPeer`, and wire close/error events through `onClose` so pending calls reject when the connection dies.

## Error behavior

`createIpcPeer` serializes handler throws into rejected call promises. Callers should usually let those rejections propagate instead of wrapping them in subsystem-specific error adapters.

Use explicit result shapes only when failure is part of the method contract. For example, daemon `exec` and `readonlyExec` return user-code failures as `{ ok: false, message, output }` so CLI callers can preserve captured stdout and stderr.
