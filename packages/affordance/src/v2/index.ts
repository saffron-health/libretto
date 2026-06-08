import {
  findRouteByPath,
  getHelpPath,
  pathFromTokens,
  renderGroupHelp,
  renderHelp,
  renderUnknownCommandHelp,
} from "./help.js";
import { parseCommandLine } from "./input/parser.js";
import { createCommandBuilder, type AffCommand } from "./command.js";
import { createGroupBuilder, type AffGroup } from "./group.js";
import { flag, option } from "./input/input.js";
import {
  createMiddleware,
  runMiddlewares,
  type AffContext,
  type AffEmptyContext,
  type AffMergeContext,
  type AffMiddleware,
} from "./middleware.js";

export type {
  AffCommand,
  AffCommandBuilder,
  AffCommandConfig,
  AffCommandHandler,
  AffCommandHandlerArgs,
} from "./command.js";
export type { AffGroup, AffGroupBuilder, AffGroupConfig } from "./group.js";
export type {
  AffMiddleware,
  AffMiddlewareArgs,
  AffMiddlewareBuilder,
  AffMiddlewareConfig,
  AffMiddlewareHandler,
  AffMiddlewareNextOptions,
} from "./middleware.js";
export type {
  AffArgumentDefinition,
  AffArgumentsDefinition,
  AffFlagDefinition,
  AffInputRaw,
  AffNamedInputDefinition,
  AffOptionDefinition,
  AffOptionsDefinition,
} from "./input/input.js";

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
  middlewares: readonly AffMiddleware[];
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

export interface AffCliBuilder<TContext extends AffContext = AffEmptyContext> {
  use<TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
    middleware: TContext extends TMiddlewareContext
      ? AffMiddleware<unknown, TMiddlewareContext, TNextContext>
      : never,
  ): AffCliBuilder<AffMergeContext<TContext, TNextContext>>;
  routes(routes: AffRouteMap): AffApp;
}

function createCliBuilder(name: string): AffCliBuilder {
  return createConfiguredCliBuilder(name, []);
}

function createConfiguredCliBuilder<TContext extends AffContext = AffEmptyContext>(
  name: string,
  middlewares: readonly AffMiddleware[],
): AffCliBuilder<TContext> {
  return {
    use<TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
      middleware: TContext extends TMiddlewareContext
        ? AffMiddleware<unknown, TMiddlewareContext, TNextContext>
        : never,
    ) {
      return createConfiguredCliBuilder<AffMergeContext<TContext, TNextContext>>(name, [
        ...middlewares,
        middleware as unknown as AffMiddleware,
      ]);
    },
    routes(routes) {
      const commandRoutes = flattenCommandRoutes(routes, [], middlewares);

      return {
        getCommands() {
          return commandRoutes.map(({ metadata }) => metadata);
        },
        async invoke(routeKey, args = [], options = {}, initialContext = {}) {
          const route = commandRoutes.find(({ metadata }) => metadata.routeKey === routeKey);
          if (!route) {
            throw new Error(`Unknown command route: ${routeKey}`);
          }

          const commandName = `${name} ${route.metadata.path.join(" ")}`;
          const rawInput = { arguments: args, options };
          if (
            !route.command.input &&
            (rawInput.arguments.length > 0 || Object.keys(rawInput.options).length > 0)
          ) {
            throw new Error(`Unexpected arguments for ${commandName}.`);
          }

          const input = await route.command.parse(rawInput, commandName);
          return runMiddlewares(
            route.middlewares,
            { input, ctx: initialContext, command: route.metadata },
            (ctx) => route.command.run(input, ctx, route.metadata),
          );
        },
        async exec(commandLine) {
          const inputTokens = parseCommandLine(commandLine);
          const inputPath = pathFromTokens(inputTokens);
          const helpPath = getHelpPath(inputTokens);
          if (helpPath) {
            return renderHelp(name, routes, helpPath);
          }

          const routeNode = findRouteByPath(routes, inputPath);
          if (routeNode?.type === "group") {
            return renderGroupHelp(name, inputPath, routeNode);
          }

          const route = findCommandRouteByPath(commandRoutes, inputPath);
          if (!route) {
            throw new Error(renderUnknownCommandHelp(name, routes, inputPath));
          }

          const rawInput = inputTokens.slice(route.metadata.path.length).reduce<{
            arguments: string[];
            options: Record<string, unknown>;
          }>(
            (input, token) => {
              if (token.type === "argument") {
                input.arguments.push(token.value);
              } else {
                input.options[token.key] = token.value;
              }
              return input;
            },
            { arguments: [], options: {} },
          );
          if (
            !route.command.input &&
            (rawInput.arguments.length > 0 || Object.keys(rawInput.options).length > 0)
          ) {
            throw new Error(`Unexpected arguments for ${name} ${route.metadata.path.join(" ")}.`);
          }

          const commandName = `${name} ${route.metadata.path.join(" ")}`;
          const input = await route.command.parse(rawInput, commandName);
          return runMiddlewares(
            route.middlewares,
            { input, ctx: {}, command: route.metadata },
            (ctx) => route.command.run(input, ctx, route.metadata),
          );
        },
      };
    },
  };
}

function flattenCommandRoutes(
  routes: AffRouteMap,
  path: string[] = [],
  middlewares: readonly AffMiddleware[] = [],
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
        middlewares: [...middlewares, ...route.middlewares],
      });
      continue;
    }

    if (route.type === "group") {
      commandRoutes.push(
        ...flattenCommandRoutes(route.routes, routePath, [...middlewares, ...route.middlewares]),
      );
    }
  }

  return commandRoutes;
}

function findCommandRouteByPath(
  commandRoutes: readonly AffCommandRoute[],
  path: readonly string[],
): AffCommandRoute | undefined {
  return commandRoutes
    .filter(({ metadata }) => metadata.path.every((segment, index) => segment === path[index]))
    .sort((left, right) => right.metadata.path.length - left.metadata.path.length)[0];
}

export const Aff = {
  cli: createCliBuilder,
  group: createGroupBuilder,
  command: createCommandBuilder,
  middleware: createMiddleware,
  option,
  flag,
};
