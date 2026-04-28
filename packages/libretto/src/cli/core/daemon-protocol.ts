import { createHash } from "node:crypto";
import { REPO_ROOT } from "./context.js";

// ---------------------------------------------------------------------------
// Request types — one shape per daemon command
// ---------------------------------------------------------------------------

export type DaemonRequest =
  | { id: string; command: "ping" }
  | { id: string; command: "pages" }
  | { id: string; command: "snapshot"; pageId?: string }
  | {
      id: string;
      command: "exec";
      code: string;
      pageId?: string;
      visualize?: boolean;
    }
  | { id: string; command: "readonly-exec"; code: string; pageId?: string };

// ---------------------------------------------------------------------------
// Response types — success or error, keyed by the originating request id
// ---------------------------------------------------------------------------

export type DaemonResponse =
  | { id: string; type: "result"; data: unknown }
  | { id: string; type: "error"; message: string };

// ---------------------------------------------------------------------------
// Socket path resolution
// ---------------------------------------------------------------------------

/**
 * Deterministic Unix domain socket path for a given session.
 *
 * The path lives in `/tmp` to stay well under the macOS 104-byte Unix socket
 * path limit. The hash combines `REPO_ROOT` and the session name so different
 * repos (or sessions within the same repo) never collide.
 */
export function getDaemonSocketPath(session: string): string {
  const hash = createHash("sha256")
    .update(`${REPO_ROOT}:${session}`)
    .digest("hex")
    .slice(0, 12);
  return `/tmp/libretto-${process.getuid!()}-${hash}.sock`;
}
