import type { AffCommandMetadata } from "./index.js";

export interface AffCommandConfig {
  description?: string;
}

export interface AffCommandHandlerArgs {
  input: unknown;
  ctx: unknown;
  command: AffCommandMetadata;
}

export type AffCommandHandler = (
  args: AffCommandHandlerArgs,
) => unknown | Promise<unknown>;

export interface AffCommand {
  type: "command";
  config: AffCommandConfig;
  handler: AffCommandHandler;
}

export interface AffCommandBuilder {
  handle(handler?: AffCommandHandler): AffCommand;
}

export function createCommandBuilder(
  config: AffCommandConfig,
): AffCommandBuilder {
  return {
    handle(handler) {
      return {
        type: "command",
        config,
        handler: handler ?? noopHandler,
      };
    },
  };
}

const noopHandler: AffCommandHandler = async () => undefined;
