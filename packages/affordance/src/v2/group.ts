import type { AffRouteMap } from "./index.js";

export interface AffGroupConfig {
  description?: string;
}

export interface AffGroup {
  type: "group";
  config: AffGroupConfig;
  routes: AffRouteMap;
}

export interface AffGroupBuilder {
  routes(routes: AffRouteMap): AffGroup;
}

export function createGroupBuilder(config: AffGroupConfig): AffGroupBuilder {
  return {
    routes(routes) {
      return {
        type: "group",
        config,
        routes,
      };
    },
  };
}
