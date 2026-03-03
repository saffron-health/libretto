import type { Page } from "playwright";

export type GhostCursorStyle = "minimal" | "dot" | "screenstudio";

export type GhostCursorOptions = {
	style?: GhostCursorStyle;
	color?: string;
	size?: number;
	zIndex?: number;
	easing?: string;
	minDurationMs?: number;
	maxDurationMs?: number;
	speedPxPerMs?: number;
};

const DEFAULTS: Required<GhostCursorOptions> = {
	style: "minimal",
	color: "rgba(255, 70, 70, 0.9)",
	size: 20,
	zIndex: 2147483646,
	easing: "cubic-bezier(0.16, 1, 0.3, 1)",
	minDurationMs: 100,
	maxDurationMs: 600,
	speedPxPerMs: 1.5,
};

const CURSOR_ID = "__libretto_ghost_cursor__";

function buildCursorSvg(style: GhostCursorStyle, color: string, size: number): string {
	if (style === "dot") {
		return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};"></div>`;
	}
	if (style === "screenstudio") {
		return `<div style="width:${size * 1.4}px;height:${size * 1.4}px;border-radius:50%;background:${color};box-shadow:0 0 ${size * 0.6}px ${color};opacity:0.7;"></div>`;
	}
	// minimal: default arrow-like SVG cursor
	return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M5 3L19 12L12 13L9 20L5 3Z" fill="${color}" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>
	</svg>`;
}

function buildInitScript(opts: Required<GhostCursorOptions>): string {
	const svg = buildCursorSvg(opts.style, opts.color, opts.size);
	return `
(function() {
	if (document.getElementById("${CURSOR_ID}")) return;
	var el = document.createElement("div");
	el.id = "${CURSOR_ID}";
	el.style.cssText = "position:fixed;top:0;left:0;z-index:${opts.zIndex};pointer-events:none;transform:translate3d(-100px,-100px,0);transition:none;will-change:transform,opacity;opacity:0;";
	el.innerHTML = ${JSON.stringify(svg)};
	document.documentElement.appendChild(el);
})();
`;
}

const installedPages = new WeakSet<Page>();

export async function ensureGhostCursor(
	page: Page,
	options?: GhostCursorOptions,
): Promise<void> {
	const existingOpts = (page as any).__librettoGhostCursorOpts as
		| Required<GhostCursorOptions>
		| undefined;
	const opts = { ...DEFAULTS, ...(existingOpts ?? {}), ...options };
	const initScript = buildInitScript(opts);

	if (!installedPages.has(page)) {
		installedPages.add(page);
		await page.addInitScript({ content: initScript });
	}

	// Store options on the page for later use by move/click
	(page as any).__librettoGhostCursorOpts = opts;

	// Re-run in-page installer so cursor recovers after page.setContent() or DOM resets.
	try {
		await page.evaluate(new Function(initScript) as () => void);
	} catch {
		// Page might not be ready yet; addInitScript will handle on next navigation
	}
}

export async function moveGhostCursor(
	page: Page,
	target: { x: number; y: number; durationMs?: number },
): Promise<void> {
	const opts: Required<GhostCursorOptions> =
		(page as any).__librettoGhostCursorOpts ?? DEFAULTS;

	const durationMs =
		target.durationMs ??
		Math.min(
			opts.maxDurationMs,
			Math.max(opts.minDurationMs, 200), // default ~200ms if no distance info
		);

	try {
		await page.evaluate(
			({ id, x, y, duration, easing }) => {
				const el = document.getElementById(id);
				if (!el) return;
				el.style.opacity = "1";
				el.style.transition = `transform ${duration}ms ${easing}`;
				el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
			},
			{ id: CURSOR_ID, x: target.x, y: target.y, duration: durationMs, easing: opts.easing },
		);

		await page.waitForTimeout(durationMs);
	} catch {
		// Best-effort: page may have navigated
	}
}

export async function moveGhostCursorWithDistance(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
): Promise<void> {
	const opts: Required<GhostCursorOptions> =
		(page as any).__librettoGhostCursorOpts ?? DEFAULTS;

	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const distance = Math.sqrt(dx * dx + dy * dy);
	const durationMs = Math.min(
		opts.maxDurationMs,
		Math.max(opts.minDurationMs, distance / opts.speedPxPerMs),
	);

	await moveGhostCursor(page, { x: to.x, y: to.y, durationMs });
}

export async function ghostClick(
	page: Page,
	target: { x: number; y: number },
): Promise<void> {
	try {
		// Click feedback: scale down on "press"
		await page.evaluate(
			({ id, x, y }) => {
				const el = document.getElementById(id);
				if (!el) return;
				el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(0.93)`;
				el.style.transition = "transform 80ms ease-out";
			},
			{ id: CURSOR_ID, x: target.x, y: target.y },
		);
		await page.waitForTimeout(100);

		// Release: scale back up
		await page.evaluate(
			({ id, x, y }) => {
				const el = document.getElementById(id);
				if (!el) return;
				el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1)`;
				el.style.transition = "transform 120ms ease-out";
			},
			{ id: CURSOR_ID, x: target.x, y: target.y },
		);
		await page.waitForTimeout(130);
	} catch {
		// Best-effort
	}
}

export async function hideGhostCursor(page: Page): Promise<void> {
	try {
		await page.evaluate(
			({ id }) => {
				const el = document.getElementById(id);
				if (!el) return;
				el.style.transition = "opacity 300ms ease-out";
				el.style.opacity = "0";
			},
			{ id: CURSOR_ID },
		);
	} catch {
		// Best-effort
	}
}

export async function getGhostCursorPosition(
	page: Page,
): Promise<{ x: number; y: number } | null> {
	try {
		return await page.evaluate(({ id }) => {
			const el = document.getElementById(id);
			if (!el) return null;
			const match = el.style.transform.match(
				/translate3d\(\s*([\d.-]+)px\s*,\s*([\d.-]+)px/,
			);
			if (!match) return null;
			return { x: parseFloat(match[1]!), y: parseFloat(match[2]!) };
		}, { id: CURSOR_ID });
	} catch {
		return null;
	}
}
