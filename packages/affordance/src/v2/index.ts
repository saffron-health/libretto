export type AffRouteMap = Record<string, unknown>;

export interface AffApp {
  getCommands(): [];
  invoke(routeKey: string): Promise<never>;
}

export interface AffCliBuilder {
  routes(routes: AffRouteMap): AffApp;
}

function createCliBuilder(name: string): AffCliBuilder {
  return {
    routes(_routes) {
      return {
        getCommands() {
          return [];
        },
        async invoke(routeKey) {
          throw new Error(`Unknown command route: ${routeKey}`);
        },
      };
    },
  };
}

export interface AffGroupConfig {
  description?: string;
}

export interface AffGroup {
  kind: "group";
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
        kind: "group",
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
  kind: "command";
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
        kind: "command",
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
