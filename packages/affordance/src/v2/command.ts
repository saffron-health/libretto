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

/** User-facing configuration for a command. */
export interface AffCommandConfig {
  /** Short description shown in command and group help. */
  description?: string;
}

/** Arguments passed to an Aff command handler. */
export interface AffCommandHandlerArgs<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
> {
  /** Parsed command input inferred from `.arguments(...)` and `.options(...)`. */
  input: TInput;
  /** Context available after all prior middleware has run. */
  ctx: TContext;
  /** Metadata for the resolved command. */
  command: AffCommandMetadata;
}

/** Function that executes a resolved command. */
export type AffCommandHandler<TInput = unknown, TContext extends AffContext = AffEmptyContext> = (
  args: AffCommandHandlerArgs<TInput, TContext>,
) => unknown | Promise<unknown>;

/** Built command route returned by terminal `.handle(...)`. */
export interface AffCommand {
  /** Route node discriminator. */
  type: "command";
  /** User-facing command configuration. */
  config: AffCommandConfig;
  /** Input definition used to parse raw invocation and command-line input. */
  input?: AffInputDefinition;
  /** Command-local middleware that wraps this handler after parent middleware. */
  middlewares: readonly AffMiddleware[];
  /** Parse raw positional and named input for this command. */
  parse(rawInput: AffInputRaw, commandName?: string): unknown | Promise<unknown>;
  /** Run the command handler with parsed input, context, and metadata. */
  run(input: unknown, ctx: unknown, command: AffCommandMetadata): unknown | Promise<unknown>;
}

/** Builder for a standalone command route. */
export interface AffCommandBuilder<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
> {
  /** Declare positional arguments as ordered `[name, schema]` tuples. */
  arguments<const TArguments extends AffArgumentsDefinition>(
    args: TArguments,
  ): AffCommandBuilder<TInput & AffInputFor<TArguments, {}>, TContext>;
  /** Declare named options, flags, and plain Standard Schema-backed option schemas. */
  options<const TOptions extends AffOptionsDefinition>(
    options: TOptions,
  ): AffCommandBuilder<TInput & AffInputFor<[], TOptions>, TContext>;
  /** Add command-local middleware before the terminal handler. */
  use<TMiddlewareInput, TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
    middleware: TInput extends TMiddlewareInput
      ? TContext extends TMiddlewareContext
        ? AffMiddleware<TMiddlewareInput, TMiddlewareContext, TNextContext>
        : never
      : never,
  ): AffCommandBuilder<TInput, AffMergeContext<TContext, TNextContext>>;
  /** Finish the command builder. No further middleware or input can be added after this. */
  handle(handler?: AffCommandHandler<TInput, TContext>): AffCommand;
}

/** Create a command builder for a leaf route. */
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
