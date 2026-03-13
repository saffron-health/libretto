import { Kernel } from "@onkernel/sdk";
import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page,
} from "playwright";
import { writeSessionState } from "./session.js";
import { installSessionTelemetry } from "./session-telemetry.js";

export const KERNEL_BENCHMARK_TIMEOUT_SECONDS = 1_800;
export const KERNEL_BENCHMARK_VIEWPORT = {
	width: 1440,
	height: 900,
} as const;

type KernelBrowserCreateResponse = {
	cdp_ws_url: string;
	session_id: string;
};

type KernelClientLike = {
	browsers: {
		create: (args: {
			headless: boolean;
			stealth: boolean;
			timeout_seconds: number;
			viewport: { width: number; height: number };
		}) => Promise<KernelBrowserCreateResponse>;
		deleteByID: (id: string) => Promise<void>;
	};
};

type ChromiumLike = {
	connectOverCDP: (endpoint: string) => Promise<Browser>;
};

type InstallSessionTelemetryLike = typeof installSessionTelemetry;

export type CreateKernelBrowserSessionArgs = {
	session: string;
	url: string;
	headless: boolean;
	ownerPid?: number;
	logAction: (entry: unknown) => void;
	logNetwork: (entry: unknown) => void;
	now?: () => Date;
};

export type CreateKernelBrowserSessionResult = {
	browser: Browser;
	context: BrowserContext;
	page: Page;
	cdpWsUrl: string;
	sessionId: string;
	cleanup: () => Promise<void>;
};

export function buildKernelBrowserCreateParams(headless: boolean): {
	headless: boolean;
	stealth: true;
	timeout_seconds: number;
	viewport: typeof KERNEL_BENCHMARK_VIEWPORT;
} {
	return {
		headless,
		stealth: true,
		timeout_seconds: KERNEL_BENCHMARK_TIMEOUT_SECONDS,
		viewport: KERNEL_BENCHMARK_VIEWPORT,
	};
}

function isOperationalPage(page: Page): boolean {
	const url = page.url();
	return !url.startsWith("devtools://") && !url.startsWith("chrome-error://");
}

function disconnectCDPBrowser(browser: Browser): void {
	try {
		(browser as { _connection?: { close?: () => void } })._connection?.close?.();
	} catch {
		// Ignore disconnect failures during cleanup.
	}
}

async function resolveConnectedPage(browser: Browser): Promise<{
	context: BrowserContext;
	page: Page;
}> {
	const context = browser.contexts()[0] ?? (await browser.newContext());
	const page =
		context.pages().find((candidate) => isOperationalPage(candidate)) ??
		(await context.newPage());
	return { context, page };
}

export async function createKernelBrowserSession(
	args: CreateKernelBrowserSessionArgs,
	deps?: {
		kernelClient?: KernelClientLike;
		chromiumClient?: ChromiumLike;
		installSessionTelemetryImpl?: InstallSessionTelemetryLike;
		writeSessionStateImpl?: typeof writeSessionState;
	},
): Promise<CreateKernelBrowserSessionResult> {
	const kernelClient = deps?.kernelClient ?? new Kernel();
	const chromiumClient = deps?.chromiumClient ?? chromium;
	const installSessionTelemetryImpl =
		deps?.installSessionTelemetryImpl ?? installSessionTelemetry;
	const writeSessionStateImpl = deps?.writeSessionStateImpl ?? writeSessionState;
	const browserSession = await kernelClient.browsers.create(
		buildKernelBrowserCreateParams(args.headless),
	);
	const browser = await chromiumClient.connectOverCDP(browserSession.cdp_ws_url);
	const { context, page } = await resolveConnectedPage(browser);

	page.setDefaultTimeout(30_000);
	page.setDefaultNavigationTimeout(45_000);

	await installSessionTelemetryImpl({
		context,
		initialPage: page,
		includeUserDomActions: true,
		logAction: args.logAction,
		logNetwork: args.logNetwork,
	});

	await page.goto(args.url);

	writeSessionStateImpl({
		provider: "kernel",
		session: args.session,
		cdpWsUrl: browserSession.cdp_ws_url,
		sessionId: browserSession.session_id,
		pid: args.ownerPid ?? process.pid,
		startedAt: (args.now?.() ?? new Date()).toISOString(),
		status: "active",
	});

	let cleanedUp = false;
	return {
		browser,
		context,
		page,
		cdpWsUrl: browserSession.cdp_ws_url,
		sessionId: browserSession.session_id,
		cleanup: async () => {
			if (cleanedUp) return;
			cleanedUp = true;

			disconnectCDPBrowser(browser);
			await kernelClient.browsers.deleteByID(browserSession.session_id);
		},
	};
}
