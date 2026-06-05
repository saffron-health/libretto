import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Page } from "playwright";

import {
  LibrettoWorkflowInputError,
  workflow,
} from "../src/shared/workflow/workflow.js";

// The Page methods touched by these tests are never actually called — we only
// need `.run()` to type-check, and validation rejects bad input before the
// handler runs. Cast through unknown to dodge Playwright's huge surface area.
const fakePage = {} as unknown as Page;
const fakeCtx = { session: "test-session", page: fakePage };

describe("workflow() with Zod schemas", () => {
  const inputSchema = z.object({
    url: z.string().url(),
    shouldFail: z.boolean().optional(),
  });
  const outputSchema = z.object({
    pageTitle: z.string(),
    finalUrl: z.string(),
  });

  it("exposes the schemas on the workflow object so the build manifest can serialize them", () => {
    const wf = workflow(
      "exposes",
      { input: inputSchema, output: outputSchema },
      async (_ctx, input) => ({
        pageTitle: "x",
        finalUrl: input.url,
      }),
    );

    expect(wf.inputSchema).toBe(inputSchema);
    expect(wf.outputSchema).toBe(outputSchema);
  });

  it("exposes auth profile metadata for local runs and hosted workflow discovery", () => {
    const wf = workflow(
      "profiled",
      {
        input: inputSchema,
        output: outputSchema,
        authProfile: { name: "twitter", persistAfterRun: true },
      },
      async (_ctx, input) => ({
        pageTitle: "x",
        finalUrl: input.url,
      }),
    );

    expect(wf.authProfileName).toBe("twitter");
    expect(wf.authProfilePersistAfterRun).toBe(true);
    expect("authProfileSites" in wf).toBe(false);
  });

  it("rejects invalid workflow auth profile names", () => {
    expect(() =>
      workflow(
        "invalid-profile",
        { input: inputSchema, authProfile: { name: " " } },
        async () => ({ pageTitle: "x", finalUrl: "https://example.com" }),
      ),
    ).toThrow("Profile name is required");
    expect(() =>
      workflow(
        "path-profile",
        { input: inputSchema, authProfile: "../twitter" },
        async () => ({ pageTitle: "x", finalUrl: "https://example.com" }),
      ),
    ).toThrow("Invalid profile name");
  });

  it("passes parsed input through to the handler when input is valid", async () => {
    const wf = workflow(
      "valid",
      { input: inputSchema, output: outputSchema },
      async (_ctx, input) => ({
        pageTitle: "ok",
        finalUrl: input.url,
      }),
    );

    const result = await wf.run(fakeCtx, {
      url: "https://example.com",
    });
    expect(result).toEqual({ pageTitle: "ok", finalUrl: "https://example.com" });
  });

  it("accepts input and output schemas in the options object", async () => {
    const wf = workflow("options-object", {
      input: inputSchema,
      output: outputSchema,
      handler: async (_ctx, input) => ({
        pageTitle: "ok",
        finalUrl: input.url,
      }),
    });

    expect(wf.inputSchema).toBe(inputSchema);
    expect(wf.outputSchema).toBe(outputSchema);
    await expect(
      wf.run(fakeCtx, { url: "https://example.com" }),
    ).resolves.toEqual({
      pageTitle: "ok",
      finalUrl: "https://example.com",
    });
  });

  it("throws LibrettoWorkflowInputError with a field-by-field message when input is invalid", async () => {
    let handlerCalled = false;
    const wf = workflow(
      "invalid",
      { input: inputSchema, output: outputSchema },
      async () => {
        handlerCalled = true;
        return { pageTitle: "should not run", finalUrl: "" };
      },
    );

    // Missing required `url`.
    await expect(wf.run(fakeCtx, { shouldFail: true })).rejects.toMatchObject({
      name: "LibrettoWorkflowInputError",
      workflowName: "invalid",
    });
    expect(handlerCalled).toBe(false);

    // The error message names the workflow and lists the failing field so a
    // user can see exactly what went wrong.
    try {
      await wf.run(fakeCtx, { shouldFail: "not a boolean" });
      throw new Error("expected validation error");
    } catch (err) {
      expect(err).toBeInstanceOf(LibrettoWorkflowInputError);
      const msg = (err as LibrettoWorkflowInputError).message;
      expect(msg).toContain('Invalid input for workflow "invalid"');
      expect(msg).toContain("url");
      expect(msg).toContain("shouldFail");
    }
  });

  it("still accepts the legacy 2-arg form so old deployed bundles keep loading", async () => {
    const wf = workflow("legacy", async (_ctx, input) => {
      return { echoed: input };
    });

    expect(wf.inputSchema).toBeUndefined();
    expect(wf.outputSchema).toBeUndefined();

    const result = await wf.run(fakeCtx, { anything: "goes" });
    expect(result).toEqual({ echoed: { anything: "goes" } });
  });
});
