export type AffRoute = AffGroup | AffCommand;
export type AffRouteMap = Record<string, AffRoute>;

export interface AffCommandMetadata {
  routeKey: string;
  path: string[];
  description?: string;
}

interface AffCommandRoute {
  metadata: AffCommandMetadata;
  command: AffCommand;
}

export interface AffApp {
  getCommands(): AffCommandMetadata[];
  invoke(routeKey: string): Promise<never>;
}

export interface AffCliBuilder {
  routes(routes: AffRouteMap): AffApp;
}

function createCliBuilder(name: string): AffCliBuilder {
  return {
    routes(routes) {
      const commandRoutes = flattenCommandRoutes(routes);

      return {
        getCommands() {
          return commandRoutes.map(({ metadata }) => metadata);
        },
        async invoke(routeKey) {
          throw new Error(`Unknown command route: ${routeKey}`);
        },
      };
    },
  };
}

function flattenCommandRoutes(
  routes: AffRouteMap,
  path: string[] = [],
): AffCommandRoute[] {
  const commandRoutes: AffCommandRoute[] = [];

  for (const [routeSegment, route] of Object.entries(routes)) {
    const routePath = [...path, routeSegment];

    if (route.type === "command") {
      commandRoutes.push({
        metadata: {
          routeKey: routePath.join("."),
          path: routePath,
          description: route.config.description,
        },
        command: route,
      });
      continue;
    }

    if (route.type === "group") {
      commandRoutes.push(...flattenCommandRoutes(route.routes, routePath));
    }
  }

  return commandRoutes;
}

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

function createGroupBuilder(config: AffGroupConfig): AffGroupBuilder {
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

export interface AffCommandConfig {
  description?: string;
}

export interface AffCommandHandlerArgs {
  input: unknown;
  ctx: unknown;
  command: unknown;
}

export type AffCommandHandler = (args: AffCommandHandlerArgs) => unknown | Promise<unknown>;

export interface AffCommand {
  type: "command";
  config: AffCommandConfig;
  handler: AffCommandHandler;
}

export interface AffCommandBuilder {
  handle(handler: AffCommandHandler): AffCommand;
}

function createCommandBuilder(config: AffCommandConfig): AffCommandBuilder {
  return {
    handle(handler) {
      return {
        type: "command",
        config,
        handler,
      };
    },
  };
}

export const Aff = {
  cli: createCliBuilder,
  group: createGroupBuilder,
  command: createCommandBuilder,
};
