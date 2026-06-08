import type { AffCommandMetadata } from "./index.js";
import type { AffContext, AffEmptyContext, AffMergeContext, AffMiddleware } from "./middleware.js";
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

export interface AffCommandHandlerArgs<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
> {
  input: TInput;
  ctx: TContext;
  command: AffCommandMetadata;
}

export type AffCommandHandler<TInput = unknown, TContext extends AffContext = AffEmptyContext> = (
  args: AffCommandHandlerArgs<TInput, TContext>,
) => unknown | Promise<unknown>;

export interface AffCommand {
  type: "command";
  config: AffCommandConfig;
  input?: AffInputDefinition;
  middlewares: readonly AffMiddleware[];
  parse(rawInput: AffInputRaw, commandName?: string): unknown | Promise<unknown>;
  run(input: unknown, ctx: unknown, command: AffCommandMetadata): unknown | Promise<unknown>;
}

export interface AffCommandBuilder<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
> {
  arguments<const TArguments extends AffArgumentsDefinition>(
    args: TArguments,
  ): AffCommandBuilder<TInput & AffInputFor<TArguments, {}>, TContext>;
  options<const TOptions extends AffOptionsDefinition>(
    options: TOptions,
  ): AffCommandBuilder<TInput & AffInputFor<[], TOptions>, TContext>;
  use<TMiddlewareInput, TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
    middleware: TInput extends TMiddlewareInput
      ? TContext extends TMiddlewareContext
        ? AffMiddleware<TMiddlewareInput, TMiddlewareContext, TNextContext>
        : never
      : never,
  ): AffCommandBuilder<TInput, AffMergeContext<TContext, TNextContext>>;
  handle(handler?: AffCommandHandler<TInput, TContext>): AffCommand;
}

export function createCommandBuilder(config: AffCommandConfig): AffCommandBuilder<{}> {
  return createConfiguredCommandBuilder(config, [], {}, false, [], () => ({}));
}

function createConfiguredCommandBuilder<TInput, TContext extends AffContext = AffEmptyContext>(
  config: AffCommandConfig,
  args: AffArgumentsDefinition,
  options: AffOptionsDefinition,
  hasInput: boolean,
  middlewares: readonly AffMiddleware[],
  parseRawInput: (rawInput: AffInputRaw, commandName?: string) => TInput | Promise<TInput>,
): AffCommandBuilder<TInput, TContext> {
  return {
    arguments<const TArguments extends AffArgumentsDefinition>(nextArgs: TArguments) {
      const input = createInputDefinition<TInput & AffInputFor<TArguments, {}>>(nextArgs, options);
      return createConfiguredCommandBuilder<TInput & AffInputFor<TArguments, {}>, TContext>(
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
      return createConfiguredCommandBuilder<TInput & AffInputFor<[], TOptions>, TContext>(
        config,
        args,
        nextOptions,
        true,
        middlewares,
        (rawInput, commandName) => parseInput(input, rawInput, commandName),
      );
    },
    use<TMiddlewareInput, TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
      middleware: TInput extends TMiddlewareInput
        ? TContext extends TMiddlewareContext
          ? AffMiddleware<TMiddlewareInput, TMiddlewareContext, TNextContext>
          : never
        : never,
    ) {
      return createConfiguredCommandBuilder(
        config,
        args,
        options,
        hasInput,
        [...middlewares, middleware as unknown as AffMiddleware],
        parseRawInput,
      ) as AffCommandBuilder<TInput, AffMergeContext<TContext, TNextContext>>;
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
            ctx: ctx as TContext,
            command,
          });
        },
      };
    },
  };
}
