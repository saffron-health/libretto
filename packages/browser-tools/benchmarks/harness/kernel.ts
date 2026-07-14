import { KernelBrowserProvider } from "@libretto/browser-tools/kernel";
import { DEFAULT_TIMEOUT_MS } from "../agent.js";

export type KernelConnection = {
  cdpEndpoint: string;
  sessionId: string;
  sessionName: string;
  close(): Promise<void>;
};

export async function createKernelConnection(): Promise<KernelConnection> {
  const provider = new KernelBrowserProvider({
    headless: false,
    stealth: true,
    timeoutSeconds: Math.ceil(DEFAULT_TIMEOUT_MS / 1000),
  });
  const session = await provider.createSession();
  return {
    cdpEndpoint: session.cdpEndpoint,
    sessionId: session.sessionId,
    sessionName: `benchmark-${session.sessionId}`,
    async close() {
      await provider.closeSession(session.sessionId);
    },
  };
}

export async function closeKernelConnection(
  kernel: KernelConnection,
): Promise<void> {
  try {
    await kernel.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Kernel cleanup also failed: ${message}\n`);
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
