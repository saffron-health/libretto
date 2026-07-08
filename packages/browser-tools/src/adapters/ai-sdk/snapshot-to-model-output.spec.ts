import { describe, expect, it } from "vitest";
import { snapshotToModelOutput } from "./snapshot-to-model-output.js";

describe("snapshotToModelOutput", () => {
	it("maps tree-only results to text output", () => {
		expect(
			snapshotToModelOutput({
				toolCallId: "call-1",
				input: { sessionId: "ses-1" },
				output: { ok: true, tree: "<page>hello</page>" },
			}),
		).toEqual({ type: "text", value: "<page>hello</page>" });
	});

	it("maps screenshot results to text plus image-data content", () => {
		expect(
			snapshotToModelOutput({
				toolCallId: "call-1",
				input: { sessionId: "ses-1", screenshot: true },
				output: {
					ok: true,
					tree: "<page>shot</page>",
					screenshot: { base64: "abc123", mimeType: "image/png" },
				},
			}),
		).toEqual({
			type: "content",
			value: [
				{ type: "text", text: "<page>shot</page>" },
				{ type: "image-data", data: "abc123", mediaType: "image/png" },
			],
		});
	});

	it("maps failures to error-text output", () => {
		expect(
			snapshotToModelOutput({
				toolCallId: "call-1",
				input: { sessionId: "ses-nope" },
				output: { ok: false, error: "Unknown session ID: ses-nope" },
			}),
		).toEqual({
			type: "error-text",
			value: "Unknown session ID: ses-nope",
		});
	});
});
