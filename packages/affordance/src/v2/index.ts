import {
  findRouteByPath,
  getHelpPath,
  renderGroupHelp,
  renderHelp,
  renderUnknownCommandHelp,
} from "./help.js";
import { createCommandBuilder, type AffCommand } from "./command.js";
import { createGroupBuilder, type AffGroup } from "./group.js";
import { flag, option } from "./input.js";

export type {
  AffCommand,
  AffCommandBuilder,
  AffCommandConfig,
  AffCommandHandler,
  AffCommandHandlerArgs,
} from "./command.js";
export type { AffGroup, AffGroupBuilder, AffGroupConfig } from "./group.js";
export type {
  AffArgumentDefinition,
  AffArgumentsDefinition,
  AffFlagDefinition,
  AffInputRaw,
  AffNamedInputDefinition,
  AffOptionDefinition,
  AffOptionsDefinition,
} from "./input.js";

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
  invoke(
    routeKey: string,
    args?: readonly unknown[],
    options?: Readonly<Record<string, unknown>>,
    initialContext?: unknown,
  ): Promise<unknown>;
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
        async invoke(routeKey, args = [], options = {}, initialContext = {}) {
          const route = commandRoutes.find(({ metadata }) => metadata.routeKey === routeKey);
          if (!route) {
            throw new Error(`Unknown command route: ${routeKey}`);
          }

          return route.command.execute(
            { arguments: args, options },
            initialContext,
            route.metadata,
          );
        },
        async exec(commandLine) {
          const tokens = tokenizeCommandLine(commandLine);
          const helpPath = getHelpPath(tokens);
          if (helpPath) {
            return renderHelp(name, routes, helpPath);
          }

          const routeNode = findRouteByPath(routes, tokens);
          if (routeNode?.type === "group") {
            return renderGroupHelp(name, tokens, routeNode);
          }

          const route = commandRoutes.find(
            ({ metadata }) =>
              metadata.path.length === tokens.length &&
              metadata.path.every((segment, index) => segment === tokens[index]),
          );
          if (!route) {
            throw new Error(renderUnknownCommandHelp(name, routes, tokens));
          }

          return route.command.execute({ arguments: [], options: {} }, {}, route.metadata);
        },
      };
    },
  };
}

function tokenizeCommandLine(commandLine: string): string[] {
  return commandLine.trim().split(/\s+/).filter(Boolean);
}

function flattenCommandRoutes(routes: AffRouteMap, path: string[] = []): AffCommandRoute[] {
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

export const Aff = {
  cli: createCliBuilder,
  group: createGroupBuilder,
  command: createCommandBuilder,
  option,
  flag,
};
