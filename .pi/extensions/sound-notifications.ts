/**
 * Sound Notifications Extension
 *
 * Plays sounds when the agent finishes work and is waiting for input.
 * macOS only (uses afplay).
 *
 * Ported from .opencode/plugin/sound-notifications.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		try {
			await pi.exec("afplay", ["/System/Library/Sounds/Submarine.aiff"]);
		} catch {
			// Ignore if afplay not available (non-macOS)
		}
	});
}
