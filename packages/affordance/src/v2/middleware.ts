import type { AffCommandMetadata } from "./index.js";

/** Object-shaped context passed through Aff middleware and command handlers. */
export type AffContext = object;

/** Empty context used before any middleware has injected values. */
export type AffEmptyContext = Record<never, never>;

/** Context merge used when middleware provides new downstream context with `next({ ctx })`. */
export type AffMergeContext<TContext extends AffContext, TNextContext extends AffContext> = Omit<
  TContext,
  keyof TNextContext
> &
  TNextContext;

declare const middlewareInputType: unique symbol;
declare const middlewareContextType: unique symbol;
declare const middlewareNextContextType: unique symbol;

/** Arguments passed to an Aff middleware handler. */
export interface AffMiddlewareArgs<
  TInput = unknown,
  TContext extends AffContext = AffContext,
  TNextContext extends AffContext = AffContext,
> {
  /** Parsed input for the resolved command. */
  input: TInput;
  /** Context currently available to this middleware. */
  ctx: TContext;
  /** Metadata for the resolved command. */
  command: AffCommandMetadata;
  /** Continue to the next middleware or command handler. */
  next(options?: AffMiddlewareNextOptions<TNextContext>): Promise<unknown>;
}

/** Options passed to `next(...)` to refine downstream execution. */
export interface AffMiddlewareNextOptions<TContext extends AffContext = AffEmptyContext> {
  /** Context patch shallow-merged into downstream context. */
  ctx?: TContext;
}

/** Function that wraps downstream middleware or command execution. */
export type AffMiddlewareHandler<
  TInput = unknown,
  TContext extends AffContext = AffContext,
  TNextContext extends AffContext = AffContext,
> = (args: AffMiddlewareArgs<TInput, TContext, TNextContext>) => unknown | Promise<unknown>;

/** User-facing configuration for described middleware. */
export interface AffMiddlewareConfig {
  /** Short description for diagnostics or generated docs. */
  description?: string;
}

/** Middleware value accepted by CLI, group, and command builders. */
export type AffMiddleware<
  TInput = unknown,
  TContext extends AffContext = AffContext,
  TNextContext extends AffContext = AffContext,
> = AffMiddlewareHandler<TInput, TContext, TNextContext> & {
  config?: AffMiddlewareConfig;
  readonly [middlewareInputType]?: TInput;
  readonly [middlewareContextType]?: TContext;
  readonly [middlewareNextContextType]?: TNextContext;
};

/** Builder for described middleware with optional type-only contracts. */
export interface AffMiddlewareBuilder<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
> {
  /**
   * Declare the command input shape this middleware expects.
   *
   * Use this when middleware reads parsed input fields and should only be installable on
   * commands whose input satisfies that shape.
   *
   * @example
   * ```ts
   * const requiresSession = Aff.middleware()
   *   .$input<{ session: string }>()
   *   .handle(async ({ input, next }) => next());
   * ```
   */
  $input<TNextInput>(): AffMiddlewareBuilder<TNextInput, TContext>;
  /**
   * Declare the context shape this middleware requires from earlier middleware.
   *
   * Use this when middleware consumes values that must already be present in `ctx`.
   *
   * @example
   * ```ts
   * const usesLogger = Aff.middleware()
   *   .$context<{ logger: Logger }>()
   *   .handle(async ({ ctx, next }) => next());
   * ```
   */
  $context<TNextContext extends AffContext>(): AffMiddlewareBuilder<TInput, TNextContext>;
  /** Finish the middleware builder. No further contracts can be added after this. */
  handle<TNextContext extends AffContext = AffEmptyContext>(
    handler: AffMiddlewareHandler<TInput, TContext, TNextContext>,
  ): AffMiddleware<TInput, TContext, TNextContext>;
}

/** Create inline middleware from a handler. */
export function createMiddleware<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
  TNextContext extends AffContext = AffEmptyContext,
>(
  handler: AffMiddlewareHandler<TInput, TContext, TNextContext>,
): AffMiddleware<TInput, TContext, TNextContext>;
/** Create a described middleware builder. */
export function createMiddleware(config: AffMiddlewareConfig): AffMiddlewareBuilder;
/** Create an undescribed middleware builder for type contracts and a terminal handler. */
export function createMiddleware(): AffMiddlewareBuilder;
export function createMiddleware(
  handlerOrConfig: AffMiddlewareHandler | AffMiddlewareConfig = {},
): AffMiddleware | AffMiddlewareBuilder {
  if (typeof handlerOrConfig === "function") {
    return handlerOrConfig;
  }

  return createMiddlewareBuilder(handlerOrConfig);
}

function createMiddlewareBuilder<TInput = unknown, TContext extends AffContext = AffEmptyContext>(
  config: AffMiddlewareConfig,
): AffMiddlewareBuilder<TInput, TContext> {
  return {
    $input() {
      return createMiddlewareBuilder(config);
    },
    $context() {
      return createMiddlewareBuilder(config);
    },
    handle(handler) {
      return Object.assign(handler, { config });
    },
  };
}

export async function runMiddlewares(
  middlewares: readonly AffMiddleware[],
  args: {
    input: unknown;
    ctx: unknown;
    command: AffCommandMetadata;
  },
  handler: (ctx: unknown) => unknown | Promise<unknown>,
): Promise<unknown> {
  async function runAt(index: number, ctx: unknown): Promise<unknown> {
    const middleware = middlewares[index];

    if (!middleware) {
      return handler(ctx);
    }

    return middleware({
      input: args.input,
      ctx: ctx as object,
      command: args.command,
      next: (options = {}) => runAt(index + 1, mergeContext(ctx, options.ctx)),
    });
  }

  return runAt(0, args.ctx);
}

function mergeContext(ctx: unknown, patch: unknown): unknown {
  if (patch === undefined) {
    return ctx;
  }

  if (isObjectRecord(ctx) && isObjectRecord(patch)) {
    return { ...ctx, ...patch };
  }

  return patch;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
