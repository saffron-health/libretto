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

  try {
    return schema.parse(normalized) as TOutput;
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

function isNamedInputDeclaration(
  value: AffNamedInputDefinition,
): value is AffOptionDefinition | AffFlagDefinition {
  return isRecord(value) && (value.type === "option" || value.type === "flag") && "schema" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
