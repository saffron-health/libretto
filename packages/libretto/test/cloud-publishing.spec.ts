import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/cli/core/auth-fetch.js", () => ({
  orpcCall: vi.fn(),
}));

import { orpcCall } from "../src/cli/core/auth-fetch.js";
import { publishWorkflowWithPrivacyReview } from "../src/cli/commands/cloud-publishing.js";

const context = {
  apiUrl: "https://api.libretto.test",
  credential: { source: "env-api-key" as const, apiKey: "test-key" },
};

const warning = {
  id: "finding-1",
  severity: "warning" as const,
  category: "private_url" as const,
  file: "workflow.ts",
  line: 12,
  explanation: "A private URL may be embedded here.",
  suggestedFix: "Move the URL to a secret.",
};

describe("cloud publish privacy review", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("blocks publication when the privacy review blocks the source", async () => {
    vi.mocked(orpcCall).mockResolvedValueOnce({
      workflow: "syncClaims",
      status: "blocked",
      review_id: "2edbf679-dda3-4df8-822b-9dc2228c48f8",
      findings: [{ ...warning, severity: "blocked" }],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      publishWorkflowWithPrivacyReview(context, {
        workflow: "syncClaims",
        acknowledgeWarnings: false,
      }),
    ).rejects.toThrow("Publishing is blocked");
    expect(orpcCall).toHaveBeenCalledTimes(1);
  });

  it("requires explicit warning acknowledgement", async () => {
    vi.mocked(orpcCall).mockResolvedValueOnce({
      workflow: "syncClaims",
      status: "needs_review",
      review_id: "2edbf679-dda3-4df8-822b-9dc2228c48f8",
      findings: [warning],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      publishWorkflowWithPrivacyReview(context, {
        workflow: "syncClaims",
        acknowledgeWarnings: false,
      }),
    ).rejects.toThrow("--acknowledge-warnings");
    expect(orpcCall).toHaveBeenCalledTimes(1);
  });

  it("acknowledges the exact review before publishing", async () => {
    const reviewId = "2edbf679-dda3-4df8-822b-9dc2228c48f8";
    vi.mocked(orpcCall)
      .mockResolvedValueOnce({
        workflow: "syncClaims",
        status: "needs_review",
        review_id: reviewId,
        findings: [warning],
      })
      .mockResolvedValueOnce({
        workflow: "syncClaims",
        hosted_workflow: "acme/syncClaims",
        page_url: "https://libretto.test/hosted-workflows/acme/syncClaims",
        deployment_version: 4,
        status: "created",
      });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      publishWorkflowWithPrivacyReview(context, {
        workflow: "syncClaims",
        description: "Sync claims",
        acknowledgeWarnings: true,
      }),
    ).resolves.toMatchObject({ status: "created" });
    expect(orpcCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          privacyReview: {
            capability: "workflow_privacy_review_v1",
            reviewId,
            acknowledgeWarnings: true,
          },
        }),
      }),
    );
  });
});
