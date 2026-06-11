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
  AffFlagConfig,
  AffFlagDefinition,
  AffInputRaw,
  AffNamedInputDefinition,
  AffNamedInputConfig,
  AffOptionConfig,
  AffOptionDefinition,
  AffOptionsDefinition,
} from "./input/input.js";

/** A command or command group that can appear in an Aff route tree. */
export type AffRoute = AffGroup | AffCommand;

/** Named child routes passed to `Aff.cli(...).routes(...)` or `Aff.group(...).routes(...)`. */
export type AffRouteMap = Record<string, AffRoute>;

/** Resolved command metadata exposed to handlers, middleware, and command listings. */
export interface AffCommandMetadata {
  /** Dot-separated route key, such as `cloud.login`. */
  routeKey: string;
  /** Command path segments as typed on the command line, such as `["cloud", "login"]`. */
  path: string[];
  /** Optional user-facing description from the command config. */
  description?: string;
}

interface AffCommandRoute {
  metadata: AffCommandMetadata;
  command: AffCommand;
  middlewares: readonly AffMiddleware[];
}

/** A constructed Aff CLI application. */
export interface AffApp {
  /** Return metadata for every command reachable from the app root. */
  getCommands(): AffCommandMetadata[];
  /**
   * Invoke a command by route key using already-tokenized argument and option values.
   *
   * Useful for tests and programmatic integrations that do not need command-line parsing.
   */
  invoke(
    routeKey: string,
    args?: readonly unknown[],
    options?: Readonly<Record<string, unknown>>,
    initialContext?: unknown,
  ): Promise<unknown>;
  /** Execute a command-line string, including route resolution, input parsing, and middleware. */
  exec(commandLine: string): Promise<unknown>;
}

/** Root CLI builder returned by `Aff.cli(name)`. */
export interface AffCliBuilder<TContext extends AffContext = AffEmptyContext> {
  /** Add root middleware that runs for every resolved command. */
  use<TMiddlewareContext extends AffContext, TNextContext extends AffContext>(
    middleware: TContext extends TMiddlewareContext
      ? AffMiddleware<unknown, TMiddlewareContext, TNextContext>
      : never,
  ): AffCliBuilder<AffMergeContext<TContext, TNextContext>>;
  /** Attach the root route tree and construct an executable app. */
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

/** Entry point for building Aff v2 command-line applications. */
export const Aff: {
  /** Create a root CLI builder with the given executable name. */
  cli: typeof createCliBuilder;
  /** Create a command group builder for nested routes. */
  group: typeof createGroupBuilder;
  /** Create a command builder for a leaf command. */
  command: typeof createCommandBuilder;
  /**
   * Create middleware, either as an inline typed identity helper or as a described builder.
   *
   * @example
   * ```ts
   * const telemetry = Aff.middleware({ description: "telemetry" }).handle(async ({ next }) => {
   *   return next();
   * });
   * ```
   */
  middleware: typeof createMiddleware;
  /** Wrap a valued option schema when option-specific Aff metadata is needed. */
  option: typeof option;
  /** Declare a boolean flag option that defaults to `false` when omitted. */
  flag: typeof flag;
} = {
  cli: createCliBuilder,
  group: createGroupBuilder,
  command: createCommandBuilder,
  middleware: createMiddleware,
  option,
  flag,
};
