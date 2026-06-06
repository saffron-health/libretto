import { z, type ZodTypeAny } from "zod";

export interface AffInputRaw {
  arguments: readonly unknown[];
  options: Readonly<Record<string, unknown>>;
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
  rawInput: AffInputRaw,
  commandName?: string,
): TOutput {
  const input = buildSchemaInput(definition, rawInput, commandName);
  return parseSchemaInput(definition, input);
}

function buildSchemaInput(
  definition: AffInputDefinition,
  rawInput: AffInputRaw,
  commandName: string | undefined,
): Record<string, unknown> {
  if (rawInput.arguments.length > definition.arguments.length) {
    throw new Error(
      commandName ? `Unexpected arguments for ${commandName}.` : "Unexpected arguments.",
    );
  }

  const input: Record<string, unknown> = {};

  definition.arguments.forEach(([key], index) => {
    input[key] = rawInput.arguments[index];
  });

  for (const key of Object.keys(definition.options)) {
    input[key] = undefined;
  }

  for (const [key, value] of Object.entries(rawInput.options)) {
    const optionDefinition = definition.options[key];
    if (!optionDefinition) {
      throw new Error(`Unknown option: --${key}`);
    }

    input[key] = normalizeOptionValue(key, optionDefinition, value);
  }

  return input;
}

function normalizeOptionValue(
  key: string,
  optionDefinition: AffNamedInputDefinition,
  value: unknown,
): unknown {
  if (isFlagDefinition(optionDefinition)) {
    if (value === undefined) {
      return true;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (value === "true" || value === "false") {
      return value === "true";
    }

    throw new Error(`Invalid value for --${key}: expected true or false.`);
  }

  if (value === undefined) {
    throw new Error(`Missing value for --${key}.`);
  }

  return value;
}

function parseSchemaInput<TOutput>(
  definition: AffInputDefinition<TOutput>,
  input: Record<string, unknown>,
): TOutput {
  const schema = z.object(buildInputShape(definition));
  validateRequiredInput(definition, input);
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }

  return result.data as TOutput;
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
