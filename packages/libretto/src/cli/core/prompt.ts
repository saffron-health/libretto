/**
 * Minimal interactive prompts for the auth CLI commands. Uses node:readline
 * for normal input and a raw-mode terminal for password entry so the
 * password is masked as the user types.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function prompt(
  question: string,
  opts: { defaultValue?: string } = {},
): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const display = opts.defaultValue
      ? `${question} (${opts.defaultValue}) `
      : `${question} `;
    const answer = (await rl.question(display)).trim();
    if (answer.length === 0 && opts.defaultValue !== undefined) {
      return opts.defaultValue;
    }
    return answer;
  } finally {
    rl.close();
  }
}

const CTRL_C = "";
const CR = "\r";
const LF = "\n";
const BACKSPACE = "";
const DELETE = "";

export async function promptPassword(question: string): Promise<string> {
  if (!stdin.isTTY) {
    // Non-interactive (piped input) — fall back to plain readline so
    // scripted tests still work; the password just won't be masked.
    return prompt(question);
  }

  process.stdout.write(`${question} `);

  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = (): void => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
    };

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === LF || ch === CR) {
          cleanup();
          resolve(buffer);
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          reject(new Error("Aborted."));
          return;
        }
        if (ch === BACKSPACE || ch === DELETE) {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        // Skip other control bytes (escape sequences from arrow keys, etc).
        if (ch.charCodeAt(0) < 0x20) continue;
        buffer += ch;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
