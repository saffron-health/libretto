import type { Page } from "playwright";

export type HighlightOptions = {
	color?: string;
	zIndex?: number;
};

const HIGHLIGHT_DEFAULTS = {
	color: "rgba(59, 130, 246, 0.25)",
	zIndex: 2147483645,
};

const LAYER_ID = "__libretto_highlight_layer__";

function buildHighlightInitScript(opts: { zIndex: number }): string {
	return `
(function() {
	if (document.getElementById("${LAYER_ID}")) return;
	var el = document.createElement("div");
	el.id = "${LAYER_ID}";
	el.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:${opts.zIndex};pointer-events:none;overflow:hidden;";
	document.documentElement.appendChild(el);
})();
`;
}

const installedPages = new WeakSet<Page>();

export async function ensureHighlightLayer(
	page: Page,
	options?: HighlightOptions,
): Promise<void> {
	const existingOpts = (page as any).__librettoHighlightOpts as
		| { color: string; zIndex: number }
		| undefined;
	const zIndex =
		options?.zIndex ?? existingOpts?.zIndex ?? HIGHLIGHT_DEFAULTS.zIndex;
	const initScript = buildHighlightInitScript({ zIndex });

	if (!installedPages.has(page)) {
		installedPages.add(page);
		await page.addInitScript({ content: initScript });
	}

	// Store/refresh options for later.
	(page as any).__librettoHighlightOpts = {
		color: options?.color ?? existingOpts?.color ?? HIGHLIGHT_DEFAULTS.color,
		zIndex,
	};

	// Re-run in-page installer so overlays recover after page.setContent() or DOM resets.
	try {
		await page.evaluate(new Function(initScript) as () => void);
	} catch {
		// Page may not be ready
	}
}

export type ShowHighlightParams = {
	box: { x: number; y: number; width: number; height: number };
	label?: string;
	color?: string;
	durationMs?: number;
};

export async function showHighlight(
	page: Page,
	params: ShowHighlightParams,
): Promise<void> {
	const opts = (page as any).__librettoHighlightOpts ?? HIGHLIGHT_DEFAULTS;
	const color = params.color ?? opts.color;
	const durationMs = params.durationMs ?? 350;

	try {
		await page.evaluate(
			({ layerId, box, color, label, durationMs }) => {
				const layer = document.getElementById(layerId);
				if (!layer) return;

				const rect = document.createElement("div");
				rect.className = "__libretto_highlight_rect__";
				rect.style.cssText = `
					position:absolute;
					left:${box.x}px;
					top:${box.y}px;
					width:${box.width}px;
					height:${box.height}px;
					background:${color};
					border:2px solid ${color.replace(/[\d.]+\)$/, "0.6)")};
					border-radius:3px;
					pointer-events:none;
					transition:opacity 200ms ease-out;
					opacity:1;
				`;

				if (label) {
					const labelEl = document.createElement("div");
					labelEl.textContent = label;
					labelEl.style.cssText = `
						position:absolute;
						top:-22px;
						left:0;
						font:11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;
						color:#fff;
						background:rgba(0,0,0,0.7);
						padding:2px 6px;
						border-radius:3px;
						white-space:nowrap;
						pointer-events:none;
					`;
					rect.appendChild(labelEl);
				}

				layer.appendChild(rect);

				// Auto-fade after duration
				setTimeout(() => {
					rect.style.opacity = "0";
					setTimeout(() => rect.remove(), 250);
				}, durationMs);
			},
			{
				layerId: LAYER_ID,
				box: params.box,
				color,
				label: params.label,
				durationMs,
			},
		);
	} catch {
		// Best-effort
	}
}

export async function clearHighlights(page: Page): Promise<void> {
	try {
		await page.evaluate(({ layerId }) => {
			const layer = document.getElementById(layerId);
			if (!layer) return;
			const rects = layer.querySelectorAll(".__libretto_highlight_rect__");
			rects.forEach((r) => r.remove());
		}, { layerId: LAYER_ID });
	} catch {
		// Best-effort
	}
}
