import type { AffRouteMap } from "./index.js";
import type { AffContext, AffEmptyContext, AffMergeContext, AffMiddleware } from "./middleware.js";

export interface AffGroupConfig {
  description?: string;
}

export interface AffGroup {
  type: "group";
  config: AffGroupConfig;
  middlewares: readonly AffMiddleware[];
  routes: AffRouteMap;
}

export interface AffGroupBuilder<TContext extends AffContext = AffEmptyContext> {
  use<TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
    middleware: TContext extends TMiddlewareContext
      ? AffMiddleware<unknown, TMiddlewareContext, TNextContext>
      : never,
  ): AffGroupBuilder<AffMergeContext<TContext, TNextContext>>;
  routes(routes: AffRouteMap): AffGroup;
}

export function createGroupBuilder(config: AffGroupConfig): AffGroupBuilder {
  return createConfiguredGroupBuilder(config, []);
}

function createConfiguredGroupBuilder<TContext extends AffContext = AffEmptyContext>(
  config: AffGroupConfig,
  middlewares: readonly AffMiddleware[],
): AffGroupBuilder<TContext> {
  return {
    use<TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
      middleware: TContext extends TMiddlewareContext
        ? AffMiddleware<unknown, TMiddlewareContext, TNextContext>
        : never,
    ) {
      return createConfiguredGroupBuilder<AffMergeContext<TContext, TNextContext>>(config, [
        ...middlewares,
        middleware as unknown as AffMiddleware,
      ]);
    },
    routes(routes) {
      return {
        type: "group",
        config,
        middlewares,
        routes,
      };
    },
  };
}
