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

export type SimpleCLIMiddlewareArgs<
  TInput,
  TContext extends SimpleCLIContext,
> = {
  input: TInput;
  ctx: TContext;
  command: SimpleCLICommandMeta;
};

export type SimpleCLIMiddleware<
  TInput = unknown,
  TContextIn extends SimpleCLIContext = {},
  TContextOut extends SimpleCLIContext = TContextIn,
> = (
  args: SimpleCLIMiddlewareArgs<TInput, TContextIn>,
) => void | TContextOut | Promise<void | TContextOut>;

export type SimpleCLIHandler<
  TInput = unknown,
  TContext extends SimpleCLIContext = {},
  TResult = unknown,
> = (
  args: SimpleCLIMiddlewareArgs<TInput, TContext>,
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

type SimpleCLIAppConfig = {
  globalNamed?: SimpleCLINamedDefinition;
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

type AnySimpleCLIMiddleware = SimpleCLIMiddleware<any, any, any>;

type NormalizedCommandDefinition<
  TInput,
  TContextIn extends SimpleCLIContext,
  TContext extends SimpleCLIContext,
  TResult,
> = {
  config: SimpleCLICommandConfig;
  input?: SimpleCLIInput<TInput>;
  middlewares: AnySimpleCLIMiddleware[];
  handler?: SimpleCLIHandler<TInput, TContext, TResult>;
};

type SimpleCLIRouteTree<TContext extends SimpleCLIContext = {}> = Record<
  string,
  SimpleCLIGroup<TContext, any> | SimpleCLICommandBuilder<any, TContext, any, any>
>;

export type SimpleCLIResolvedCommand = {
  routeKey: string;
  path: readonly string[];
  description: string;
};

type InternalResolvedCommand = SimpleCLIResolvedCommand & {
  input?: SimpleCLIInput<unknown>;
  middlewares: AnySimpleCLIMiddleware[];
  handler: SimpleCLIHandler<unknown, SimpleCLIContext, unknown>;
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

type SimpleCLIGroupConfig<TContext extends SimpleCLIContext> = {
  description?: string;
  routes: SimpleCLIRouteTree<TContext>;
};

type ParsedInvocation = {
  routeKey: string;
  rawInput: SimpleCLIInputRaw;
};

type ExtractedGlobalArgs = {
  args: readonly string[];
  named: Readonly<Record<string, unknown>>;
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

function normalizeNamedArgToken(token: string): string {
  return token.replace(/^-{1,2}/, "");
}

export class SimpleCLIInput<TOutput> {
  constructor(
    private readonly normalize: (raw: SimpleCLIInputRaw) => unknown,
    private readonly schema: z.ZodType<TOutput, unknown>,
    private readonly definition: SimpleCLIInputDefinition,
  ) {}

  parse(raw: SimpleCLIInputRaw): TOutput {
    try {
      return this.schema.parse(this.normalize(raw));
    } catch (error) {
      if (error instanceof z.ZodError) {
        const messages = error.issues
          .map((issue) => issue.message)
          .filter((message) => message.length > 0);
        if (messages.length > 0) {
          throw new Error(messages.join("\n"));
        }
      }
      throw error;
    }
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
  variadic?: boolean;
};

export type SimpleCLINamedArgDefinition<TSchema extends ZodTypeAny> = {
  kind: "option" | "flag";
  schema: TSchema;
  help?: string;
  name?: string;
  aliases?: readonly string[];
  source?: "--";
};

export class SimpleCLICommandBuilder<
  TInput,
  TContextIn extends SimpleCLIContext,
  TContext extends SimpleCLIContext,
  TResult,
> {
  constructor(
    private readonly definition: NormalizedCommandDefinition<TInput, TContextIn, TContext, TResult>,
  ) {}

  input<TNextInput>(
    input: SimpleCLIInput<TNextInput>,
  ): SimpleCLICommandBuilder<TNextInput, TContextIn, TContext, TResult> {
    return new SimpleCLICommandBuilder<TNextInput, TContextIn, TContext, TResult>({
      config: this.definition.config,
      input,
      middlewares: this.definition.middlewares,
      handler: this.definition.handler as unknown as
        | SimpleCLIHandler<TNextInput, TContext, TResult>
        | undefined,
    });
  }

  use<TContextOut extends SimpleCLIContext>(
    middleware: SimpleCLIMiddleware<TInput, TContext, TContextOut>,
  ): SimpleCLICommandBuilder<TInput, TContextIn, TContextOut, TResult> {
    return new SimpleCLICommandBuilder<
      TInput,
      TContextIn,
      TContextOut,
      TResult
    >({
      config: this.definition.config,
      input: this.definition.input,
      middlewares: [...this.definition.middlewares, middleware],
      handler: this.definition.handler as unknown as
        | SimpleCLIHandler<TInput, TContextOut, TResult>
        | undefined,
    });
  }

  handle<TNextResult>(
    handler: SimpleCLIHandler<TInput, TContext, TNextResult>,
  ): SimpleCLICommandBuilder<TInput, TContextIn, TContext, TNextResult> {
    return new SimpleCLICommandBuilder<TInput, TContextIn, TContext, TNextResult>({
      config: this.definition.config,
      input: this.definition.input,
      middlewares: this.definition.middlewares,
      handler,
    });
  }

  getDefinition(): NormalizedCommandDefinition<TInput, TContextIn, TContext, TResult> {
    return this.definition;
  }
}

export type SimpleCLIGroup<
  TParentContext extends SimpleCLIContext,
  TChildContext extends SimpleCLIContext = TParentContext,
> = {
  kind: "group";
  description?: string;
  routes: SimpleCLIRouteTree<TChildContext>;
  middlewares: AnySimpleCLIMiddleware[];
  __parentContext?: TParentContext;
  __childContext?: TChildContext;
};

export class SimpleCLIApp {
  private readonly resolvedCommands = new Map<string, InternalResolvedCommand>();
  private readonly resolvedGroups = new Map<string, InternalResolvedGroup>();
  private readonly routeEntries: InternalResolvedRouteEntry[];
  private readonly globalNamed: SimpleCLINamedDefinition;

  constructor(
    readonly name: string,
    routes: SimpleCLIRouteTree<{}>,
    config: SimpleCLIAppConfig = {},
  ) {
    const resolution = resolveRouteTree(routes);
    this.globalNamed = config.globalNamed ?? {};

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
    const extractedGlobalArgs = this.extractGlobalArgs(args);
    const normalizedArgs = extractedGlobalArgs.args;
    const helpPath = this.resolveHelpPath(normalizedArgs);
    if (helpPath) {
      return this.renderHelp(helpPath);
    }

    const exactGroup = this.findGroupByPath(normalizedArgs);
    if (exactGroup) {
      return this.renderGroupHelp(exactGroup);
    }

    const parsed = this.parseInvocation(normalizedArgs);
    return this.invoke(
      parsed.routeKey,
      this.injectGlobalNamedArgs(
        parsed.routeKey,
        parsed.rawInput,
        extractedGlobalArgs.named,
      ),
    );
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
        named[storeKey] = readNamedArgValue(
          args,
          index,
          rawName,
          `--${rawName}`,
          namedEntry.spec,
          inlineValue,
          namedSpecs,
        );
        if (inlineValue === undefined && namedEntry.spec.kind !== "flag") {
          index += 1;
        }
        continue;
      }

      if (arg.startsWith("-")) {
        const [rawName, inlineValue] = splitNamedArg(arg.slice(1));
        const namedEntry = namedSpecs.get(rawName);
        if (!namedEntry) {
          throw new Error(`Unknown option: ${arg}`);
        }

        const storeKey = buildNamedArgFlagName(namedEntry.key, namedEntry.spec);
        named[storeKey] = readNamedArgValue(
          args,
          index,
          rawName,
          `-${rawName}`,
          namedEntry.spec,
          inlineValue,
          namedSpecs,
        );
        if (inlineValue === undefined && namedEntry.spec.kind !== "flag") {
          index += 1;
        }
        continue;
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

  private extractGlobalArgs(args: readonly string[]): ExtractedGlobalArgs {
    if (Object.keys(this.globalNamed).length === 0) {
      return {
        args,
        named: {},
      };
    }

    const remainingArgs: string[] = [];
    const named: Record<string, unknown> = {};
    const namedSpecs = buildNamedArgLookup(this.globalNamed);

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index]!;

      if (arg === "--") {
        remainingArgs.push(...args.slice(index));
        break;
      }

      if (arg.startsWith("--")) {
        const [rawName, inlineValue] = splitNamedArg(arg.slice(2));
        const namedEntry = namedSpecs.get(rawName);
        if (!namedEntry) {
          remainingArgs.push(arg);
          continue;
        }

        named[namedEntry.key] = readNamedArgValue(
          args,
          index,
          rawName,
          `--${rawName}`,
          namedEntry.spec,
          inlineValue,
          namedSpecs,
        );
        if (inlineValue === undefined && namedEntry.spec.kind !== "flag") {
          index += 1;
        }
        continue;
      }

      if (arg.startsWith("-")) {
        const [rawName, inlineValue] = splitNamedArg(arg.slice(1));
        const namedEntry = namedSpecs.get(rawName);
        if (!namedEntry) {
          remainingArgs.push(arg);
          continue;
        }

        named[namedEntry.key] = readNamedArgValue(
          args,
          index,
          rawName,
          `-${rawName}`,
          namedEntry.spec,
          inlineValue,
          namedSpecs,
        );
        if (inlineValue === undefined && namedEntry.spec.kind !== "flag") {
          index += 1;
        }
        continue;
      }

      remainingArgs.push(arg);
    }

    return {
      args: remainingArgs,
      named,
    };
  }

  private injectGlobalNamedArgs(
    routeKey: string,
    rawInput: SimpleCLIInputRaw,
    globalNamed: Readonly<Record<string, unknown>>,
  ): SimpleCLIInputRaw {
    if (Object.keys(globalNamed).length === 0) {
      return rawInput;
    }

    const inputDefinition = this.resolvedCommands.get(routeKey)?.input?.getDefinition();
    if (!inputDefinition) {
      return rawInput;
    }

    const named = { ...(rawInput.named ?? {}) };
    let changed = false;

    for (const key of Object.keys(inputDefinition.named)) {
      if (Object.prototype.hasOwnProperty.call(named, key)) continue;
      if (!Object.prototype.hasOwnProperty.call(globalNamed, key)) continue;
      named[key] = globalNamed[key];
      changed = true;
    }

    if (!changed) {
      return rawInput;
    }

    return {
      positionals: rawInput.positionals ?? [],
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

function readNamedArgValue(
  args: readonly string[],
  index: number,
  rawName: string,
  displayName: string,
  spec: SimpleCLINamedArgDefinition<ZodTypeAny>,
  inlineValue: string | undefined,
  namedSpecs: ReadonlyMap<string, { key: string; spec: SimpleCLINamedArgDefinition<ZodTypeAny> }>,
): unknown {
  if (spec.kind === "flag") {
    return inlineValue === undefined
      ? true
      : parseBooleanFlagValue(inlineValue, rawName);
  }

  if (inlineValue !== undefined) {
    return inlineValue;
  }

  const nextValue = args[index + 1];
  if (
    nextValue === undefined
    || nextValue === "--"
    || isRecognizedNamedArgToken(nextValue, namedSpecs)
  ) {
    throw new Error(`Missing value for ${displayName}.`);
  }

  return nextValue;
}

function isRecognizedNamedArgToken(
  token: string,
  namedSpecs: ReadonlyMap<string, { key: string; spec: SimpleCLINamedArgDefinition<ZodTypeAny> }>,
): boolean {
  if (token === "-" || !token.startsWith("-")) {
    return false;
  }

  const normalizedToken = token.startsWith("--")
    ? token.slice(2)
    : token.slice(1);
  const [rawName] = splitNamedArg(normalizedToken);
  return namedSpecs.has(rawName);
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
    for (const alias of spec.aliases ?? []) {
      const normalizedAlias = normalizeNamedArgToken(alias);
      lookup.set(normalizedAlias, { key, spec });
      lookup.set(toCamelCase(normalizedAlias), { key, spec });
    }
  }

  return lookup;
}

function validateParsedPositionals(
  command: InternalResolvedCommand,
  definitions: SimpleCLIPositionalsDefinition,
  positionals: readonly string[],
): void {
  const variadicDefinition = definitions.find((definition) => definition.variadic);
  if (!variadicDefinition && positionals.length > definitions.length) {
    throw new Error(`Unexpected arguments for ${command.path.join(" ")}.`);
  }

  definitions.forEach((definition, index) => {
    const value = definition.variadic
      ? positionals.slice(index)
      : positionals[index];
    if (value !== undefined && (!Array.isArray(value) || value.length > 0)) return;
    if (schemaAcceptsUndefined(definition.schema)) return;
    throw new Error(`Missing required argument <${definition.key}>.`);
  });
}

function validateInputDefinition(definition: SimpleCLIInputDefinition): void {
  const variadicIndex = definition.positionals.findIndex((positional) => positional.variadic);
  if (variadicIndex < 0) return;
  if (variadicIndex !== definition.positionals.length - 1) {
    throw new Error("Variadic positional arguments must be the last positional.");
  }
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
  routes: SimpleCLIRouteTree<any>,
  parentPath: readonly string[] = [],
  parentMiddlewares: readonly AnySimpleCLIMiddleware[] = [],
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
      middlewares: mergeInheritedMiddlewares(parentMiddlewares, command.middlewares),
      handler: command.handler as unknown as SimpleCLIHandler<
        unknown,
        SimpleCLIContext,
        unknown
      >,
    });
    resolved.routeEntries.push({
      kind: "command",
      path,
    });
  }

  return resolved;
}

function mergeInheritedMiddlewares(
  parentMiddlewares: readonly AnySimpleCLIMiddleware[],
  commandMiddlewares: readonly AnySimpleCLIMiddleware[],
): AnySimpleCLIMiddleware[] {
  if (parentMiddlewares.length === 0) {
    return [...commandMiddlewares];
  }

  if (
    commandMiddlewares.length >= parentMiddlewares.length
    && parentMiddlewares.every((middleware, index) => commandMiddlewares[index] === middleware)
  ) {
    return [...commandMiddlewares];
  }

  return [...parentMiddlewares, ...commandMiddlewares];
}

function isGroup(
  value: SimpleCLIGroup<any, any> | SimpleCLICommandBuilder<any, any, any, any>,
): value is SimpleCLIGroup<any, any> {
  return (value as SimpleCLIGroup<any, any>).kind === "group";
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
      output[positional.key] = positional.variadic
        ? positionals.slice(index)
        : positionals[index];
    });

    for (const [key, spec] of Object.entries(definition.named)) {
      const sourceKey = spec.source === "--" ? "--" : (spec.name ?? key);
      const normalizedCandidates = [
        sourceKey,
        spec.name ? toCamelCase(spec.name) : "",
        ...(spec.aliases ?? []).flatMap((alias) => {
          const normalizedAlias = normalizeNamedArgToken(alias);
          return [
            normalizedAlias,
            toCamelCase(normalizedAlias),
          ];
        }),
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
): z.ZodType<InputObjectFor<TPositionals, TNamed>, unknown> {
  const shape: Record<string, ZodTypeAny> = {};

  for (const positional of definition.positionals) {
    shape[positional.key] = positional.schema;
  }
  for (const [key, named] of Object.entries(definition.named)) {
    shape[key] = named.schema;
  }

  return zodObjectFromShape(shape) as z.ZodType<
    InputObjectFor<TPositionals, TNamed>,
    unknown
  >;
}

function positional<TKey extends string, TSchema extends ZodTypeAny>(
  key: TKey,
  schema: TSchema,
  options?: { help?: string; variadic?: boolean },
): SimpleCLIPositionalDefinition<TKey, TSchema> {
  return {
    kind: "positional",
    key,
    schema,
    help: options?.help,
    variadic: options?.variadic,
  };
}

function option<TSchema extends ZodTypeAny>(
  schema: TSchema,
  options?: { help?: string; name?: string; aliases?: readonly string[]; source?: "--" },
): SimpleCLINamedArgDefinition<TSchema> {
  return {
    kind: "option",
    schema,
    help: options?.help,
    name: options?.name,
    aliases: options?.aliases,
    source: options?.source,
  };
}

function flag(
  options?: { help?: string; name?: string; aliases?: readonly string[] },
): SimpleCLINamedArgDefinition<z.ZodDefault<z.ZodBoolean>> {
  return {
    kind: "flag",
    schema: z.boolean().default(false),
    help: options?.help,
    name: options?.name,
    aliases: options?.aliases,
  };
}

function input<
  const TPositionals extends SimpleCLIPositionalsDefinition,
  const TNamed extends SimpleCLINamedDefinition,
>(definition: {
  positionals: TPositionals;
  named: TNamed;
}): SimpleCLIInput<InputObjectFor<TPositionals, TNamed>> {
  validateInputDefinition(definition);
  return new SimpleCLIInput(
    buildInputNormalizer(definition),
    buildInputSchema(definition),
    definition,
  );
}

type SimpleCLIScope<
  TParentContext extends SimpleCLIContext,
  TContext extends SimpleCLIContext,
> = {
  use<TContextOut extends SimpleCLIContext>(
    middleware: SimpleCLIMiddleware<unknown, TContext, TContextOut>
  ): SimpleCLIScope<TParentContext, TContextOut>;
  group(config: SimpleCLIGroupConfig<TContext>): SimpleCLIGroup<TParentContext, TContext>;
  command(
    config: SimpleCLICommandConfig,
  ): SimpleCLICommandBuilder<unknown, TParentContext, TContext, unknown>;
};

function command(
  config: SimpleCLICommandConfig,
): SimpleCLICommandBuilder<unknown, {}, {}, unknown> {
  return new SimpleCLICommandBuilder({
    config,
    middlewares: [],
  });
}

function group(
  config: SimpleCLIGroupConfig<{}>,
): SimpleCLIGroup<{}, {}> {
  return createScope<{}, {}>([]).group(config);
}

function createScope<
  TParentContext extends SimpleCLIContext,
  TContext extends SimpleCLIContext,
>(
  middlewares: readonly AnySimpleCLIMiddleware[],
): SimpleCLIScope<TParentContext, TContext> {
  return {
    use<TContextOut extends SimpleCLIContext>(
      middleware: SimpleCLIMiddleware<unknown, TContext, TContextOut>,
    ): SimpleCLIScope<TParentContext, TContextOut> {
      return createScope<TParentContext, TContextOut>([
        ...middlewares,
        middleware,
      ]);
    },
    group(config: SimpleCLIGroupConfig<TContext>): SimpleCLIGroup<TParentContext, TContext> {
      return {
        kind: "group",
        description: config.description,
        routes: config.routes,
        middlewares: [...middlewares],
      };
    },
    command(
      config: SimpleCLICommandConfig,
    ): SimpleCLICommandBuilder<unknown, TParentContext, TContext, unknown> {
      return new SimpleCLICommandBuilder({
        config,
        middlewares: [...middlewares],
      });
    },
  };
}

function use<TContextOut extends SimpleCLIContext>(
  middleware: SimpleCLIMiddleware<unknown, {}, TContextOut>,
): SimpleCLIScope<{}, TContextOut> {
  return createScope<{}, TContextOut>([middleware]);
}

function define(
  name: string,
  routes: SimpleCLIRouteTree<{}>,
  config?: SimpleCLIAppConfig,
): SimpleCLIApp {
  return new SimpleCLIApp(name, routes, config);
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
  input,
  positional,
  option,
  flag,
};
