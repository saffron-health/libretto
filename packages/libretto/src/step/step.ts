import type { Step, StepHandler, StepOptions, RecoveryHandler } from "./types.js";

/**
 * Creates a Step object from a name, handler, and options.
 *
 * Usage:
 *   step("login", async ({ page }) => { ... })
 *   step("login", async ({ page }) => { ... }, { dryRun: "execute" })
 *   step(async ({ page }) => { ... })  // auto-named
 */
export function step(
	nameOrHandler: string | StepHandler,
	handlerOrOptions?: StepHandler | StepOptions,
	maybeOptions?: StepOptions,
): Step {
	let name: string;
	let handler: StepHandler;
	let options: StepOptions;

	if (typeof nameOrHandler === "string") {
		name = nameOrHandler;
		handler = handlerOrOptions as StepHandler;
		options = maybeOptions ?? {};
	} else {
		name = `step-${_autoNameCounter++}`;
		handler = nameOrHandler;
		options = (handlerOrOptions as StepOptions) ?? {};
	}

	return {
		name,
		handler,
		options: {
			dryRun: options.dryRun ?? "skip",
			simulate: options.simulate,
			recovery: options.recovery,
		},
	};
}

let _autoNameCounter = 1;

export type ExtendOptions = {
	recovery: Record<string, RecoveryHandler>;
};

/**
 * Creates a new step factory with additional recovery handlers merged in.
 *
 * Usage:
 *   const myStep = step.extend({
 *     recovery: {
 *       "payment-error": async ({ page }) => { ... },
 *     },
 *   });
 *
 *   myStep("submit", async ({ page }) => { ... });
 */
step.extend = function extend(extendOptions: ExtendOptions) {
	return function extendedStep(
		nameOrHandler: string | StepHandler,
		handlerOrOptions?: StepHandler | StepOptions,
		maybeOptions?: StepOptions,
	): Step {
		const baseStep = step(nameOrHandler, handlerOrOptions, maybeOptions);

		// Merge recovery handlers: base step's recovery + extended recovery
		const mergedRecovery: Record<string, RecoveryHandler> = {
			...extendOptions.recovery,
			...baseStep.options.recovery,
		};

		return {
			...baseStep,
			options: {
				...baseStep.options,
				recovery: mergedRecovery,
			},
		};
	};
};
