import type { AffCommandMetadata } from "./index.js";

export interface AffMiddlewareArgs {
  input: unknown;
  ctx: unknown;
  command: AffCommandMetadata;
  next(options?: AffMiddlewareNextOptions): Promise<unknown>;
}

export interface AffMiddlewareNextOptions {
  ctx?: unknown;
}

export type AffMiddlewareHandler = (args: AffMiddlewareArgs) => unknown | Promise<unknown>;

export interface AffMiddlewareConfig {
  description?: string;
}

export type AffMiddleware = AffMiddlewareHandler & {
  config?: AffMiddlewareConfig;
};

export interface AffMiddlewareBuilder {
  handle(handler: AffMiddlewareHandler): AffMiddleware;
}

export function createMiddleware(handler: AffMiddlewareHandler): AffMiddleware;
export function createMiddleware(config: AffMiddlewareConfig): AffMiddlewareBuilder;
export function createMiddleware(
  handlerOrConfig: AffMiddlewareHandler | AffMiddlewareConfig,
): AffMiddleware | AffMiddlewareBuilder {
  if (typeof handlerOrConfig === "function") {
    return handlerOrConfig;
  }

  return {
    handle(handler) {
      return Object.assign(handler, { config: handlerOrConfig });
    },
  };
}

export async function runMiddlewares(
  middlewares: readonly AffMiddleware[],
  args: Omit<AffMiddlewareArgs, "next">,
  handler: (ctx: unknown) => unknown | Promise<unknown>,
): Promise<unknown> {
  async function runAt(index: number, ctx: unknown): Promise<unknown> {
    const middleware = middlewares[index];

    if (!middleware) {
      return handler(ctx);
    }

    return middleware({
      input: args.input,
      ctx,
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
