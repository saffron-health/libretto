import type { AffCommand, AffGroup, AffRoute, AffRouteMap } from "./index.js";

export function getHelpPath(tokens: string[]): string[] | undefined {
  if (tokens[0] === "help") {
    return tokens.slice(1);
  }

  const helpFlagIndex = tokens.findIndex(isHelpFlag);
  if (helpFlagIndex >= 0) {
    return tokens.slice(0, helpFlagIndex);
  }

  if (tokens.at(-1) === "help") {
    return tokens.slice(0, -1);
  }

  return undefined;
}

function isHelpFlag(token: string): boolean {
  return token === "--help" || token === "-h";
}

export function renderHelp(name: string, routes: AffRouteMap, path: string[]): string {
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

  throw new Error(renderUnknownCommandHelp(name, routes, path));
}

export function renderUnknownCommandHelp(
  name: string,
  routes: AffRouteMap,
  path: string[],
): string {
  const nearestGroup = findNearestGroupByPath(routes, path);
  const nearestHelp = nearestGroup
    ? renderGroupHelp(name, nearestGroup.path, nearestGroup.group)
    : renderRootHelp(name, routes);

  return [`Unknown command: ${path.join(" ")}`, "", nearestHelp].join("\n");
}

export function renderRootHelp(name: string, routes: AffRouteMap): string {
  return [`Usage: ${name} <command>`, "", "Commands:", ...renderCommandList(routes)].join("\n");
}

export function renderGroupHelp(name: string, path: string[], group: AffGroup): string {
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

export function findRouteByPath(routes: AffRouteMap, path: string[]): AffRoute | undefined {
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

interface NearestGroupMatch {
  path: string[];
  group: AffGroup;
}

function findNearestGroupByPath(
  routes: AffRouteMap,
  path: string[],
): NearestGroupMatch | undefined {
  let currentRoutes = routes;
  let nearestGroup: NearestGroupMatch | undefined;
  const visitedPath: string[] = [];

  for (const pathSegment of path) {
    const route = currentRoutes[pathSegment];
    if (!route || route.type === "command") {
      return nearestGroup;
    }

    visitedPath.push(pathSegment);
    nearestGroup = { path: [...visitedPath], group: route };
    currentRoutes = route.routes;
  }

  return nearestGroup;
}
