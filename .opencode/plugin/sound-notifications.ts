import type { Plugin } from "@opencode-ai/plugin";

export const SoundNotifications: Plugin = async ({ $, client }) => {
	return {
		event: async ({ event }) => {
			if (event.type === "permission.updated") {
				// Play Ping sound for permission requests
				await $`afplay /System/Library/Sounds/Ping.aiff`;
				await $`tput bel`;
			}

			if (event.type === "session.idle") {
				const sessionID = event.properties.sessionID;

				// Check if this is a sub-agent session
				const { data: session } = await client.session.get({
					path: { id: sessionID },
				});
				if (session?.parentID) {
					return; // Don't notify for sub-agent completions
				}

				// Check if session was interrupted
				const { data: messages } = await client.session.messages({
					path: { id: sessionID },
				});
				const lastMessage = messages?.[messages.length - 1];
				if (
					lastMessage?.info.role === "assistant" &&
					lastMessage?.info.error?.name === "MessageAbortedError"
				) {
					return; // Don't notify for interrupted sessions
				}

				// Play Submarine sound when agent finishes normally
				await $`afplay /System/Library/Sounds/Submarine.aiff`;
				await $`tput bel`;
			}
		},
	};
};
