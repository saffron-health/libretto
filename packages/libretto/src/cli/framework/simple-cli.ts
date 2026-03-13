import { z, type RefinementCtx, type ZodTypeAny } from "zod";

type RecordUnknown = Record<string, unknown>;

export type SimpleCLIHelpConfig = {
  purpose: string;
  usage: string;
  requiredArgs?: string[];
  optionalFlags?: string[];
  examples: string[];
};

export type SimpleCLICommandConfig = {
  help: string | SimpleCLIHelpConfig;
};

export type SimpleCLIInputRaw = {
  positionals?: readonly unknown[];
  named?: Readonly<Record<string, unknown>>;
};

export type SimpleCLIContext = Record<string, unknown>;

export type SimpleCLICommandMeta = {
  routeKey: string;
  path: readonly string[];
  help: string | SimpleCLIHelpConfig;
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

export type SimpleCLIParsedInvocation = {
  routeKey: string;
  positionals?: readonly unknown[];
  named?: Readonly<Record<string, unknown>>;
  ctx?: SimpleCLIContext;
};

export type SimpleCLIParserAdapter = {
  parse: (
    args: readonly string[],
    commands: readonly SimpleCLIResolvedCommand[],
  ) =>
    | SimpleCLIParsedInvocation
    | null
    | Promise<SimpleCLIParsedInvocation | null>;
};

type SimpleCLIPositionalsDefinition = readonly SimpleCLIPositionalDefinition<
  string,
  ZodTypeAny
>[];

type SimpleCLINamedDefinition = Record<string, SimpleCLINamedArgDefinition<ZodTypeAny>>;

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
  help: string | SimpleCLIHelpConfig;
};

type InternalResolvedCommand = SimpleCLIResolvedCommand & {
  input?: SimpleCLIInput<unknown>;
  middlewares: SimpleCLIMiddleware<unknown>[];
  handler: SimpleCLIHandler<unknown, unknown>;
};

function toCamelCase(input: string): string {
  return input.replace(/-([a-zA-Z0-9])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function zodObjectFromShape(
  shape: Record<string, ZodTypeAny>,
): z.ZodObject<Record<string, ZodTypeAny>> {
  return z.object(shape);
}

export class SimpleCLIInput<TOutput> {
  constructor(
    private readonly normalize: (raw: SimpleCLIInputRaw) => unknown,
    private readonly schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  ) {}

  parse(raw: SimpleCLIInputRaw): TOutput {
    return this.schema.parse(this.normalize(raw));
  }

  refine(
    check: (arg: TOutput) => unknown,
    message?: string,
  ): SimpleCLIInput<TOutput> {
    const nextSchema = this.schema.refine(
      (value) => Boolean(check(value)),
      message ? { message } : undefined,
    );
    return new SimpleCLIInput(this.normalize, nextSchema);
  }

  superRefine(
    check: (arg: TOutput, ctx: RefinementCtx) => void,
  ): SimpleCLIInput<TOutput> {
    const nextSchema = this.schema.superRefine(check);
    return new SimpleCLIInput(this.normalize, nextSchema);
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
  routes: SimpleCLIRouteTree;
  middlewares: SimpleCLIMiddleware[];
};

export class SimpleCLIApp {
  private readonly resolved = new Map<string, InternalResolvedCommand>();

  constructor(
    readonly name: string,
    routes: SimpleCLIRouteTree,
  ) {
    const commands = resolveRouteTree(routes);
    for (const command of commands) {
      if (this.resolved.has(command.routeKey)) {
        throw new Error(`Duplicate command route key: ${command.routeKey}`);
      }
      this.resolved.set(command.routeKey, command);
    }
  }

  getCommands(): SimpleCLIResolvedCommand[] {
    return [...this.resolved.values()].map((command) => ({
      routeKey: command.routeKey,
      path: command.path,
      help: command.help,
    }));
  }

  async invoke(
    routeKey: string,
    rawInput: SimpleCLIInputRaw,
    initialContext: SimpleCLIContext = {},
  ): Promise<unknown> {
    const command = this.resolved.get(routeKey);
    if (!command) {
      throw new Error(`Unknown command route key "${routeKey}".`);
    }

    const input = command.input ? command.input.parse(rawInput) : rawInput;
    let ctx: SimpleCLIContext = { ...initialContext };
    const meta: SimpleCLICommandMeta = {
      routeKey: command.routeKey,
      path: command.path,
      help: command.help,
    };

    for (const middleware of command.middlewares) {
      const next = await middleware({ input, ctx, command: meta });
      if (next !== undefined) {
        ctx = next;
      }
    }

    return command.handler({ input, ctx, command: meta });
  }

  async run(
    args: readonly string[],
    adapter: SimpleCLIParserAdapter,
  ): Promise<unknown> {
    const commands = this.getCommands();
    const parsed = await adapter.parse(args, commands);
    if (!parsed) return null;
    return this.invoke(
      parsed.routeKey,
      {
        positionals: parsed.positionals,
        named: parsed.named,
      },
      parsed.ctx ?? {},
    );
  }
}

function resolveRouteTree(
  routes: SimpleCLIRouteTree,
  parentPath: readonly string[] = [],
  parentMiddlewares: readonly SimpleCLIMiddleware[] = [],
): InternalResolvedCommand[] {
  const resolved: InternalResolvedCommand[] = [];

  for (const [token, routeValue] of Object.entries(routes)) {
    if (isGroup(routeValue)) {
      const nested = resolveRouteTree(
        routeValue.routes,
        [...parentPath, token],
        [...parentMiddlewares, ...routeValue.middlewares],
      );
      resolved.push(...nested);
      continue;
    }

    const command = routeValue.getDefinition();
    if (!command.handler) {
      throw new Error(`Command "${[...parentPath, token].join(" ")}" is missing a handler.`);
    }

    const path = [...parentPath, token];
    resolved.push({
      routeKey: path.join("."),
      path,
      help: command.config.help,
      input: command.input,
      middlewares: [
        ...parentMiddlewares,
        ...(command.middlewares as unknown as SimpleCLIMiddleware<unknown>[]),
      ],
      handler: command.handler as unknown as SimpleCLIHandler<unknown, unknown>,
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

function help(config: SimpleCLIHelpConfig): SimpleCLIHelpConfig {
  return config;
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

function group(routes: SimpleCLIRouteTree): SimpleCLIGroup {
  return {
    kind: "group",
    routes,
    middlewares: [],
  };
}

function use(...middlewares: SimpleCLIMiddleware[]) {
  return {
    group(routes: SimpleCLIRouteTree): SimpleCLIGroup {
      return {
        kind: "group",
        routes,
        middlewares,
      };
    },
    command(config: SimpleCLICommandConfig): SimpleCLICommandBuilder<unknown, unknown> {
      let next = command(config);
      for (const middleware of middlewares) {
        next = next.use(middleware);
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
  input,
  positional,
  option,
  flag,
  help,
};
