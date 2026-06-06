import type { AffCommandMetadata } from "./index.js";
import {
  createInputDefinition,
  parseInput,
  type AffArgumentsDefinition,
  type AffInputDefinition,
  type AffInputFor,
  type AffInputRaw,
  type AffOptionsDefinition,
} from "./input/input.js";

export interface AffCommandConfig {
  description?: string;
}

export interface AffCommandHandlerArgs<TInput = unknown> {
  input: TInput;
  ctx: unknown;
  command: AffCommandMetadata;
}

export type AffCommandHandler<TInput = unknown> = (
  args: AffCommandHandlerArgs<TInput>,
) => unknown | Promise<unknown>;

export interface AffCommand {
  type: "command";
  config: AffCommandConfig;
  input?: AffInputDefinition;
  execute(
    rawInput: AffInputRaw,
    initialContext: unknown,
    command: AffCommandMetadata,
    commandName?: string,
  ): unknown | Promise<unknown>;
}

export interface AffCommandBuilder<TInput = unknown> {
  arguments<const TArguments extends AffArgumentsDefinition>(
    args: TArguments,
  ): AffCommandBuilder<AffInputFor<TArguments, {}>>;
  options<const TOptions extends AffOptionsDefinition>(
    options: TOptions,
  ): AffCommandBuilder<TInput & AffInputFor<[], TOptions>>;
  handle(handler?: AffCommandHandler<TInput>): AffCommand;
}

export function createCommandBuilder(config: AffCommandConfig): AffCommandBuilder<unknown> {
  return createConfiguredCommandBuilder(config, [], {}, false, () => ({}));
}

function createConfiguredCommandBuilder<TInput>(
  config: AffCommandConfig,
  args: AffArgumentsDefinition,
  options: AffOptionsDefinition,
  hasInput: boolean,
  parseRawInput: (rawInput: AffInputRaw, commandName?: string) => TInput,
): AffCommandBuilder<TInput> {
  return {
    arguments<const TArguments extends AffArgumentsDefinition>(nextArgs: TArguments) {
      const input = createInputDefinition<AffInputFor<TArguments, {}>>(nextArgs, options);
      return createConfiguredCommandBuilder<AffInputFor<TArguments, {}>>(
        config,
        nextArgs,
        options,
        true,
        (rawInput, commandName) => parseInput(input, rawInput, commandName),
      );
    },
    options<const TOptions extends AffOptionsDefinition>(nextOptions: TOptions) {
      const input = createInputDefinition<TInput & AffInputFor<[], TOptions>>(args, nextOptions);
      return createConfiguredCommandBuilder<TInput & AffInputFor<[], TOptions>>(
        config,
        args,
        nextOptions,
        true,
        (rawInput, commandName) => parseInput(input, rawInput, commandName),
      );
    },
    handle(handler) {
      const input = hasInput ? createInputDefinition<TInput>(args, options) : undefined;
      return {
        type: "command",
        config,
        input,
        execute(rawInput, initialContext, command, commandName) {
          return handler?.({
            input: parseRawInput(rawInput, commandName ?? command.path.join(" ")),
            ctx: initialContext,
            command,
          });
        },
      };
    },
  };
}
