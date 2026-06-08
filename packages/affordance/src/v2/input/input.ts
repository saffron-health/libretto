import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";

type AffNamedInputDeclaration<TType extends "option" | "flag", TSchema extends StandardSchemaV1> = {
  type: TType;
  schema: TSchema;
};

/** Valued named option backed by a Standard Schema validator. */
export type AffOptionDefinition<TSchema extends StandardSchemaV1 = StandardSchemaV1> =
  AffNamedInputDeclaration<"option", TSchema>;

/** Wrap a Standard Schema validator as a valued named option declaration. */
export function option<TSchema extends StandardSchemaV1>(
  schema: TSchema,
): AffOptionDefinition<TSchema> {
  return {
    type: "option",
    schema,
  };
}

/** Boolean named option that defaults to `false` when omitted. */
export type AffFlagDefinition = AffNamedInputDeclaration<
  "flag",
  StandardSchemaV1<unknown, boolean>
>;

/** Create a boolean flag declaration for `.options(...)`. */
export function flag(): AffFlagDefinition {
  return {
    type: "flag",
    schema: z.boolean().default(false),
  };
}

/** Positional argument declaration as a `[name, schema]` tuple. */
export type AffArgumentDefinition<
  TKey extends string = string,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
> = readonly [TKey, TSchema];

/** Ordered positional argument declarations for `.arguments(...)`. */
export type AffArgumentsDefinition = readonly AffArgumentDefinition[];

/** Named input declaration accepted by `.options(...)`. */
export type AffNamedInputDefinition = AffOptionDefinition | AffFlagDefinition | StandardSchemaV1;

/** Named option declarations keyed by their command-line option name. */
export type AffOptionsDefinition = Record<string, AffNamedInputDefinition>;

/** Parsed input definition owned by a command. */
export type AffInputDefinition<TOutput = unknown> = {
  /** Ordered positional argument declarations. */
  arguments: AffArgumentsDefinition;
  /** Named option declarations. */
  options: AffOptionsDefinition;
};

/** Create an input definition from positional arguments and named options. */
export function createInputDefinition<TOutput = unknown>(
  args: AffArgumentsDefinition,
  options: AffOptionsDefinition,
): AffInputDefinition<TOutput> {
  return {
    arguments: args,
    options,
  };
}

type InferSchemaOutput<TSchema extends StandardSchemaV1> = StandardSchemaV1.InferOutput<TSchema>;

type InferArguments<TArguments extends AffArgumentsDefinition> = {
  [TArgument in TArguments[number] as TArgument[0]]: InferSchemaOutput<TArgument[1]>;
};

type SchemaForOption<TOption> =
  TOption extends AffNamedInputDeclaration<"option" | "flag", infer TSchema>
    ? TSchema
    : TOption extends StandardSchemaV1
      ? TOption
      : never;

type InferOptions<TOptions extends AffOptionsDefinition> = {
  [K in keyof TOptions]: InferSchemaOutput<SchemaForOption<TOptions[K]>>;
};

/** Parsed input object inferred from argument and option declarations. */
export type AffInputFor<
  TArguments extends AffArgumentsDefinition,
  TOptions extends AffOptionsDefinition,
> = InferArguments<TArguments> & InferOptions<TOptions>;

/** Raw invocation input before Aff validates arguments and options. */
export type AffInputRaw = {
  /** Positional argument values in declaration order. */
  arguments: readonly unknown[];
  /** Named option values keyed by option name. */
  options: Readonly<Record<string, unknown>>;
};

/** Validate raw invocation input against an Aff input definition. */
export async function parseInput<TOutput>(
  definition: AffInputDefinition<TOutput>,
  rawInput: AffInputRaw,
  commandName?: string,
): Promise<TOutput> {
  if (rawInput.arguments.length > definition.arguments.length) {
    throw new Error(
      commandName ? `Unexpected arguments for ${commandName}.` : "Unexpected arguments.",
    );
  }

  const input: Record<string, unknown> = {};

  for (const [index, [key, schema]] of definition.arguments.entries()) {
    const value = rawInput.arguments[index];
    input[key] = await validateInputValue(schema, value, `Missing required argument <${key}>.`);
  }

  for (const key of Object.keys(rawInput.options)) {
    if (!Object.hasOwn(definition.options, key)) {
      throw new Error(`Unknown option: --${key}`);
    }
  }

  for (const [key, optionDefinition] of Object.entries(definition.options)) {
    const optionWasProvided = Object.hasOwn(rawInput.options, key);
    const value = resolveNamedInputValue(
      key,
      optionDefinition,
      rawInput.options[key],
      optionWasProvided,
    );
    input[key] = await validateInputValue(
      getOptionSchema(optionDefinition),
      value,
      `Missing required option --${key}.`,
    );
  }

  return input as TOutput;
}

async function validateInputValue(
  schema: StandardSchemaV1,
  value: unknown,
  missingError: string,
): Promise<unknown> {
  const result = await schema["~standard"].validate(value);

  if ("value" in result) {
    return result.value;
  }

  if (value === undefined) {
    throw new Error(missingError);
  }

  throw new Error(result.issues.map((issue) => issue.message).join("\n"));
}

function resolveNamedInputValue(
  key: string,
  optionDefinition: AffNamedInputDefinition,
  value: unknown,
  optionWasProvided: boolean,
): unknown {
  if ("type" in optionDefinition && optionDefinition.type === "flag") {
    if (!optionWasProvided) {
      return undefined;
    }

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
  } else if (optionWasProvided && value === undefined) {
    throw new Error(`Missing value for --${key}.`);
  } else {
    return value;
  }
}

function getOptionSchema(optionDefinition: AffNamedInputDefinition): StandardSchemaV1 {
  if (
    "type" in optionDefinition &&
    (optionDefinition.type === "option" || optionDefinition.type === "flag") &&
    "schema" in optionDefinition
  ) {
    return optionDefinition.schema;
  }

  return optionDefinition;
}
