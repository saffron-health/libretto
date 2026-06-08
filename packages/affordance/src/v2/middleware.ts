import type { AffCommandMetadata } from "./index.js";

export type AffContext = object;
export type AffEmptyContext = Record<never, never>;
export type AffMergeContext<
  TContext extends AffContext,
  TNextContext extends AffContext,
> = Omit<TContext, keyof TNextContext> & TNextContext;

declare const middlewareInputType: unique symbol;
declare const middlewareContextType: unique symbol;
declare const middlewareNextContextType: unique symbol;

export interface AffMiddlewareArgs<
  TInput = unknown,
  TContext extends AffContext = AffContext,
  TNextContext extends AffContext = AffContext,
> {
  input: TInput;
  ctx: TContext;
  command: AffCommandMetadata;
  next(options?: AffMiddlewareNextOptions<TNextContext>): Promise<unknown>;
}

export interface AffMiddlewareNextOptions<
  TContext extends AffContext = AffEmptyContext,
> {
  ctx?: TContext;
}

export type AffMiddlewareHandler<
  TInput = unknown,
  TContext extends AffContext = AffContext,
  TNextContext extends AffContext = AffContext,
> = (
  args: AffMiddlewareArgs<TInput, TContext, TNextContext>,
) => unknown | Promise<unknown>;

export interface AffMiddlewareConfig {
  description?: string;
}

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

export interface AffMiddlewareBuilder<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
> {
  $input<TNextInput>(): AffMiddlewareBuilder<TNextInput, TContext>;
  $context<TNextContext extends AffContext>(): AffMiddlewareBuilder<
    TInput,
    TNextContext
  >;
  handle<TNextContext extends AffContext = AffEmptyContext>(
    handler: AffMiddlewareHandler<TInput, TContext, TNextContext>,
  ): AffMiddleware<TInput, TContext, TNextContext>;
}

export function createMiddleware<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
  TNextContext extends AffContext = AffEmptyContext,
>(
  handler: AffMiddlewareHandler<TInput, TContext, TNextContext>,
): AffMiddleware<TInput, TContext, TNextContext>;
export function createMiddleware(
  config: AffMiddlewareConfig,
): AffMiddlewareBuilder;
export function createMiddleware(): AffMiddlewareBuilder;
export function createMiddleware(
  handlerOrConfig: AffMiddlewareHandler | AffMiddlewareConfig = {},
): AffMiddleware | AffMiddlewareBuilder {
  if (typeof handlerOrConfig === "function") {
    return handlerOrConfig;
  }

  return createMiddlewareBuilder(handlerOrConfig);
}

function createMiddlewareBuilder<
  TInput = unknown,
  TContext extends AffContext = AffEmptyContext,
>(config: AffMiddlewareConfig): AffMiddlewareBuilder<TInput, TContext> {
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
