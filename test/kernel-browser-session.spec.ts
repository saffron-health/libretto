import { describe, expect, test, vi } from "vitest";
import type { Browser } from "playwright";
import {
	KERNEL_BENCHMARK_TIMEOUT_SECONDS,
	KERNEL_BENCHMARK_VIEWPORT,
	createKernelBrowserSession,
} from "../src/cli/core/kernel-browser-session.js";

function createBrowserFixture() {
	const goto = vi.fn(async () => undefined);
	const setDefaultTimeout = vi.fn();
	const setDefaultNavigationTimeout = vi.fn();
	const page = {
		url: () => "https://example.com",
		setDefaultTimeout,
		setDefaultNavigationTimeout,
		goto,
	} as const;
	const context = {
		pages: () => [page],
		newPage: vi.fn(async () => page),
	} as const;
	const closeConnection = vi.fn();
	const browser = {
		contexts: () => [context],
		newContext: vi.fn(async () => context),
		_connection: {
			close: closeConnection,
		},
	} as const;

	return {
		browser,
		context,
		page,
		goto,
		setDefaultTimeout,
		setDefaultNavigationTimeout,
		closeConnection,
	};
}

describe("kernel browser session launcher", () => {
	test("creates a stealth browser session, connects via CDP, and persists kernel session state", async () => {
		const { browser, context, page, goto, setDefaultTimeout, setDefaultNavigationTimeout } =
			createBrowserFixture();
		const create = vi.fn(async () => ({
			cdp_ws_url: "wss://kernel.example/cdp/session",
			session_id: "sess_123",
		}));
		const deleteByID = vi.fn(async () => undefined);
		const connectOverCDP = vi.fn(async () => browser);
		const installTelemetry = vi.fn(async () => undefined);
		const writeSessionState = vi.fn();

		const result = await createKernelBrowserSession(
			{
				session: "bench-1",
				url: "https://example.com/start",
				headless: true,
				ownerPid: 777,
				logAction: vi.fn(),
				logNetwork: vi.fn(),
				now: () => new Date("2026-03-13T00:00:00.000Z"),
			},
			{
				kernelClient: {
					browsers: {
						create,
						deleteByID,
					},
				},
				chromiumClient: {
					connectOverCDP: connectOverCDP as unknown as (endpoint: string) => Promise<Browser>,
				},
				installSessionTelemetryImpl: installTelemetry,
				writeSessionStateImpl: writeSessionState,
			},
		);

		expect(create).toHaveBeenCalledWith({
			headless: true,
			stealth: true,
			timeout_seconds: KERNEL_BENCHMARK_TIMEOUT_SECONDS,
			viewport: KERNEL_BENCHMARK_VIEWPORT,
		});
		expect(connectOverCDP).toHaveBeenCalledWith(
			"wss://kernel.example/cdp/session",
		);
		expect(installTelemetry).toHaveBeenCalledWith({
			context,
			initialPage: page,
			includeUserDomActions: true,
			logAction: expect.any(Function),
			logNetwork: expect.any(Function),
		});
		expect(setDefaultTimeout).toHaveBeenCalledWith(30_000);
		expect(setDefaultNavigationTimeout).toHaveBeenCalledWith(45_000);
		expect(goto).toHaveBeenCalledWith("https://example.com/start");
		expect(writeSessionState).toHaveBeenCalledWith({
			provider: "kernel",
			session: "bench-1",
			cdpWsUrl: "wss://kernel.example/cdp/session",
			sessionId: "sess_123",
			pid: 777,
			startedAt: "2026-03-13T00:00:00.000Z",
			status: "active",
		});
		expect(result.context).toBe(context);
		expect(result.page).toBe(page);

		await result.cleanup();
		expect(deleteByID).toHaveBeenCalledWith("sess_123");
	});

	test("cleanup still deletes the kernel session when CDP disconnect throws", async () => {
		const { browser, closeConnection } = createBrowserFixture();
		closeConnection.mockImplementation(() => {
			throw new Error("disconnect failed");
		});
		const deleteByID = vi.fn(async () => undefined);

		const result = await createKernelBrowserSession(
			{
				session: "bench-2",
				url: "https://example.com/start",
				headless: true,
				logAction: vi.fn(),
				logNetwork: vi.fn(),
			},
			{
				kernelClient: {
					browsers: {
						create: vi.fn(async () => ({
							cdp_ws_url: "wss://kernel.example/cdp/session-2",
							session_id: "sess_456",
						})),
						deleteByID,
					},
				},
				chromiumClient: {
					connectOverCDP: vi.fn(
						async () => browser as unknown as Browser,
					) as unknown as (endpoint: string) => Promise<Browser>,
				},
				installSessionTelemetryImpl: vi.fn(async () => undefined),
				writeSessionStateImpl: vi.fn(),
			},
		);

		await result.cleanup();
		expect(deleteByID).toHaveBeenCalledWith("sess_456");
	});

	test("startup cleanup deletes the kernel session and disconnects CDP when initialization fails", async () => {
		const { browser, closeConnection } = createBrowserFixture();
		const deleteByID = vi.fn(async () => undefined);
		const writeSessionState = vi.fn();

		await expect(
			createKernelBrowserSession(
				{
					session: "bench-3",
					url: "https://example.com/start",
					headless: true,
					logAction: vi.fn(),
					logNetwork: vi.fn(),
				},
				{
					kernelClient: {
						browsers: {
							create: vi.fn(async () => ({
								cdp_ws_url: "wss://kernel.example/cdp/session-3",
								session_id: "sess_789",
							})),
							deleteByID,
						},
					},
					chromiumClient: {
						connectOverCDP: vi.fn(
							async () => browser as unknown as Browser,
						) as unknown as (endpoint: string) => Promise<Browser>,
					},
					installSessionTelemetryImpl: vi.fn(async () => {
						throw new Error("telemetry failed");
					}),
					writeSessionStateImpl: writeSessionState,
				},
			),
		).rejects.toThrow("telemetry failed");

		expect(closeConnection).toHaveBeenCalledTimes(1);
		expect(deleteByID).toHaveBeenCalledWith("sess_789");
		expect(writeSessionState).not.toHaveBeenCalled();
	});

	test("startup cleanup still deletes the kernel session when CDP connect fails", async () => {
		const deleteByID = vi.fn(async () => undefined);

		await expect(
			createKernelBrowserSession(
				{
					session: "bench-4",
					url: "https://example.com/start",
					headless: true,
					logAction: vi.fn(),
					logNetwork: vi.fn(),
				},
				{
					kernelClient: {
						browsers: {
							create: vi.fn(async () => ({
								cdp_ws_url: "wss://kernel.example/cdp/session-4",
								session_id: "sess_999",
							})),
							deleteByID,
						},
					},
					chromiumClient: {
						connectOverCDP: vi.fn(async () => {
							throw new Error("cdp connect failed");
						}) as unknown as (endpoint: string) => Promise<Browser>,
					},
					installSessionTelemetryImpl: vi.fn(async () => undefined),
					writeSessionStateImpl: vi.fn(),
				},
			),
		).rejects.toThrow("cdp connect failed");

		expect(deleteByID).toHaveBeenCalledWith("sess_999");
	});
});
