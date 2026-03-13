import { z, type RefinementCtx, type ZodTypeAny } from "zod";

type RecordUnknown = Record<string, unknown>;

export type SimpleCLICommandConfig = {
  description: string;
};

export type SimpleCLIInputRaw = {
  positionals?: readonly unknown[];
  named?: Readonly<Record<string, unknown>>;
};

export type SimpleCLIContext = Record<string, unknown>;

export type SimpleCLICommandMeta = {
  routeKey: string;
  path: readonly string[];
  description: string;
};

export type SimpleCLIMiddlewareArgs<TInput> = {
  input: TInput;
  ctx: SimpleCLIContext;
  command: SimpleCLICommandMeta;
};

export type SimpleCLIMiddleware<TInput = unknown> = (
  args: SimpleCLIMiddlewareArgs<TInput>,
) => void | SimpleCLIContext | Promise<void | SimpleCLIContext>;

export type SimpleCLIHandler<TInput = unknown, TResult = unknown> = (
  args: SimpleCLIMiddlewareArgs<TInput>,
) => TResult | Promise<TResult>;

type SimpleCLIPositionalsDefinition = readonly SimpleCLIPositionalDefinition<
  string,
  ZodTypeAny
>[];

type SimpleCLINamedDefinition = Record<string, SimpleCLINamedArgDefinition<ZodTypeAny>>;

type SimpleCLIInputDefinition = {
  positionals: SimpleCLIPositionalsDefinition;
  named: SimpleCLINamedDefinition;
};

type InferPositionals<TDefs extends SimpleCLIPositionalsDefinition> = {
  [TDef in TDefs[number] as TDef["key"]]: z.output<TDef["schema"]>;
};

type InferNamed<TDefs extends SimpleCLINamedDefinition> = {
  [K in keyof TDefs]: z.output<TDefs[K]["schema"]>;
};

type Merge<TLeft, TRight> = {
  [K in keyof TLeft | keyof TRight]: K extends keyof TRight
    ? TRight[K]
    : K extends keyof TLeft
      ? TLeft[K]
      : never;
};

type InputObjectFor<
  TPositionals extends SimpleCLIPositionalsDefinition,
  TNamed extends SimpleCLINamedDefinition,
> = Merge<InferPositionals<TPositionals>, InferNamed<TNamed>>;

type NormalizedCommandDefinition<TInput, TResult> = {
  config: SimpleCLICommandConfig;
  input?: SimpleCLIInput<TInput>;
  middlewares: SimpleCLIMiddleware<TInput>[];
  handler?: SimpleCLIHandler<TInput, TResult>;
};

type SimpleCLIRouteTree = Record<string, SimpleCLIGroup | SimpleCLICommandBuilder<any, any>>;

export type SimpleCLIResolvedCommand = {
  routeKey: string;
  path: readonly string[];
  description: string;
};

type InternalResolvedCommand = SimpleCLIResolvedCommand & {
  input?: SimpleCLIInput<unknown>;
  middlewares: SimpleCLIMiddleware<unknown>[];
  handler: SimpleCLIHandler<unknown, unknown>;
};

type InternalResolvedGroup = {
  routeKey: string;
  path: readonly string[];
  description?: string;
};

type InternalResolvedRouteEntry = {
  kind: "group" | "command";
  path: readonly string[];
};

type ResolveRouteTreeResult = {
  commands: InternalResolvedCommand[];
  groups: InternalResolvedGroup[];
  routeEntries: InternalResolvedRouteEntry[];
};

type SimpleCLIGroupConfig = {
  description?: string;
  routes: SimpleCLIRouteTree;
};

type ParsedInvocation = {
  routeKey: string;
  rawInput: SimpleCLIInputRaw;
};

