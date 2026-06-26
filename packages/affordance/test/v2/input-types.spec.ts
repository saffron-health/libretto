import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, test } from "vitest";
import { Aff } from "../../src/v2/index.js";

function testStandardSchema<TInput, TOutput>(
  validate: (value: unknown) => StandardSchemaV1.Result<TOutput> = () => ({
    issues: [{ message: "not used" }],
  }),
): StandardSchemaV1<TInput, TOutput> {
  return {
    "~standard": {
      version: 1,
      vendor: "affordance-test",
      validate,
    },
  };
}

describe("Aff v2 input types", () => {
  test("infers Standard Schema argument output types in command handlers", () => {
    const workflowSchema = testStandardSchema<string, { workflowPath: string }>();

    Aff.command({ description: "Run workflow" })
      .arguments([["workflow", workflowSchema]])
      .handle(({ input }) => {
        const workflowPath: string = input.workflow.workflowPath;
        return workflowPath;
      });
  });

  test("infers Standard Schema plain option output types in command handlers", () => {
    const countSchema = testStandardSchema<string, number>();

    Aff.command({ description: "Run workflow" })
      .options({ count: countSchema })
      .handle(({ input }) => {
        const count: number = input.count;
        return count;
      });
  });

  test("infers Standard Schema output types through Aff.option in command handlers", () => {
    const labelSchema = testStandardSchema<string | undefined, string>();

    Aff.command({ description: "Run workflow" })
      .options({ label: Aff.option(labelSchema) })
      .handle(({ input }) => {
        const label: string = input.label;
        return label;
      });
  });

  test("keeps option output types when arguments are declared after options", () => {
    const countSchema = testStandardSchema<string, number>();
    const workflowSchema = testStandardSchema<string, { workflowPath: string }>();

    Aff.command({ description: "Run workflow" })
      .options({ count: countSchema })
      .arguments([["workflow", workflowSchema]])
      .handle(({ input }) => {
        const count: number = input.count;
        const workflowPath: string = input.workflow.workflowPath;
        return `${workflowPath}:${count}`;
      });
  });
});
