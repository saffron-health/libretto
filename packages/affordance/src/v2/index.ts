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
  invoke(routeKey: string, rawInput?: unknown, initialContext?: unknown): Promise<unknown>;
  exec(commandLine: string): Promise<unknown>;
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
        async invoke(routeKey, rawInput = {}, initialContext = {}) {
          const route = commandRoutes.find(
            ({ metadata }) => metadata.routeKey === routeKey,
          );
          if (!route) {
            throw new Error(`Unknown command route: ${routeKey}`);
          }

          return route.command.handler({
            input: rawInput,
            ctx: initialContext,
            command: route.metadata,
          });
        },
        async exec(commandLine) {
          const tokens = commandLine.trim().split(/\s+/).filter(Boolean);
          const helpPath = getHelpPath(tokens);
          if (helpPath) {
            return renderHelp(name, routes, helpPath);
          }

          const routeNode = findRouteByPath(routes, tokens);
          if (routeNode?.type === "group") {
            return renderGroupHelp(name, tokens, routeNode);
          }

          const route = commandRoutes.find(({ metadata }) => (
            metadata.path.length === tokens.length
              && metadata.path.every((segment, index) => segment === tokens[index])
          ));
          if (!route) {
            throw new Error(`Unknown command: ${commandLine}`);
          }

          return route.command.handler({
            input: {},
            ctx: {},
            command: route.metadata,
          });
        },
      };
    },
  };
}

function getHelpPath(tokens: string[]): string[] | undefined {
  if (tokens[0] === "help") {
    return tokens.slice(1);
  }

  if (tokens.at(-1) === "help") {
    return tokens.slice(0, -1);
  }

  return undefined;
}

function renderHelp(name: string, routes: AffRouteMap, path: string[]): string {
  if (path.length === 0) {
    return renderRootHelp(name, routes);
  }

  const route = findRouteByPath(routes, path);
  if (route?.type === "group") {
    return renderGroupHelp(name, path, route);
  }
  if (route?.type === "command") {
    return renderCommandHelp(name, path, route);
  }

  throw new Error(`Unknown command: ${path.join(" ")}`);
}

function renderRootHelp(name: string, routes: AffRouteMap): string {
  return [
    `Usage: ${name} <command>`,
    "",
    "Commands:",
    ...renderCommandList(routes),
  ].join("\n");
}

function renderGroupHelp(name: string, path: string[], group: AffGroup): string {
  const help = [
    `Usage: ${name} ${path.join(" ")} <subcommand>`,
    "",
    "Commands:",
    ...renderCommandList(group.routes),
  ].join("\n");

  if (!group.config.description) {
    return help;
  }

  return `${group.config.description}\n\n${help}`;
}

function renderCommandHelp(name: string, path: string[], command: AffCommand): string {
  const usage = `Usage: ${name} ${path.join(" ")}`;
  if (!command.config.description) {
    return usage;
  }

  return `${command.config.description}\n\n${usage}`;
}

function renderCommandList(routes: AffRouteMap): string[] {
  return Object.entries(routes).map(([routeSegment, route]) => {
    if (route.type === "group") {
      return `  ${routeSegment} <subcommand>  ${route.config.description ?? ""}`;
    }

    return `  ${routeSegment}  ${route.config.description ?? ""}`;
  });
}

function findRouteByPath(routes: AffRouteMap, path: string[]): AffRoute | undefined {
  let currentRoutes = routes;

  for (const [index, pathSegment] of path.entries()) {
    const route = currentRoutes[pathSegment];
    if (!route) {
      return undefined;
    }
    if (index === path.length - 1) {
      return route;
    }
    if (route.type === "command") {
      return undefined;
    }

    currentRoutes = route.routes;
  }

  return undefined;
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
  command: AffCommandMetadata;
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