function toCamelCase(input: string): string {
  return input.replace(/-([a-zA-Z0-9])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function toKebabCase(input: string): string {
  return input.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function zodObjectFromShape(
  shape: Record<string, ZodTypeAny>,
): z.ZodObject<Record<string, ZodTypeAny>> {
  return z.object(shape);
}

function schemaAcceptsUndefined(schema: ZodTypeAny): boolean {
  return schema.safeParse(undefined).success;
}

function pathToRouteKey(path: readonly string[]): string {
  return path.join(".");
}

function pathStartsWith(
  path: readonly string[],
  prefix: readonly string[],
): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((token, index) => path[index] === token);
}

function formatListEntry(label: string, description?: string): string {
  return description ? `  ${label}  ${description}` : `  ${label}`;
}

function isHelpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

function parseBooleanFlagValue(rawValue: string, flagName: string): boolean {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new Error(`Invalid value for --${flagName}: expected true or false.`);
}

function buildUsagePositionalToken(
  positional: SimpleCLIPositionalDefinition<string, ZodTypeAny>,
): string {
  return schemaAcceptsUndefined(positional.schema)
    ? `[${positional.key}]`
    : `<${positional.key}>`;
}

function buildNamedArgFlagName(
  key: string,
  spec: SimpleCLINamedArgDefinition<ZodTypeAny>,
): string {
  if (spec.source === "--") return "--";
  return spec.name ?? toKebabCase(key);
}

function buildNamedArgHelpLabel(
  key: string,
  spec: SimpleCLINamedArgDefinition<ZodTypeAny>,
): string {
  if (spec.source === "--") return "-- <args...>";
  const flagName = buildNamedArgFlagName(key, spec);
  if (spec.kind === "flag") {
    return `--${flagName}`;
  }
  return `--${flagName} <value>`;
}

export class SimpleCLIInput<TOutput> {
  constructor(
    private readonly normalize: (raw: SimpleCLIInputRaw) => unknown,
    private readonly schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
    private readonly definition: SimpleCLIInputDefinition,
  ) {}

  parse(raw: SimpleCLIInputRaw): TOutput {
    return this.schema.parse(this.normalize(raw));
  }

  getDefinition(): SimpleCLIInputDefinition {
    return this.definition;
  }

  refine(
    check: (arg: TOutput) => unknown,
    message?: string,
  ): SimpleCLIInput<TOutput> {
    const nextSchema = this.schema.refine(
      (value) => Boolean(check(value)),
      message ? { message } : undefined,
    );
    return new SimpleCLIInput(this.normalize, nextSchema, this.definition);
  }

  superRefine(
    check: (arg: TOutput, ctx: RefinementCtx) => void,
  ): SimpleCLIInput<TOutput> {
    const nextSchema = this.schema.superRefine(check);
    return new SimpleCLIInput(this.normalize, nextSchema, this.definition);
  }
}

export type SimpleCLIPositionalDefinition<
  TKey extends string,
  TSchema extends ZodTypeAny,
> = {
  kind: "positional";
  key: TKey;
  schema: TSchema;
  help?: string;
};

export type SimpleCLINamedArgDefinition<TSchema extends ZodTypeAny> = {
  kind: "option" | "flag";
  schema: TSchema;
  help?: string;
  name?: string;
  source?: "--";
};

export class SimpleCLICommandBuilder<TInput, TResult> {
  constructor(private readonly definition: NormalizedCommandDefinition<TInput, TResult>) {}

  input<TNextInput>(input: SimpleCLIInput<TNextInput>): SimpleCLICommandBuilder<TNextInput, TResult> {
    return new SimpleCLICommandBuilder<TNextInput, TResult>({
      config: this.definition.config,
      input,
      middlewares: this.definition.middlewares as unknown as SimpleCLIMiddleware<TNextInput>[],
      handler: this.definition.handler as unknown as
        | SimpleCLIHandler<TNextInput, TResult>
        | undefined,
    });
  }

  use(
    middleware: SimpleCLIMiddleware<TInput>,
  ): SimpleCLICommandBuilder<TInput, TResult> {
    return new SimpleCLICommandBuilder<TInput, TResult>({
      ...this.definition,
      middlewares: [...this.definition.middlewares, middleware],
    });
  }

  handle<TNextResult>(
    handler: SimpleCLIHandler<TInput, TNextResult>,
  ): SimpleCLICommandBuilder<TInput, TNextResult> {
    return new SimpleCLICommandBuilder<TInput, TNextResult>({
      config: this.definition.config,
      input: this.definition.input,
      middlewares: this.definition.middlewares,
      handler,
    });
  }

  getDefinition(): NormalizedCommandDefinition<TInput, TResult> {
    return this.definition;
  }
}

export type SimpleCLIGroup = {
  kind: "group";
  description?: string;
  routes: SimpleCLIRouteTree;
  middlewares: SimpleCLIMiddleware[];
};

export class SimpleCLIApp {
  private readonly resolvedCommands = new Map<string, InternalResolvedCommand>();
  private readonly resolvedGroups = new Map<string, InternalResolvedGroup>();
  private readonly routeEntries: InternalResolvedRouteEntry[];

  constructor(
    readonly name: string,
    routes: SimpleCLIRouteTree,
  ) {
    const resolution = resolveRouteTree(routes);

    for (const group of resolution.groups) {
      if (this.resolvedGroups.has(group.routeKey)) {
        throw new Error(`Duplicate group route key: ${group.routeKey}`);
      }
      this.resolvedGroups.set(group.routeKey, group);
    }

    for (const command of resolution.commands) {
      if (this.resolvedCommands.has(command.routeKey)) {
        throw new Error(`Duplicate command route key: ${command.routeKey}`);
      }
      this.resolvedCommands.set(command.routeKey, command);
    }

    this.routeEntries = resolution.routeEntries;
  }

  getCommands(): SimpleCLIResolvedCommand[] {
    return [...this.resolvedCommands.values()].map((command) => ({
      routeKey: command.routeKey,
      path: command.path,
      description: command.description,
    }));
  }

  async invoke(
    routeKey: string,
    rawInput: SimpleCLIInputRaw,
    initialContext: SimpleCLIContext = {},
  ): Promise<unknown> {
    const command = this.resolvedCommands.get(routeKey);
    if (!command) {
      throw new Error(`Unknown command route key "${routeKey}".`);
    }

    const input = command.input ? command.input.parse(rawInput) : rawInput;
    let ctx: SimpleCLIContext = { ...initialContext };
    const meta: SimpleCLICommandMeta = {
      routeKey: command.routeKey,
      path: command.path,
      description: command.description,
    };

    for (const middleware of command.middlewares) {
      const next = await middleware({ input, ctx, command: meta });
      if (next !== undefined) {
        ctx = next;
      }
    }

    return command.handler({ input, ctx, command: meta });
  }

  async run(args: readonly string[]): Promise<unknown> {
    const helpPath = this.resolveHelpPath(args);
    if (helpPath) {
      return this.renderHelp(helpPath);
    }

    const exactGroup = this.findGroupByPath(args);
    if (exactGroup) {
      return this.renderGroupHelp(exactGroup);
    }

    const parsed = this.parseInvocation(args);
    return this.invoke(parsed.routeKey, parsed.rawInput);
  }

  renderHelp(path: readonly string[] = []): string {
    if (path.length === 0) {
      return this.renderRootHelp();
    }

    const group = this.findGroupByPath(path);
    if (group) {
      return this.renderGroupHelp(group);
    }

    const command = this.findCommandByPath(path);
    if (command) {
      return this.renderCommandHelp(command);
    }

    throw new Error(`Unknown help topic "${path.join(" ")}".`);
  }

  private resolveHelpPath(args: readonly string[]): readonly string[] | null {
    if (args.length === 0) return [];

    if (args[0] === "help") {
      return args.slice(1);
    }

    if (isHelpFlag(args[0]!)) {
      return [];
    }

    const helpFlagIndex = args.findIndex((arg) => isHelpFlag(arg));
    if (helpFlagIndex >= 0) {
      return args.slice(0, helpFlagIndex);
    }

    return null;
  }

  private parseInvocation(args: readonly string[]): ParsedInvocation {
    const command = this.findBestMatchingCommand(args);
    if (!command) {
      const exactGroup = this.findGroupByPath(args);
      if (exactGroup) {
        throw new Error(this.renderGroupHelp(exactGroup));
      }
      throw new Error(`Unknown command: ${args.join(" ")}`);
    }

    const rawInput = this.parseCommandInput(command, args.slice(command.path.length));
    return {
      routeKey: command.routeKey,
      rawInput,
    };
  }

  private parseCommandInput(
    command: InternalResolvedCommand,
    args: readonly string[],
  ): SimpleCLIInputRaw {
    const inputDefinition = command.input?.getDefinition();
    if (!inputDefinition) {
      if (args.length > 0) {
        throw new Error(`Unexpected arguments for ${this.name} ${command.path.join(" ")}.`);
      }
      return {
        positionals: [],
        named: {},
      };
    }

    const positionals: string[] = [];
    const named: Record<string, unknown> = {};
    const namedSpecs = buildNamedArgLookup(inputDefinition.named);
    const passthroughEntry = Object.entries(inputDefinition.named).find(
      ([, spec]) => spec.source === "--",
    );

    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;

      if (arg === "--") {
        if (!passthroughEntry) {
          throw new Error(`Unexpected "--" for ${this.name} ${command.path.join(" ")}.`);
        }
        named["--"] = args.slice(index + 1);
        break;
      }

      if (arg.startsWith("--")) {
        const [rawName, inlineValue] = splitNamedArg(arg.slice(2));
        const namedEntry = namedSpecs.get(rawName);
        if (!namedEntry) {
          throw new Error(`Unknown option: --${rawName}`);
        }

        const storeKey = buildNamedArgFlagName(namedEntry.key, namedEntry.spec);
        if (namedEntry.spec.kind === "flag") {
          named[storeKey] = inlineValue === undefined
            ? true
            : parseBooleanFlagValue(inlineValue, rawName);
          continue;
        }

        if (inlineValue !== undefined) {
          named[storeKey] = inlineValue;
          continue;
        }

        const nextValue = args[index + 1];
        if (nextValue === undefined) {
          throw new Error(`Missing value for --${rawName}.`);
        }

        named[storeKey] = nextValue;
        index += 1;
        continue;
      }

      if (arg.startsWith("-")) {
        throw new Error(`Unknown option: ${arg}`);
      }

      positionals.push(arg);
    }

    validateParsedPositionals(command, inputDefinition.positionals, positionals);
    validateRequiredNamedArgs(inputDefinition.named, named);

    return {
      positionals,
      named,
    };
  }

  private renderRootHelp(): string {
    const lines = [`Usage: ${this.name} <command>`, "", "Commands:"];
    for (const entry of this.getImmediateRouteEntries([])) {
      lines.push(formatListEntry(entry.label, entry.description));
    }
    return lines.join("\n");
  }

  private renderGroupHelp(group: InternalResolvedGroup): string {
    const lines: string[] = [];

    if (group.description) {
      lines.push(group.description, "");
    }

    lines.push(`Usage: ${this.name} ${group.path.join(" ")} <subcommand>`);
    lines.push("", "Commands:");

    for (const entry of this.getImmediateRouteEntries(group.path)) {
      lines.push(formatListEntry(entry.label, entry.description));
    }

    return lines.join("\n");
  }

  private renderCommandHelp(command: InternalResolvedCommand): string {
    const lines = [
      command.description,
      "",
      `Usage: ${this.buildCommandUsage(command)}`,
    ];

    const inputDefinition = command.input?.getDefinition();
    if (!inputDefinition) {
      return lines.join("\n");
    }

    const argumentLines = inputDefinition.positionals.map((positional) =>
      formatListEntry(buildUsagePositionalToken(positional), positional.help),
    );

    if (argumentLines.length > 0) {
      lines.push("", "Arguments:");
      lines.push(...argumentLines);
    }

    const optionLines = Object.entries(inputDefinition.named).map(([key, spec]) =>
      formatListEntry(buildNamedArgHelpLabel(key, spec), spec.help),
    );

    if (optionLines.length > 0) {
      lines.push("", "Options:");
      lines.push(...optionLines);
    }

    return lines.join("\n");
  }

  private buildCommandUsage(command: InternalResolvedCommand): string {
    const tokens = [this.name, ...command.path];
    const inputDefinition = command.input?.getDefinition();

    if (!inputDefinition) {
      return tokens.join(" ");
    }

    tokens.push(...inputDefinition.positionals.map(buildUsagePositionalToken));

    if (Object.keys(inputDefinition.named).length > 0) {
      tokens.push("[options]");
    }

    return tokens.join(" ");
  }

  private getImmediateRouteEntries(path: readonly string[]): Array<{
    label: string;
    description?: string;
  }> {
    const seen = new Set<string>();
    const entries: Array<{ label: string; description?: string }> = [];

    for (const routeEntry of this.routeEntries) {
      if (!pathStartsWith(routeEntry.path, path)) continue;
      if (routeEntry.path.length !== path.length + 1) continue;

      const token = routeEntry.path[path.length]!;
      if (seen.has(token)) continue;
      seen.add(token);

      if (routeEntry.kind === "group") {
        const group = this.findGroupByPath(routeEntry.path);
        entries.push({
          label: `${token} <subcommand>`,
          description: group?.description,
        });
        continue;
      }

      const command = this.findCommandByPath(routeEntry.path);
      entries.push({
        label: token,
        description: command?.description,
      });
    }

    return entries;
  }

  private findBestMatchingCommand(args: readonly string[]): InternalResolvedCommand | null {
    let bestMatch: InternalResolvedCommand | null = null;

    for (const command of this.resolvedCommands.values()) {
      if (command.path.length > args.length) continue;
      if (!pathStartsWith(args, command.path)) continue;
      if (!bestMatch || command.path.length > bestMatch.path.length) {
        bestMatch = command;
      }
    }

    return bestMatch;
  }

  private findCommandByPath(path: readonly string[]): InternalResolvedCommand | null {
    const routeKey = pathToRouteKey(path);
    return this.resolvedCommands.get(routeKey) ?? null;
  }

  private findGroupByPath(path: readonly string[]): InternalResolvedGroup | null {
    const routeKey = pathToRouteKey(path);
    return this.resolvedGroups.get(routeKey) ?? null;
  }
}

function splitNamedArg(arg: string): [string, string | undefined] {
  const separatorIndex = arg.indexOf("=");
  if (separatorIndex < 0) return [arg, undefined];
  return [
    arg.slice(0, separatorIndex),
    arg.slice(separatorIndex + 1),
  ];
}

function buildNamedArgLookup(namedDefinition: SimpleCLINamedDefinition): Map<
  string,
  { key: string; spec: SimpleCLINamedArgDefinition<ZodTypeAny> }
> {
  const lookup = new Map<string, { key: string; spec: SimpleCLINamedArgDefinition<ZodTypeAny> }>();

  for (const [key, spec] of Object.entries(namedDefinition)) {
    if (spec.source === "--") continue;
    const flagName = buildNamedArgFlagName(key, spec);
    lookup.set(flagName, { key, spec });
    lookup.set(key, { key, spec });
    lookup.set(toCamelCase(flagName), { key, spec });
  }

  return lookup;
}

function validateParsedPositionals(
  command: InternalResolvedCommand,
  definitions: SimpleCLIPositionalsDefinition,
  positionals: readonly string[],
): void {
  if (positionals.length > definitions.length) {
    throw new Error(`Unexpected arguments for ${command.path.join(" ")}.`);
  }

  definitions.forEach((definition, index) => {
    if (positionals[index] !== undefined) return;
    if (schemaAcceptsUndefined(definition.schema)) return;
    throw new Error(`Missing required argument <${definition.key}>.`);
  });
}

function validateRequiredNamedArgs(
  definitions: SimpleCLINamedDefinition,
  named: Readonly<Record<string, unknown>>,
): void {
  for (const [key, spec] of Object.entries(definitions)) {
    if (schemaAcceptsUndefined(spec.schema)) continue;
    const flagName = spec.source === "--" ? "--" : buildNamedArgFlagName(key, spec);
    if (Object.prototype.hasOwnProperty.call(named, flagName)) continue;
    if (spec.source === "--") {
      throw new Error(`Missing required passthrough arguments after --.`);
    }
    throw new Error(`Missing required option --${flagName}.`);
  }
}

function resolveRouteTree(
  routes: SimpleCLIRouteTree,
  parentPath: readonly string[] = [],
  parentMiddlewares: readonly SimpleCLIMiddleware[] = [],
): ResolveRouteTreeResult {
  const resolved: ResolveRouteTreeResult = {
    commands: [],
    groups: [],
    routeEntries: [],
  };

  for (const [token, routeValue] of Object.entries(routes)) {
    if (isGroup(routeValue)) {
      const groupPath = [...parentPath, token];
      resolved.groups.push({
        routeKey: pathToRouteKey(groupPath),
        path: groupPath,
        description: routeValue.description,
      });
      resolved.routeEntries.push({
        kind: "group",
        path: groupPath,
      });

      const nested = resolveRouteTree(
        routeValue.routes,
        groupPath,
        [...parentMiddlewares, ...routeValue.middlewares],
      );
      resolved.commands.push(...nested.commands);
      resolved.groups.push(...nested.groups);
      resolved.routeEntries.push(...nested.routeEntries);
      continue;
    }

    const command = routeValue.getDefinition();
    if (!command.handler) {
      throw new Error(`Command "${[...parentPath, token].join(" ")}" is missing a handler.`);
    }

    const path = [...parentPath, token];
    resolved.commands.push({
      routeKey: pathToRouteKey(path),
      path,
      description: command.config.description,
      input: command.input,
      middlewares: [
        ...parentMiddlewares,
        ...(command.middlewares as unknown as SimpleCLIMiddleware<unknown>[]),
      ],
      handler: command.handler as unknown as SimpleCLIHandler<unknown, unknown>,
    });
    resolved.routeEntries.push({
      kind: "command",
      path,
    });
  }

  return resolved;
}

function isGroup(value: SimpleCLIGroup | SimpleCLICommandBuilder<any, any>): value is SimpleCLIGroup {
  return (value as SimpleCLIGroup).kind === "group";
}

function buildInputNormalizer<
  TPositionals extends SimpleCLIPositionalsDefinition,
  TNamed extends SimpleCLINamedDefinition,
>(
  definition: {
    positionals: TPositionals;
    named: TNamed;
  },
): (raw: SimpleCLIInputRaw) => InputObjectFor<TPositionals, TNamed> {
  return (raw) => {
    const output: RecordUnknown = {};
    const positionals = raw.positionals ?? [];
    const named = raw.named ?? {};

    definition.positionals.forEach((positional, index) => {
      output[positional.key] = positionals[index];
    });

    for (const [key, spec] of Object.entries(definition.named)) {
      const sourceKey = spec.source === "--" ? "--" : (spec.name ?? key);
      const normalizedCandidates = [
        sourceKey,
        spec.name ? toCamelCase(spec.name) : "",
        toKebabCase(key),
        key,
      ].filter((candidate) => candidate.length > 0);

      let value: unknown = undefined;
      for (const candidate of normalizedCandidates) {
        if (Object.prototype.hasOwnProperty.call(named, candidate)) {
          value = named[candidate];
          break;
        }
      }
      output[key] = value;
    }

    return output as InputObjectFor<TPositionals, TNamed>;
  };
}

function buildInputSchema<
  TPositionals extends SimpleCLIPositionalsDefinition,
  TNamed extends SimpleCLINamedDefinition,
>(
  definition: {
    positionals: TPositionals;
    named: TNamed;
  },
): z.ZodType<InputObjectFor<TPositionals, TNamed>, z.ZodTypeDef, unknown> {
  const shape: Record<string, ZodTypeAny> = {};

  for (const positional of definition.positionals) {
    shape[positional.key] = positional.schema;
  }
  for (const [key, named] of Object.entries(definition.named)) {
    shape[key] = named.schema;
  }

  return zodObjectFromShape(shape) as z.ZodType<InputObjectFor<TPositionals, TNamed>>;
}

function positional<TKey extends string, TSchema extends ZodTypeAny>(
  key: TKey,
  schema: TSchema,
  options?: { help?: string },
): SimpleCLIPositionalDefinition<TKey, TSchema> {
  return {
    kind: "positional",
    key,
    schema,
    help: options?.help,
  };
}

function option<TSchema extends ZodTypeAny>(
  schema: TSchema,
  options?: { help?: string; name?: string; source?: "--" },
): SimpleCLINamedArgDefinition<TSchema> {
  return {
    kind: "option",
    schema,
    help: options?.help,
    name: options?.name,
    source: options?.source,
  };
}

function flag(
  options?: { help?: string; name?: string },
): SimpleCLINamedArgDefinition<z.ZodDefault<z.ZodBoolean>> {
  return {
    kind: "flag",
    schema: z.boolean().default(false),
    help: options?.help,
    name: options?.name,
  };
}

function input<
  const TPositionals extends SimpleCLIPositionalsDefinition,
  const TNamed extends SimpleCLINamedDefinition,
>(definition: {
  positionals: TPositionals;
  named: TNamed;
}): SimpleCLIInput<InputObjectFor<TPositionals, TNamed>> {
  return new SimpleCLIInput(
    buildInputNormalizer(definition),
    buildInputSchema(definition),
    definition,
  );
}

function command(
  config: SimpleCLICommandConfig,
): SimpleCLICommandBuilder<unknown, unknown> {
  return new SimpleCLICommandBuilder({
    config,
    middlewares: [],
  });
}

function group(
  config: SimpleCLIGroupConfig,
): SimpleCLIGroup {
  return {
    kind: "group",
    description: config.description,
    routes: config.routes,
    middlewares: [],
  };
}

function middleware<TInput>(
  next: SimpleCLIMiddleware<TInput>,
): SimpleCLIMiddleware<TInput> {
  return next;
}

function use(...middlewares: SimpleCLIMiddleware[]) {
  return {
    group(config: SimpleCLIGroupConfig): SimpleCLIGroup {
      return {
        kind: "group",
        description: config.description,
        routes: config.routes,
        middlewares,
      };
    },
    command(config: SimpleCLICommandConfig): SimpleCLICommandBuilder<unknown, unknown> {
      let next = command(config);
      for (const current of middlewares) {
        next = next.use(current);
      }
      return next;
    },
  };
}

function define(name: string, routes: SimpleCLIRouteTree): SimpleCLIApp {
  return new SimpleCLIApp(name, routes);
}

export type InferInput<TInput extends SimpleCLIInput<unknown>> = TInput extends SimpleCLIInput<
  infer TOutput
>
  ? TOutput
  : never;

export const SimpleCLI = {
  define,
  command,
  group,
  use,
  middleware,
  input,
  positional,
  option,
  flag,
};
