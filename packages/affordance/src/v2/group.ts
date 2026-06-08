import type { AffRouteMap } from "./index.js";
import type { AffMiddleware } from "./middleware.js";

export interface AffGroupConfig {
  description?: string;
}

export interface AffGroup {
  type: "group";
  config: AffGroupConfig;
  middlewares: readonly AffMiddleware[];
  routes: AffRouteMap;
}

export interface AffGroupBuilder {
  use(middleware: AffMiddleware): AffGroupBuilder;
  routes(routes: AffRouteMap): AffGroup;
}

export function createGroupBuilder(config: AffGroupConfig): AffGroupBuilder {
  return createConfiguredGroupBuilder(config, []);
}

function createConfiguredGroupBuilder(
  config: AffGroupConfig,
  middlewares: readonly AffMiddleware[],
): AffGroupBuilder {
  return {
    use(middleware) {
      return createConfiguredGroupBuilder(config, [...middlewares, middleware]);
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
