/**
 * Playwright methods that accept `{ signal?: AbortSignal }` (Playwright ≥1.62).
 * Locators/pages returned by other methods are still wrapped so later actions
 * on them receive the signal.
 */
const SIGNAL_METHODS = new Set([
	"ariaSnapshot",
	"blur",
	"boundingBox",
	"check",
	"clear",
	"click",
	"dblclick",
	"delete",
	"dispatchEvent",
	"dragAndDrop",
	"dragTo",
	"drop",
	"fetch",
	"fill",
	"focus",
	"get",
	"getAttribute",
	"goBack",
	"goForward",
	"goto",
	"head",
	"hover",
	"innerHTML",
	"innerText",
	"inputValue",
	"isChecked",
	"isDisabled",
	"isEditable",
	"isEnabled",
	"patch",
	"post",
	"press",
	"pressSequentially",
	"put",
	"reload",
	"screenshot",
	"scrollIntoViewIfNeeded",
	"selectOption",
	"selectText",
	"setChecked",
	"setContent",
	"setFiles",
	"setInputFiles",
	"tap",
	"textContent",
	"type",
	"uncheck",
	"waitFor",
	"waitForElementState",
	"waitForEvent",
	"waitForLoadState",
	"waitForNavigation",
	"waitForRequest",
	"waitForResponse",
	"waitForURL",
]);

const WRAP_CTOR_NAMES = new Set([
	"Page",
	"Frame",
	"FrameLocator",
	"Locator",
	"ElementHandle",
	"JSHandle",
	"BrowserContext",
	"Keyboard",
	"Mouse",
	"Touchscreen",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function injectSignal(args: unknown[], signal: AbortSignal): unknown[] {
	const last = args.at(-1);
	if (isPlainObject(last)) {
		if (Object.hasOwn(last, "signal")) return args;
		return [...args.slice(0, -1), { ...last, signal }];
	}
	return [...args, { signal }];
}

function normalizeCtorName(name: string): string {
	// Playwright ships implementation classes as `_Locator`, `Keyboard2`, etc.
	const withoutUnderscore = name.startsWith("_") ? name.slice(1) : name;
	if (WRAP_CTOR_NAMES.has(withoutUnderscore)) return withoutUnderscore;
	if (/2$/.test(withoutUnderscore)) {
		const withoutSuffix = withoutUnderscore.slice(0, -1);
		if (WRAP_CTOR_NAMES.has(withoutSuffix)) return withoutSuffix;
	}
	return withoutUnderscore;
}

function shouldWrap(value: object): boolean {
	const name = value.constructor?.name;
	if (typeof name !== "string") return false;
	return WRAP_CTOR_NAMES.has(normalizeCtorName(name));
}

/**
 * Returns a Proxy around a Playwright Page/Context (and nested Locators/Frames)
 * that injects `signal` into abortable method calls. Once the signal aborts,
 * any subsequent method call on the proxy throws immediately so agent code
 * cannot keep driving the page after a timeout.
 */
export function bindAbortSignal<T extends object>(
	target: T,
	signal: AbortSignal,
): T {
	const proxies = new WeakMap<object, object>();

	const wrap = (value: object): object => {
		const existing = proxies.get(value);
		if (existing) return existing;

		const proxy = new Proxy(value, {
			get(obj, prop) {
				const raw = Reflect.get(obj, prop, obj);
				if (typeof raw !== "function") {
					return maybeWrap(raw);
				}

				return (...args: unknown[]) => {
					if (signal.aborted) {
						throw signal.reason instanceof Error
							? signal.reason
							: new Error(String(signal.reason ?? "aborted"));
					}

					const methodName = typeof prop === "string" ? prop : "";
					const nextArgs = SIGNAL_METHODS.has(methodName)
						? injectSignal(args, signal)
						: args;
					return maybeWrap(raw.apply(obj, nextArgs));
				};
			},
		});
		proxies.set(value, proxy);
		return proxy;
	};

	const maybeWrap = (value: unknown): unknown => {
		if (value === null || typeof value !== "object") return value;
		if (value instanceof Promise) {
			return value.then(maybeWrap);
		}
		if (Array.isArray(value)) {
			return value.map(maybeWrap);
		}
		if (shouldWrap(value)) return wrap(value);
		return value;
	};

	return wrap(target) as T;
}
