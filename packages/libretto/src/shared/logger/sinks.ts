import * as fs from "node:fs";
import * as path from "node:path";
import type { LoggerSink } from "./logger.js";

export function createFileLogSink({
	filePath,
}: {
	filePath: string;
}): LoggerSink {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });

	const writeStream = fs.createWriteStream(filePath, { flags: "a" });

	return {
		write: ({ id, scope, level, event, data, options }) => {
			if (writeStream.destroyed || writeStream.writableEnded) {
				return;
			}
			const timestamp = options?.timestamp || new Date();

			const logEntry = {
				timestamp: timestamp.toISOString(),
				id,
				level,
				scope,
				event,
				data,
			};

			const jsonLine = JSON.stringify(logEntry) + "\n";

			try {
				writeStream.write(jsonLine, (error) => {
					if (error) {
						console.error("Failed to write to log file:", error);
						console[level]({ id, scope, event, data, timestamp });
					}
				});
			} catch (error) {
				console.error("Failed to write to log file:", error);
				console[level]({ id, scope, event, data, timestamp });
			}
		},
		flush: () =>
			new Promise<void>((resolve, reject) => {
				if (!writeStream.writable || writeStream.writableEnded || writeStream.destroyed) {
					resolve();
					return;
				}
				writeStream.write("", (error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			}),
		close: () =>
			new Promise<void>((resolve) => {
				if (writeStream.destroyed || writeStream.closed) {
					resolve();
					return;
				}
				let settled = false;
				const done = () => {
					if (settled) return;
					settled = true;
					resolve();
				};
				writeStream.once("finish", done);
				writeStream.once("close", done);
				writeStream.once("error", done);
				try {
					writeStream.end();
				} catch {
					done();
				}
			}),
	};
}

// ANSI color codes
const colors = {
	reset: "\x1b[0m",
	gray: "\x1b[90m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
};

function formatTimestamp(date: Date): string {
	return date.toISOString().replace("T", " ").replace("Z", "");
}

export const prettyConsoleSink: LoggerSink = {
	write: ({ scope, level, event, data, options }) => {
		const timestamp = `${colors.gray}${formatTimestamp(options?.timestamp || new Date())}${colors.reset}`;
		const levelColor =
			level === "error"
				? colors.red
				: level === "warn"
					? colors.yellow
					: colors.blue;
		const coloredScope = scope ? `${colors.cyan}[${scope}]${colors.reset}` : "";

		const logPrefix = `${timestamp} ${levelColor}${level.toUpperCase()}${colors.reset} ${coloredScope} ${event}`;

		if (level === "error" && data.error) {
			const { error, ...otherData } = data;
			console.error(logPrefix);
			if (error.stack) {
				console.error(`  ${error.stack}`);
			} else if (error.type && error.message) {
				console.error(`  ${error.type}: ${error.message}`);
			}
			if (Object.keys(otherData).length > 0) {
				console.error(JSON.stringify(otherData, null, 2));
			}
		} else {
			console[level](logPrefix);
			if (Object.keys(data).length > 0) {
				console[level](JSON.stringify(data, null, 2));
			}
		}
	},
};

export const jsonlConsoleSink: LoggerSink = {
	write: ({ id, scope, level, event, data, options }) => {
		const timestamp = options?.timestamp || new Date();

		const logEntry = {
			timestamp: timestamp.toISOString(),
			id,
			level,
			scope: scope || undefined,
			event,
			data,
		};

		console.log(JSON.stringify(logEntry));
	},
};
