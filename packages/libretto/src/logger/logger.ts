function generateId(): string {
	return Math.random().toString(36).substring(2, 15);
}

export type LogOptions = {
	timestamp?: Date;
};

export type LoggerApi = {
	log: (
		event: string,
		data?: Record<string, any>,
		options?: LogOptions,
	) => void;
	/**
	 * Logs an error and returns an Error object that can be thrown
	 *
	 * either pass in an Error directly as data or as { error: Error, ...other_data }
	 */
	error: (
		event: string,
		data?: Error | ({ error: Error } & Record<string, any>) | unknown,
		options?: LogOptions,
	) => Error;
	warn: (
		event: string,
		data?: Error | ({ error: Error } & Record<string, any>) | unknown,
		options?: LogOptions,
	) => void;
	info: (
		event: string,
		data?: Record<string, any>,
		options?: LogOptions,
	) => void;

	/**
	 * Context passed in will be attached to all entries in this scope.
	 */
	withScope: (scope: string, context?: Record<string, any>) => LoggerApi;

	/**
	 * Context passed in will be attached to all entries.
	 */
	withContext: (context: Record<string, any>) => LoggerApi;

	/**
	 * Flushes all sinks in reverse order (most recently added first).
	 */
	flush: () => Promise<void>;
};

export type LoggerSink = {
	write: (args: {
		id: string;
		scope: string;
		level: "log" | "error" | "warn" | "info";
		event: string;
		data: Record<string, any>;
		options?: LogOptions;
	}) => void;
	flush?: () => Promise<void>;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function removeUndefined(data: any): any {
	if (typeof data === "object" && data !== null) {
		return Object.fromEntries(
			Object.entries(data).filter(([_, value]) => value !== undefined),
		);
	}
	return data;
}

export class Logger implements LoggerApi {
	private readonly prefix: string;

	constructor(
		private readonly scopes: string[] = [],
		private readonly sinks: LoggerSink[] = [],
		private readonly scopeData: Record<string, any> = {},
	) {
		this.prefix = scopes.join(".");
	}

	entry(entry: {
		level: "log" | "error" | "warn" | "info";
		event: string;
		data?: Record<string, any>;
		options?: LogOptions;
	}) {
		this.sinks.forEach((sink) =>
			sink.write({
				id: generateId(),
				scope: this.prefix,
				level: entry.level,
				event: entry.event,
				data: removeUndefined({ ...this.scopeData, ...entry.data }),
				options: entry.options,
			}),
		);
	}

	log(event: string, data?: Record<string, any>, options?: LogOptions) {
		this.entry({ level: "log", event, data, options });
	}

	error(
		event: string,
		dataOrError?: Error | ({ error: Error } & Record<string, any>) | unknown,
		options?: LogOptions,
	) {
		const data =
			dataOrError instanceof Error
				? {
						error: {
							type: dataOrError.constructor.name,
							message: dataOrError.message,
							stack: dataOrError.stack || null,
						},
					}
				: isObject(dataOrError) && dataOrError.error instanceof Error
					? {
							...dataOrError,
							error: {
								type: dataOrError.error.constructor.name,
								message: dataOrError.error.message,
								stack: dataOrError.error.stack || null,
							},
						}
					: isObject(dataOrError)
						? dataOrError
						: dataOrError !== undefined
							? { error: dataOrError }
							: undefined;

		this.entry({
			level: "error",
			event,
			data: data as Error | Record<string, any>,
			options,
		});

		if (dataOrError instanceof Error) {
			return dataOrError;
		}

		if (isObject(dataOrError) && dataOrError.error instanceof Error) {
			return dataOrError.error;
		}

		let message = event;
		if (data !== undefined) {
			try {
				message += "\n" + JSON.stringify(data, undefined, 2);
			} catch {
				message += "\n[Unserializable error data]";
			}
		}
		return new Error(message);
	}

	warn(
		event: string,
		dataOrError?: Error | ({ error: Error } & Record<string, any>) | unknown,
		options?: LogOptions,
	) {
		const data =
			dataOrError instanceof Error
				? {
						error: {
							type: dataOrError.constructor.name,
							message: dataOrError.message,
							stack: dataOrError.stack || null,
						},
					}
				: isObject(dataOrError) && dataOrError.error instanceof Error
					? {
							...dataOrError,
							error: {
								type: dataOrError.error.constructor.name,
								message: dataOrError.error.message,
								stack: dataOrError.error.stack || null,
							},
						}
					: isObject(dataOrError)
						? dataOrError
						: dataOrError !== undefined
							? { error: dataOrError }
							: undefined;

		this.entry({
			level: "warn",
			event,
			data: data as Record<string, any>,
			options,
		});
	}

	info(event: string, data?: Record<string, any>, options?: LogOptions) {
		this.entry({ level: "info", event, data, options });
	}

	withScope(scope: string, context: Record<string, any> = {}): LoggerApi {
		return new Logger([...this.scopes, scope], this.sinks, {
			...this.scopeData,
			...context,
		});
	}

	withContext(context: Record<string, any>): LoggerApi {
		return new Logger(this.scopes, this.sinks, {
			...this.scopeData,
			...context,
		});
	}

	withSink(sink: LoggerSink): Logger {
		return new Logger(this.scopes, [...this.sinks, sink]);
	}

	async flush(): Promise<void> {
		for (let i = this.sinks.length - 1; i >= 0; i--) {
			const sink = this.sinks[i];
			if (!sink) continue;
			try {
				await sink.flush?.();
			} catch {
				// Ignore flush errors - we're likely shutting down
			}
		}
	}
}
