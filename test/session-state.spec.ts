import { describe, expect, test } from "vitest";
import {
	getSessionConnectionEndpoint,
	isKernelSessionState,
	isLocalSessionState,
	parseSessionStateData,
	serializeSessionState,
} from "../src/shared/state/index.js";

describe("session state parsing", () => {
	test("parses legacy local session files and normalizes provider", () => {
		const state = parseSessionStateData(
			{
				version: 1,
				session: "default",
				port: 9222,
				pid: 12345,
				startedAt: "2026-03-13T00:00:00.000Z",
				status: "active",
			},
			"legacy-local",
		);

		expect(isLocalSessionState(state)).toBe(true);
		expect(state).toEqual({
			provider: "local",
			session: "default",
			port: 9222,
			pid: 12345,
			startedAt: "2026-03-13T00:00:00.000Z",
			status: "active",
		});
		expect(getSessionConnectionEndpoint(state)).toBe("http://127.0.0.1:9222");
	});

	test("serializes and parses kernel session files", () => {
		const serialized = serializeSessionState({
			provider: "kernel",
			session: "bench-1",
			pid: 4242,
			cdpWsUrl: "wss://api.onkernel.com/cdp/abc",
			sessionId: "sess_123",
			startedAt: "2026-03-13T00:00:00.000Z",
			status: "active",
		});

		expect(serialized).toEqual({
			version: 1,
			provider: "kernel",
			session: "bench-1",
			pid: 4242,
			cdpWsUrl: "wss://api.onkernel.com/cdp/abc",
			sessionId: "sess_123",
			startedAt: "2026-03-13T00:00:00.000Z",
			status: "active",
		});

		const parsed = parseSessionStateData(serialized, "kernel");
		expect(isKernelSessionState(parsed)).toBe(true);
		expect(getSessionConnectionEndpoint(parsed)).toBe(
			"wss://api.onkernel.com/cdp/abc",
		);
	});
});
