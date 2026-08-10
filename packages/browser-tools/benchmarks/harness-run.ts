import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SessionRun, UsageMetrics } from "./agent.js";

/**
 * Normalized benchmark event log. Pi harnesses convert AgentSessionEvent into
 * this shape; host CLIs (Hermes/OpenClaw) emit it directly.
 */
export type HarnessMessageEvent = {
	type: "message";
	role: "user" | "assistant" | "system";
	text: string;
};

export type HarnessToolStartEvent = {
	type: "tool_execution_start";
	toolName: string;
	args?: unknown;
};

export type HarnessToolEndEvent = {
	type: "tool_execution_end";
	toolName: string;
	isError?: boolean;
	result?: unknown;
};

export type HarnessLogEvent = {
	type: "log";
	stream: "stdout" | "stderr";
	text: string;
};

export type HarnessErrorEvent = {
	type: "error";
	message: string;
};

export type HarnessEvent =
	| HarnessMessageEvent
	| HarnessToolStartEvent
	| HarnessToolEndEvent
	| HarnessLogEvent
	| HarnessErrorEvent;

export type HarnessRun = {
	answer: string;
	events: HarnessEvent[];
	/** Present fields only; omit unknowns instead of inventing zeros. */
	metrics: UsageMetrics;
	browserBackend: "benchmark-provider" | "host-stock";
	dispose(): Promise<void>;
};

export class HarnessRunError extends Error {
	readonly run: HarnessRun;

	constructor(error: unknown, run: HarnessRun) {
		super(error instanceof Error ? error.message : String(error));
		this.name = "HarnessRunError";
		this.run = run;
	}
}

function eventReplacer(key: string, value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (key === "data" && typeof value === "string" && value.length > 10_000) {
		return `[omitted ${value.length} characters]`;
	}
	return value;
}

export function harnessEventsJsonl(events: readonly HarnessEvent[]): string {
	return `${events
		.map((event) => JSON.stringify(event, eventReplacer))
		.join("\n")}\n`;
}

export function transcriptFromHarnessEvents(
	events: readonly HarnessEvent[],
): string {
	const sections: string[] = [];
	for (const event of events) {
		switch (event.type) {
			case "message":
				sections.push(`## ${event.role}\n\n${event.text}`);
				break;
			case "tool_execution_start":
				sections.push(`### tool start: ${event.toolName}`);
				break;
			case "tool_execution_end":
				sections.push(
					`### tool end: ${event.toolName}${event.isError ? " (error)" : ""}`,
				);
				break;
			case "log":
				sections.push(`### ${event.stream}\n\n${event.text}`);
				break;
			case "error":
				sections.push(`### error\n\n${event.message}`);
				break;
		}
	}
	return sections.join("\n\n").trim();
}

function messageText(message: {
	role?: unknown;
	content?: unknown;
}): string | null {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return null;
	const parts: string[] = [];
	for (const part of message.content) {
		if (
			part &&
			typeof part === "object" &&
			"type" in part &&
			(part as { type: unknown }).type === "text" &&
			"text" in part &&
			typeof (part as { text: unknown }).text === "string"
		) {
			parts.push((part as { text: string }).text);
		}
	}
	return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Map Pi session events into the shared HarnessEvent log so the judge sees one
 * schema across Pi and host CLI harnesses.
 */
export function harnessEventsFromPi(
	events: readonly AgentSessionEvent[],
): HarnessEvent[] {
	const out: HarnessEvent[] = [];
	for (const event of events) {
		if (event.type === "tool_execution_start") {
			out.push({
				type: "tool_execution_start",
				toolName: event.toolName,
				args: "args" in event ? (event as { args?: unknown }).args : undefined,
			});
			continue;
		}
		if (event.type === "tool_execution_end") {
			out.push({
				type: "tool_execution_end",
				toolName: event.toolName,
				isError:
					"isError" in event
						? Boolean((event as { isError?: unknown }).isError)
						: undefined,
				result:
					"result" in event ? (event as { result?: unknown }).result : undefined,
			});
			continue;
		}
		if (event.type === "message_end") {
			const message = event.message as {
				role?: unknown;
				content?: unknown;
			};
			const role =
				message.role === "user" ||
				message.role === "assistant" ||
				message.role === "system"
					? message.role
					: null;
			const text = messageText(message);
			if (role && text !== null) {
				out.push({ type: "message", role, text });
			}
		}
	}
	return out;
}

export function harnessRunFromPiSession(
	run: SessionRun,
	metrics: UsageMetrics,
): HarnessRun {
	const answer = run.session.getLastAssistantText()?.trim() ?? "";
	return {
		answer,
		events: harnessEventsFromPi(run.events),
		metrics,
		browserBackend: "benchmark-provider",
		async dispose() {
			run.session.dispose();
		},
	};
}
