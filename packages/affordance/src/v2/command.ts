import type { AffCommandMetadata } from "./index.js";
import type { AffMiddleware } from "./middleware.js";
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
  middlewares: readonly AffMiddleware[];
  parse(rawInput: AffInputRaw, commandName?: string): unknown | Promise<unknown>;
  run(input: unknown, ctx: unknown, command: AffCommandMetadata): unknown | Promise<unknown>;
}

export interface AffCommandBuilder<TInput = unknown> {
  arguments<const TArguments extends AffArgumentsDefinition>(
    args: TArguments,
  ): AffCommandBuilder<TInput & AffInputFor<TArguments, {}>>;
  options<const TOptions extends AffOptionsDefinition>(
    options: TOptions,
  ): AffCommandBuilder<TInput & AffInputFor<[], TOptions>>;
  use(middleware: AffMiddleware): AffCommandBuilder<TInput>;
  handle(handler?: AffCommandHandler<TInput>): AffCommand;
}

export function createCommandBuilder(config: AffCommandConfig): AffCommandBuilder<{}> {
  return createConfiguredCommandBuilder(config, [], {}, false, [], () => ({}));
}

function createConfiguredCommandBuilder<TInput>(
  config: AffCommandConfig,
  args: AffArgumentsDefinition,
  options: AffOptionsDefinition,
  hasInput: boolean,
  middlewares: readonly AffMiddleware[],
  parseRawInput: (rawInput: AffInputRaw, commandName?: string) => TInput | Promise<TInput>,
): AffCommandBuilder<TInput> {
  return {
    arguments<const TArguments extends AffArgumentsDefinition>(nextArgs: TArguments) {
      const input = createInputDefinition<TInput & AffInputFor<TArguments, {}>>(nextArgs, options);
      return createConfiguredCommandBuilder<TInput & AffInputFor<TArguments, {}>>(
        config,
        nextArgs,
        options,
        true,
        middlewares,
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
        middlewares,
        (rawInput, commandName) => parseInput(input, rawInput, commandName),
      );
    },
    use(middleware) {
      return createConfiguredCommandBuilder(
        config,
        args,
        options,
        hasInput,
        [...middlewares, middleware],
        parseRawInput,
      );
    },
    handle(handler) {
      const input = hasInput ? createInputDefinition<TInput>(args, options) : undefined;
      return {
        type: "command",
        config,
        input,
        middlewares,
        parse(rawInput, commandName) {
          return parseRawInput(rawInput, commandName);
        },
        async run(parsedInput, ctx, command) {
          return handler?.({
            input: parsedInput as TInput,
            ctx,
            command,
          });
        },
      };
    },
  };
}
