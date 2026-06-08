import type { AffRouteMap } from "./index.js";
import type { AffContext, AffEmptyContext, AffMergeContext, AffMiddleware } from "./middleware.js";

/** User-facing configuration for a command group. */
export interface AffGroupConfig {
  /** Short description shown in parent and group help. */
  description?: string;
}

/** Built group route that contains child commands or groups. */
export interface AffGroup {
  /** Route node discriminator. */
  type: "group";
  /** User-facing group configuration. */
  config: AffGroupConfig;
  /** Group middleware that wraps every resolved descendant command. */
  middlewares: readonly AffMiddleware[];
  /** Child routes keyed by their command-line segment. */
  routes: AffRouteMap;
}

/** Builder for a standalone command group. */
export interface AffGroupBuilder<TContext extends AffContext = AffEmptyContext> {
  /** Add group middleware that runs for every resolved descendant command. */
  use<TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
    middleware: TContext extends TMiddlewareContext
      ? AffMiddleware<unknown, TMiddlewareContext, TNextContext>
      : never,
  ): AffGroupBuilder<AffMergeContext<TContext, TNextContext>>;
  /** Attach child routes and finish the group builder. */
  routes(routes: AffRouteMap): AffGroup;
}

/** Create a group builder for nested command routes. */
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
