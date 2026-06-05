import { z, type ZodTypeAny } from "zod";

export interface AffInputRaw {
  arguments?: readonly unknown[];
  options?: Readonly<Record<string, unknown>>;
}

export type AffArgumentDefinition<
  TKey extends string = string,
  TSchema extends ZodTypeAny = ZodTypeAny,
> = readonly [TKey, TSchema];

export type AffArgumentsDefinition = readonly AffArgumentDefinition[];

interface AffNamedInputDeclaration<TType extends "option" | "flag", TSchema extends ZodTypeAny> {
  type: TType;
  schema: TSchema;
}

export type AffOptionDefinition<TSchema extends ZodTypeAny = ZodTypeAny> = AffNamedInputDeclaration<
  "option",
  TSchema
>;

export type AffFlagDefinition = AffNamedInputDeclaration<"flag", z.ZodDefault<z.ZodBoolean>>;

export type AffNamedInputDefinition = AffOptionDefinition | AffFlagDefinition | ZodTypeAny;

export type AffOptionsDefinition = Record<string, AffNamedInputDefinition>;

export interface AffInputDefinition<TOutput = unknown> {
  arguments: AffArgumentsDefinition;
  options: AffOptionsDefinition;
}

type InferArguments<TArguments extends AffArgumentsDefinition> = {
  [TArgument in TArguments[number] as TArgument[0]]: z.output<TArgument[1]>;
};

type SchemaForOption<TOption> =
  TOption extends AffNamedInputDeclaration<"option" | "flag", infer TSchema>
    ? TSchema
    : TOption extends ZodTypeAny
      ? TOption
      : never;

type InferOptions<TOptions extends AffOptionsDefinition> = {
  [K in keyof TOptions]: z.output<SchemaForOption<TOptions[K]>>;
};

export type AffInputFor<
  TArguments extends AffArgumentsDefinition,
  TOptions extends AffOptionsDefinition,
> = InferArguments<TArguments> & InferOptions<TOptions>;

export function createInputDefinition<TOutput = unknown>(
  args: AffArgumentsDefinition,
  options: AffOptionsDefinition,
): AffInputDefinition<TOutput> {
  return {
    arguments: args,
    options,
  };
}

export function option<TSchema extends ZodTypeAny>(schema: TSchema): AffOptionDefinition<TSchema> {
  return {
    type: "option",
    schema,
  };
}

export function flag(): AffFlagDefinition {
  return {
    type: "flag",
    schema: z.boolean().default(false),
  };
}

export function parseInput<TOutput>(
  definition: AffInputDefinition<TOutput>,
  rawInput: unknown,
): TOutput {
  const normalized = normalizeInput(definition, rawInput);
  const schema = z.object(buildInputShape(definition));
  validateRequiredInput(definition, normalized);
  const result = schema.safeParse(normalized);

  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }

  return result.data as TOutput;
}

export function parseCommandLineInput(
  definition: AffInputDefinition | undefined,
  tokens: readonly string[],
  commandName: string,
): AffInputRaw {
  if (!definition) {
    if (tokens.length > 0) {
      throw new Error(`Unexpected arguments for ${commandName}.`);
    }

    return {
      arguments: [],
      options: {},
    };
  }

  const args: string[] = [];
  const options: Record<string, unknown> = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (!token.startsWith("--") || token === "--") {
      args.push(token);
      continue;
    }

    const [name, inlineValue] = splitOptionToken(token.slice(2));
    const optionDefinition = definition.options[name];
    if (!optionDefinition) {
      throw new Error(`Unknown option: --${name}`);
    }

    if (isFlagDefinition(optionDefinition)) {
      options[name] = inlineValue === undefined ? true : parseFlagValue(name, inlineValue);
      continue;
    }

    const value = inlineValue ?? tokens[index + 1];
    if (value === undefined || isRecognizedOptionToken(definition, value)) {
      throw new Error(`Missing value for --${name}.`);
    }

    options[name] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return {
    arguments: args,
    options,
  };
}

function normalizeInput(
  definition: AffInputDefinition,
  rawInput: unknown,
): Record<string, unknown> {
  const raw = normalizeRawInput(rawInput);
  const output: Record<string, unknown> = {};

  definition.arguments.forEach(([key], index) => {
    output[key] = raw.arguments[index];
  });

  for (const key of Object.keys(definition.options)) {
    output[key] = raw.options[key];
  }

  return output;
}

function normalizeRawInput(rawInput: unknown): Required<AffInputRaw> {
  if (!isRecord(rawInput)) {
    return {
      arguments: [],
      options: {},
    };
  }

  return {
    arguments: Array.isArray(rawInput.arguments) ? rawInput.arguments : [],
    options: isRecord(rawInput.options) ? rawInput.options : {},
  };
}

function validateRequiredInput(
  definition: AffInputDefinition,
  normalized: Record<string, unknown>,
): void {
  for (const [key, schema] of definition.arguments) {
    if (normalized[key] === undefined && !schema.safeParse(undefined).success) {
      throw new Error(`Missing required argument <${key}>.`);
    }
  }

  for (const [key, optionDefinition] of Object.entries(definition.options)) {
    const schema = getOptionSchema(optionDefinition);
    if (normalized[key] === undefined && !schema.safeParse(undefined).success) {
      throw new Error(`Missing required option --${key}.`);
    }
  }
}

function splitOptionToken(token: string): readonly [string, string | undefined] {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex < 0) {
    return [token, undefined];
  }

  return [token.slice(0, separatorIndex), token.slice(separatorIndex + 1)];
}

function parseFlagValue(name: string, value: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid value for --${name}: expected true or false.`);
}

function isRecognizedOptionToken(definition: AffInputDefinition, token: string): boolean {
  if (!token.startsWith("--") || token === "--") {
    return false;
  }

  const [name] = splitOptionToken(token.slice(2));
  return Object.hasOwn(definition.options, name);
}

function buildInputShape(definition: AffInputDefinition): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, schema] of definition.arguments) {
    shape[key] = schema;
  }
  for (const [key, optionDefinition] of Object.entries(definition.options)) {
    shape[key] = getOptionSchema(optionDefinition);
  }

  return shape;
}

function getOptionSchema(optionDefinition: AffNamedInputDefinition): ZodTypeAny {
  if (isNamedInputDeclaration(optionDefinition)) {
    return optionDefinition.schema;
  }

  return optionDefinition;
}

function isFlagDefinition(value: AffNamedInputDefinition): value is AffFlagDefinition {
  return isRecord(value) && value.type === "flag" && "schema" in value;
}

function isNamedInputDeclaration(
  value: AffNamedInputDefinition,
): value is AffOptionDefinition | AffFlagDefinition {
  return isRecord(value) && (value.type === "option" || value.type === "flag") && "schema" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
